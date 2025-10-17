#!/usr/bin/env python3
"""
crawler.py

Consolidated crawler pipeline:
- Render /all-bids pages (Playwright), capture all-bids-data -> docs
- Download PDF for each doc (Playwright request)
- Parse downloaded PDFs with pdfplumber -> extract BOQ lines
- Insert tenders into `tenders` table (already exists)
- Insert BOQ lines into `boq_lines` table
- Compute fuzzy matches against dummy_skus.csv and insert into `matches` table

Usage:
    python crawler.py --pages 2 --max-new 100

Notes:
 - Requires Playwright and pdfplumber installed.
 - Keeps deduplication by gem_bid_id.
"""
import argparse, os, re, time, sqlite3, hashlib
from pathlib import Path
from datetime import datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from dateutil import parser as dateparser
from tqdm import tqdm

try:
    from rapidfuzz.fuzz import token_sort_ratio
    HAS_RAPIDFUZZ = True
except Exception:
    HAS_RAPIDFUZZ = False

import pdfplumber
from playwright.sync_api import sync_playwright
import pandas as pd

# ---------------------------
# Config
# ---------------------------
BASE_DOMAIN = "https://bidplus.gem.gov.in"
LISTING_PATH = "/all-bids"
USER_AGENT = "GeM-TriageBot/0.1 (+your-email@example.com)"
DATA_DIR = Path("data")
PDF_DIR = DATA_DIR / "pdfs"
DB_PATH = DATA_DIR / "tenders.db"
REQUEST_SLEEP = 0.5

SKU_CSV = "dummy_skus.csv"  # keep in repo root

# ---------------------------
# DB & helpers
# ---------------------------
def connect_db():
    DATA_DIR.mkdir(exist_ok=True)
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    return conn

def init_schema(conn):
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS tenders (
        id INTEGER PRIMARY KEY,
        gem_bid_id TEXT UNIQUE,
        title TEXT,
        detail_url TEXT,
        pdf_url TEXT,
        pdf_sha256 TEXT,
        pdf_path TEXT,
        bid_end TIMESTAMP,
        emd_amount TEXT,
        raw_text TEXT,
        parsed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    cur.execute("""
    CREATE TABLE IF NOT EXISTS boq_lines (
        id INTEGER PRIMARY KEY,
        gem_bid_id TEXT,
        line_no INTEGER,
        description TEXT,
        quantity INTEGER,
        pdf_path TEXT,
        parsed_at TIMESTAMP
    )""")
    cur.execute("""
    CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY,
        boq_line_id INTEGER,
        sku_id TEXT,
        sku_title TEXT,
        score REAL,
        exact_match INTEGER,
        matched_at TIMESTAMP
    )""")
    conn.commit()

def sha256_bytes(b: bytes) -> str:
    m = hashlib.sha256()
    m.update(b)
    return m.hexdigest()

def safe_parse_date(s):
    if not s: return None
    try:
        return dateparser.parse(str(s))
    except Exception:
        return None

# ---------------------------
# PDF parsing -> extract broad tables and produce canonical lines
# ---------------------------
def extract_boq_lines_from_pdf(pdf_path):
    """
    Returns list of dicts: {"description":..., "quantity":..., "line_no": n}
    Uses pdfplumber to pull tables and falls back to heuristics on text.
    """
    rows = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            line_idx = 1
            for page in pdf.pages:
                # try page tables first
                tables = page.extract_tables()
                for t in tables:
                    if not t: continue
                    # first row header? attempt to normalize columns
                    if len(t) >= 2:
                        header = t[0]
                        for r in t[1:]:
                            # join the row cells into a single string for description
                            desc = " | ".join([str(c).strip() for c in r if c and c.strip()][:3])
                            # try to find a qty in row
                            qty = None
                            for cell in r:
                                if cell:
                                    m = re.search(r"([0-9,]{1,10})\b", cell.replace(",",""))
                                    if m:
                                        try:
                                            qty = int(m.group(1).replace(",",""))
                                            break
                                        except:
                                            pass
                            rows.append({"description": desc, "quantity": qty, "line_no": line_idx})
                            line_idx += 1
                    else:
                        # single-row table, skip
                        pass
                # fallback: text-based line heuristics
                text = page.extract_text() or ""
                for tl in text.splitlines():
                    if len(tl.strip()) < 6: continue
                    # extract if it contains a quantity token
                    if re.search(r"\b[0-9,]{2,}\b", tl):
                        # try to extract quantity token
                        m = re.search(r"([0-9,]{1,10})\s*(?:Nos?|Pieces|Pack|Pcs|Qty|Quantity|Sets?)", tl, re.IGNORECASE)
                        if not m:
                            m = re.search(r"\b([0-9,]{2,10})\b", tl)
                        qty = int(m.group(1).replace(",","")) if m else None
                        rows.append({"description": tl.strip()[:400], "quantity": qty, "line_no": line_idx})
                        line_idx += 1
    except Exception as e:
        print("pdf parse error", pdf_path, e)
    return rows

# ---------------------------
# Matching helpers (SKU)
# ---------------------------
def load_skus(csv_path):
    if not os.path.exists(csv_path):
        return pd.DataFrame()
    df = pd.read_csv(csv_path, dtype=str).fillna("")
    return df

def fuzzy_score(a,b):
    if not a or not b: return 0.0
    if HAS_RAPIDFUZZ:
        return token_sort_ratio(a, b) / 100.0
    else:
        # fallback difflib
        from difflib import SequenceMatcher
        return SequenceMatcher(None, a.lower(), b.lower()).ratio()

def match_line(line_text, sku_df, top_k=3):
    scores = []
    for _, s in sku_df.iterrows():
        title = s.get("title","")
        # simple exact token check for first 3 significant words
        sig = re.findall(r"\b[A-Za-z0-9]{3,}\b", title)[:3]
        exact = False
        if sig and all(w.lower() in line_text.lower() for w in sig):
            exact = True
        sc = fuzzy_score(line_text, title)
        scores.append((s.get("sku_id",""), title, sc, exact))
    scores.sort(key=lambda x: (not x[3], -x[2]))
    # return list of dicts
    out = []
    for sku_id, title, sc, exact in scores[:top_k]:
        out.append({"sku_id": sku_id, "sku_title": title, "score": round(sc,3), "exact": int(bool(exact))})
    return out

# ---------------------------
# Main crawl & pipeline
# ---------------------------
def crawl_and_process(max_pages=2, max_new=200):
    conn = connect_db()
    init_schema(conn)
    sku_df = load_skus(SKU_CSV)

    new_count = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=USER_AGENT)
        page = context.new_page()

        for page_num in range(1, max_pages + 1):
            list_url = BASE_DOMAIN + LISTING_PATH + f"?page={page_num}"
            print(f"[crawl] opening {list_url}")
            captured = []

            def on_response(resp):
                try:
                    url = resp.url
                    if "/all-bids-data" in url:
                        try:
                            body = resp.json()
                        except Exception:
                            try:
                                body = resp.text()
                            except:
                                body = None
                        captured.append((url, body))
                except Exception:
                    pass

            page.on("response", on_response)
            page.goto(list_url, wait_until="networkidle", timeout=60000)
            time.sleep(1.0)

            items = []
            if captured:
                for _, body in captured:
                    # navigate nested path we saw: body['response']['response']['docs']
                    if isinstance(body, dict):
                        docs = body.get("response", {}).get("response", {}).get("docs")
                        if isinstance(docs, list) and docs:
                            items = docs
                            break
            if not items:
                html = page.content()
                soup = BeautifulSoup(html, "html.parser")
                anchors = [a.get("href") for a in soup.find_all("a", href=True)]
                for href in anchors:
                    if href and ("/showbidDocument/" in href or "/bidding/" in href or "/public-bid-other-details" in href):
                        items.append({"detail_url": urljoin(BASE_DOMAIN, href)})

            print(f"  found {len(items)} candidate docs on page {page_num}")

            for it in tqdm(items, desc=f"page{page_num}"):
                if new_count >= max_new: break

                # normalize doc into candidate
                cand = {}
                if isinstance(it, dict):
                    if "id" in it:
                        cand["doc_id"] = str(it.get("id"))
                    # b_bid_number often an array
                    if "b_bid_number" in it:
                        v = it.get("b_bid_number")
                        cand["gem_bid_id"] = str(v[0]) if isinstance(v, (list,tuple)) and v else str(v)
                    if "b_category_name" in it:
                        v = it.get("b_category_name")
                        cand.setdefault("title", str(v[0]) if isinstance(v,(list,tuple)) and v else str(v))
                    if "bd_category_name" in it:
                        v = it.get("bd_category_name")
                        cand.setdefault("title", str(v[0]) if isinstance(v,(list,tuple)) and v else str(v))
                    # try detail path property if present
                    for k,v in it.items():
                        if isinstance(v, str) and (v.startswith("/public-bid-other-details") or v.startswith("/showbidDocument") or v.startswith("/bidding/")):
                            cand["detail_url"] = urljoin(BASE_DOMAIN, v)
                # build fallback detail url from doc_id
                if not cand.get("detail_url") and cand.get("doc_id"):
                    cand["detail_url"] = urljoin(BASE_DOMAIN, f"/public-bid-other-details/{cand['doc_id']}")
                if not cand.get("gem_bid_id"):
                    cand["gem_bid_id"] = cand.get("doc_id")

                gem_id = cand.get("gem_bid_id") or cand.get("doc_id")
                cur = conn.cursor()
                cur.execute("SELECT gem_bid_id FROM tenders WHERE gem_bid_id=?", (gem_id,))
                if cur.fetchone():
                    continue

                # new tender meta
                meta = {
                    "gem_bid_id": gem_id,
                    "title": cand.get("title"),
                    "detail_url": cand.get("detail_url"),
                    "pdf_url": None,
                    "pdf_path": None,
                    "pdf_sha256": None,
                    "parsed_at": datetime.utcnow().isoformat(),
                    "raw_text": None,
                    "bid_end": None,
                    "emd_amount": None
                }

                # render detail page to extract pdf link and fields, then download pdf
                if meta["detail_url"]:
                    try:
                        page.goto(meta["detail_url"], wait_until="networkidle", timeout=45000)
                        time.sleep(0.6)
                        html = page.content()
                        soup = BeautifulSoup(html, "html.parser")
                        # find pdf anchors
                        pdf_link = None
                        for a in soup.find_all("a", href=True):
                            h = a["href"]
                            if h.lower().endswith(".pdf") or "/showbidDocument/" in h or "/documentdownload/" in h or "download" in h:
                                pdf_link = urljoin(BASE_DOMAIN, h)
                                break
                        if pdf_link:
                            meta["pdf_url"] = pdf_link
                        # basic raw_text capture
                        meta["raw_text"] = soup.get_text(separator="\n")[:2000]
                    except Exception as e:
                        print("  detail page render error:", e)

                # if no pdf_url but cand had doc_id, attempt /showbidDocument/<id>
                if not meta["pdf_url"] and cand.get("doc_id"):
                    candidate_pdf = urljoin(BASE_DOMAIN, f"/showbidDocument/{cand['doc_id']}")
                    meta["pdf_url"] = candidate_pdf

                # attempt to download pdf using page.request.get (browser context)
                if meta.get("pdf_url"):
                    try:
                        resp = page.request.get(meta["pdf_url"], timeout=45000)
                        if resp.ok:
                            b = resp.body()
                            if b and (b[:4] == b"%PDF" or "pdf" in (resp.headers.get("content-type") or "").lower()):
                                sha = sha256_bytes(b)
                                fname = f"GEM_doc_{cand.get('doc_id')}_{sha[:10]}.pdf"
                                path = str(PDF_DIR / fname)
                                if not os.path.exists(path):
                                    with open(path, "wb") as fh:
                                        fh.write(b)
                                meta["pdf_path"] = path
                                meta["pdf_sha256"] = sha
                            else:
                                # not PDF
                                meta["pdf_url"] = None
                        else:
                            meta["pdf_url"] = None
                    except Exception as e:
                        print("   pdf download error:", e)
                        meta["pdf_url"] = None

                # persist tender meta
                cur.execute("""
                    INSERT OR REPLACE INTO tenders (gem_bid_id, title, detail_url, pdf_url, pdf_sha256, pdf_path, bid_end, emd_amount, raw_text, parsed_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (meta["gem_bid_id"], meta["title"], meta["detail_url"], meta["pdf_url"], meta["pdf_sha256"], meta["pdf_path"], meta["bid_end"], meta["emd_amount"], meta["raw_text"], meta["parsed_at"]))
                conn.commit()

                # if pdf downloaded, parse BOQ lines and store
                if meta.get("pdf_path"):
                    lines = extract_boq_lines_from_pdf(meta["pdf_path"])
                    for ln in lines:
                        cur.execute("""
                            INSERT INTO boq_lines (gem_bid_id, line_no, description, quantity, pdf_path, parsed_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                        """, (meta["gem_bid_id"], ln["line_no"], ln["description"], ln["quantity"], meta["pdf_path"], datetime.utcnow().isoformat()))
                        ln_id = cur.lastrowid
                        # compute sku matches
                        text_for_match = ln["description"]
                        matches = match_line(text_for_match, sku_df, top_k=3)
                        for m in matches:
                            cur.execute("""
                                INSERT INTO matches (boq_line_id, sku_id, sku_title, score, exact_match, matched_at)
                                VALUES (?, ?, ?, ?, ?, ?)
                            """, (ln_id, m["sku_id"], m["sku_title"], m["score"], m["exact"], datetime.utcnow().isoformat()))
                    conn.commit()

                new_count += 1
                time.sleep(REQUEST_SLEEP)
                if new_count >= max_new:
                    break

            if new_count >= max_new:
                break

        browser.close()
    conn.close()
    print("Done. new tenders processed:", new_count)

# ---------------------------
# CLI
# ---------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=2)
    parser.add_argument("--max-new", type=int, default=100)
    args = parser.parse_args()
    crawl_and_process(max_pages=args.pages, max_new=args.max_new)
