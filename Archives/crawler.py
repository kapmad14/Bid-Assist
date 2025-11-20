#!/usr/bin/env python3
"""
crawler.py — consolidated GeM crawl + download + BOQ parse + SKU match pipeline
(Updated: pagewise capture + robust form-encoded POST replay + CSRF reuse + JSON replay + cookie header)
"""
import argparse
import json
import re
import time
import os
import sqlite3
import hashlib
import random
import csv
import urllib.parse
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from tqdm import tqdm

# optional fuzzy library
try:
    from rapidfuzz.fuzz import token_sort_ratio
    HAS_RAPIDFUZZ = True
except Exception:
    HAS_RAPIDFUZZ = False

import pdfplumber
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

import pandas as pd
from difflib import SequenceMatcher

# ---------------------------
# Config (tune as needed)
# ---------------------------
BASE = "https://bidplus.gem.gov.in"
LISTING_PATH = "/all-bids"
API_PATH = "/all-bids-data"
USER_AGENT = "GeM-TriageBot/0.1 (+your-email@example.com)"

DATA_DIR = Path("data")
PDF_DIR = DATA_DIR / "pdfs"
DB_PATH = DATA_DIR / "tenders.db"
SKU_CSV = "dummy_skus.csv"
STORAGE_STATE = DATA_DIR / "storage_state.json"

# tolerances
MIN_PDF_BYTES = 80
REQUEST_SLEEP = 0.6
RETRIES = 2
PAGE_XHR_WAIT = 1.2
DOWNLOAD_TIMEOUT = 90_000  # ms
TARGET_PER_PAGE = 10

# Ensure dirs
DATA_DIR.mkdir(exist_ok=True)
PDF_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "listings").mkdir(parents=True, exist_ok=True)

# ---------------------------
# DB helpers & schema
# ---------------------------
def connect_db():
    conn = sqlite3.connect(DB_PATH)
    return conn

def init_db(conn):
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS tenders (
        id INTEGER PRIMARY KEY,
        gem_bid_id TEXT UNIQUE,
        doc_id TEXT,
        title TEXT,
        detail_url TEXT,
        pdf_url TEXT,
        pdf_path TEXT,
        pdf_sha256 TEXT,
        parsed_at TEXT,
        last_fail_reason TEXT,
        is_reverse INTEGER DEFAULT 0,
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
        parsed_at TEXT
    )""")
    cur.execute("""
    CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY,
        boq_line_id INTEGER,
        sku_id TEXT,
        sku_title TEXT,
        score REAL,
        exact_match INTEGER,
        matched_at TEXT
    )""")
    cur.execute("""
    CREATE TABLE IF NOT EXISTS page_runs (
        id INTEGER PRIMARY KEY,
        run_ts TEXT,
        max_pages INTEGER,
        headful INTEGER,
        note TEXT
    )""")
    cur.execute("""
    CREATE TABLE IF NOT EXISTS page_captures (
        id INTEGER PRIMARY KEY,
        run_id INTEGER,
        run_ts TEXT,
        page_num INTEGER,
        capture_file TEXT,
        num_docs INTEGER,
        unique_docs INTEGER,
        downloaded_count INTEGER DEFAULT 0,
        note TEXT
    )""")
    cur.execute("""
    CREATE TABLE IF NOT EXISTS page_docs (
        id INTEGER PRIMARY KEY,
        run_id INTEGER,
        page_num INTEGER,
        doc_id TEXT,
        gem_bid_id TEXT,
        title TEXT,
        detail_url TEXT,
        captured_file TEXT,
        downloaded INTEGER DEFAULT 0,
        pdf_path TEXT
    )""")
    conn.commit()

def safe_norm(v):
    if v is None:
        return None
    if isinstance(v, (list, tuple)):
        try:
            return " | ".join([str(x) for x in v if x is not None])
        except Exception:
            return str(v)
    return str(v)

def sha256_bytes(b: bytes) -> str:
    h = hashlib.sha256()
    h.update(b)
    return h.hexdigest()

# ---------------------------
# SKU / fuzzy helpers
# ---------------------------
def load_skus(csv_path=SKU_CSV):
    if not Path(csv_path).exists():
        print("Warning: SKU CSV not found:", csv_path, " -> continuing with empty SKU set")
        return pd.DataFrame(columns=["sku_id","title"])
    df = pd.read_csv(csv_path, dtype=str).fillna("")
    if "sku_id" not in df.columns:
        df["sku_id"] = df.index.astype(str)
    if "title" not in df.columns:
        df["title"] = df.iloc[:,0].astype(str)
    return df

def fuzzy_score(a,b):
    if not a or not b: return 0.0
    if HAS_RAPIDFUZZ:
        try:
            return token_sort_ratio(a, b)/100.0
        except Exception:
            pass
    return SequenceMatcher(None, str(a).lower(), str(b).lower()).ratio()

def top_matches_for_text(text, sku_df, top_k=3):
    scores = []
    for _, row in sku_df.iterrows():
        sku_id = row.get("sku_id","")
        title = row.get("title","")
        sc = fuzzy_score(text, title)
        exact = 1 if title and title.lower() in (text or "").lower() else 0
        scores.append((sku_id, title, sc, exact))
    scores.sort(key=lambda x: (not x[3], -x[2]))
    out = [{"sku_id": s[0], "sku_title": s[1], "score": round(s[2],3), "exact": int(s[3])} for s in scores[:top_k]]
    return out

# ---------------------------
# PDF parsing heuristics
# ---------------------------
def extract_boq_lines_from_pdf(pdf_path):
    rows = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            line_idx = 1
            for page in pdf.pages:
                try:
                    tables = page.extract_tables()
                except Exception:
                    tables = []
                for t in (tables or []):
                    if not t: continue
                    if len(t) > 1:
                        for r in t[1:]:
                            cells = [str(c).strip() for c in r if c and str(c).strip()]
                            desc = " | ".join(cells[:3]) if cells else ""
                            qty = None
                            for cell in r:
                                if cell:
                                    mm = re.search(r"([0-9,]{1,10})\b", str(cell).replace(",",""))
                                    if mm:
                                        try:
                                            qty = int(mm.group(1).replace(",",""))
                                            break
                                        except:
                                            qty = None
                            rows.append({"line_no": line_idx, "description": desc[:800], "quantity": qty})
                            line_idx += 1
                try:
                    text = page.extract_text() or ""
                except Exception:
                    text = ""
                for ln in text.splitlines():
                    ln = ln.strip()
                    if len(ln) < 8: continue
                    if re.search(r"\b[0-9,]{2,}\b", ln):
                        m = re.search(r"([0-9,]{1,10})\s*(?:Nos?|Pieces|Pcs|Qty|Quantity|Sets?)", ln, re.IGNORECASE)
                        if not m:
                            m = re.search(r"\b([0-9,]{1,10})\b", ln)
                        qty = int(m.group(1).replace(",","")) if m else None
                        rows.append({"line_no": line_idx, "description": ln[:800], "quantity": qty})
                        line_idx += 1
    except Exception as e:
        print("pdf parse error", pdf_path, e)
    return rows

# ---------------------------
# extracting ids from docs
# ---------------------------
def extract_docid_and_bid(d):
    doc_id = None
    gem_bid = None
    if d.get("id"):
        doc_id = str(d.get("id"))
    b_id = d.get("b_id")
    if not doc_id and b_id:
        if isinstance(b_id, (list,tuple)) and b_id:
            doc_id = str(b_id[0])
        else:
            doc_id = str(b_id)
    if isinstance(d.get("b_bid_number"), (list,tuple)):
        gem_bid = d.get("b_bid_number")[0] if d.get("b_bid_number") else None
    else:
        gem_bid = d.get("b_bid_number") or d.get("bidnumber") or d.get("b_bid_no")
    if gem_bid:
        gem_bid = str(gem_bid)
    return doc_id, gem_bid

# ---------------------------
# Helpers for POST replay / CSRF / cookies
# ---------------------------
def parse_captured_post_data(post_data_raw):
    if not post_data_raw:
        return None, None, {}
    s = post_data_raw.strip()
    if s.startswith("{") or s.startswith("["):
        try:
            parsed = json.loads(s)
            return parsed, None, {}
        except Exception:
            pass
    try:
        qs = urllib.parse.parse_qs(post_data_raw, keep_blank_values=True)
        payload_val = None
        csrf_val = None
        extra = {}
        if "payload" in qs:
            payload_val = qs.get("payload")[0]
            try:
                parsed_payload = json.loads(payload_val)
            except Exception:
                try:
                    un = urllib.parse.unquote(payload_val)
                    parsed_payload = json.loads(un)
                except Exception:
                    parsed_payload = None
            if parsed_payload is not None:
                payload = parsed_payload
            else:
                payload = None
        else:
            payload = None
        for key in ("csrf_bd_gem_nk", "csrf_gem_nk", "csrf_gem_cookie"):
            if key in qs:
                csrf_val = qs.get(key)[0]
                break
        for k, v in qs.items():
            if k not in ("payload", "csrf_bd_gem_nk", "csrf_gem_nk", "csrf_gem_cookie"):
                extra[k] = v
        return payload, csrf_val, extra
    except Exception:
        return None, None, {}

def get_csrf_token_from_page(page):
    try:
        cookie_list = page.context.cookies()
        for c in cookie_list:
            name = c.get("name", "").lower()
            if name.startswith("csrf"):
                return c.get("value")
    except Exception:
        pass
    try:
        html = page.content()
        m = re.search(r"csrf_bd_gem_nk[\"']?\s*[:=]\s*[\"']?([a-f0-9]{6,})[\"']?", html, re.IGNORECASE)
        if m:
            return m.group(1)
        m2 = re.search(r'name=["\']csrf_bd_gem_nk["\']\s+value=["\']([^"\']+)["\']', html, re.IGNORECASE)
        if m2:
            return m2.group(1)
    except Exception:
        pass
    return None

def build_form_body_from_payload(payload_dict, csrf_token=None):
    if not isinstance(payload_dict, dict):
        payload_dict = {"param": {"searchBid": "", "searchType": "fullText"}, "filter": {"bidStatusType": "ongoing_bids", "byType": "all", "highBidValue": "", "byEndDate": {"from": "", "to": ""}, "sort": "Bid-End-Date-Oldest"}}
    payload_json = json.dumps(payload_dict, separators=(",", ":"))
    form = {"payload": payload_json}
    if csrf_token:
        form["csrf_bd_gem_nk"] = csrf_token
    return urllib.parse.urlencode(form)

def build_cookie_header_from_context(page):
    try:
        cks = page.context.cookies()
        if not cks: return None
        pairs = []
        for c in cks:
            name = c.get("name"); value = c.get("value")
            if name and value is not None:
                pairs.append(f"{name}={value}")
        return "; ".join(pairs) if pairs else None
    except Exception:
        return None

# ---------------------------
# Listing XHR capture & DB upsert
# ---------------------------
def capture_listing_xhr_and_upsert(page, conn, page_num=1, run_id=None, seen_docs=None, target_per_page=TARGET_PER_PAGE):
    import time, json
    cur = conn.cursor()
    updated = 0
    docs_arr = []
    saved_capture_fname = None

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "listings").mkdir(parents=True, exist_ok=True)
    list_fragment_url = f"{BASE}{LISTING_PATH}#page-{page_num}"
    api_url = urljoin(BASE, API_PATH)

    captured_reqs = []
    captured_resps = []

    def on_request(req):
        try:
            u = req.url
            if API_PATH in u or "/all-bids-data" in u:
                pd = None
                try:
                    pd = req.post_data
                except Exception:
                    pd = None
                captured_reqs.append({"url": u, "method": req.method, "headers": dict(req.headers), "post_data": pd})
                print(f"   [REQ-CAP] {req.method} {u} post_len={(len(pd) if pd else 0)}")
        except Exception:
            pass

    def on_response(resp):
        try:
            u = resp.url
            if API_PATH in u or "/all-bids-data" in u:
                status = resp.status
                try:
                    txt = resp.text()
                except Exception:
                    try:
                        b = resp.body() or b""
                        txt = b.decode("utf-8", errors="ignore")
                    except Exception:
                        txt = ""
                captured_resps.append({"url": u, "status": status, "text": txt})
                print(f"   [RESP-CAP] {u} status={status} text_len={len(txt) if txt else 0}")
        except Exception:
            pass

    try:
        page.on("request", on_request)
    except Exception:
        pass
    try:
        page.on("response", on_response)
    except Exception:
        pass

    # initial page load + hash change
    try:
        page.goto(f"{BASE}{LISTING_PATH}", wait_until="networkidle", timeout=30000)
    except Exception:
        try:
            page.goto(f"{BASE}{LISTING_PATH}", wait_until="domcontentloaded", timeout=20000)
        except Exception:
            pass

    try:
        page.evaluate(f"() => {{ location.hash = '#page-{page_num}'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}")
    except Exception:
        try:
            page.evaluate(f"() => {{ location.hash = '#page-{page_num}'; }}")
        except Exception:
            pass

    # wait for XHRs
    waited = 0.0
    while waited < PAGE_XHR_WAIT:
        if captured_resps:
            break
        time.sleep(0.25)
        waited += 0.25

    # Save captured responses if any
    if captured_resps:
        for idx, cap in enumerate(captured_resps, start=1):
            try:
                parsed = None
                try:
                    parsed = json.loads(cap["text"]) if cap.get("text") else None
                except Exception:
                    parsed = None
                if parsed:
                    fname = DATA_DIR / "listings" / f"page_{page_num}_resp_{idx}.json"
                    with open(fname, "w", encoding="utf-8") as fh:
                        json.dump(parsed, fh, indent=2, ensure_ascii=False)
                    saved_capture_fname = str(fname)
                else:
                    fname = DATA_DIR / "listings" / f"page_{page_num}_resp_{idx}.txt"
                    with open(fname, "w", encoding="utf-8") as fh:
                        fh.write(cap.get("text") or "")
                    saved_capture_fname = str(fname)
                print("   [DEBUG] saved captured response ->", fname)
            except Exception as e:
                print("   [DEBUG] saving captured response failed:", e)

    # Save captured requests
    for idx, r in enumerate(captured_reqs, start=1):
        try:
            fname = DATA_DIR / "listings" / f"page_{page_num}_req_{idx}.json"
            with open(fname, "w", encoding="utf-8") as fh:
                json.dump(r, fh, indent=2, ensure_ascii=False)
            print("   [DEBUG] saved captured request ->", fname)
        except Exception as e:
            print("   [DEBUG] saving captured request failed:", e)

    # Try replaying captured requests (preferred) -- patch page/start
    replay_saved = None
    for r in captured_reqs:
        pd_raw = r.get("post_data")
        if not pd_raw:
            continue
        parsed_payload, csrf_token_in_body, extra = parse_captured_post_data(pd_raw)
        csrf_token = csrf_token_in_body or get_csrf_token_from_page(page)
        cookie_header = build_cookie_header_from_context(page)

        # If parsed_payload exists (dict), try JSON first (with cookie header), then form fallback
        if isinstance(parsed_payload, dict):
            # patch pagination
            if "start" in parsed_payload:
                try:
                    rows = int(parsed_payload.get("rows", 10))
                except Exception:
                    rows = 10
                parsed_payload["start"] = (page_num - 1) * rows
            elif "page" in parsed_payload:
                parsed_payload["page"] = page_num
            else:
                parsed_payload["start"] = (page_num - 1) * (parsed_payload.get("rows") or 10)

            # Attempt A: raw JSON replay (preferred)
            try:
                json_body = json.dumps(parsed_payload, separators=(",", ":"))
                headers_json = dict(r.get("headers") or {})
                # normalize and set minimal/explicit headers
                headers_json.update({
                    "Content-Type": "application/json; charset=UTF-8",
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": list_fragment_url,
                    "User-Agent": USER_AGENT
                })
                if cookie_header:
                    headers_json["Cookie"] = cookie_header
                # send JSON
                resp = page.request.post(api_url, data=json_body, headers=headers_json, timeout=30000)
                txt = resp.text()
                pf = DATA_DIR / "listings" / f"page_{page_num}_resp_replay.json"
                pf.write_text(txt or "", encoding="utf-8")
                rf = DATA_DIR / "listings" / f"page_{page_num}_req_replay.json"
                rf.write_text(json.dumps({"url": api_url, "method": "POST", "headers": headers_json, "post_data": parsed_payload}, indent=2), encoding="utf-8")
                print("   [REPLAY-JSON] saved replay response ->", pf)
                replay_saved = pf
                try:
                    j = json.loads(txt)
                    docs = (j.get("response", {}).get("response", {}).get("docs")
                            or j.get("response", {}).get("docs") or j.get("docs") or j.get("data"))
                    if docs and isinstance(docs, list):
                        docs_arr.extend(docs)
                        break
                except Exception:
                    pass
            except Exception as e:
                print("   [REPLAY-JSON] replay POST failed:", e)

            # short polite delay
            time.sleep(0.12 + random.random()*0.12)

            # Attempt B: form-encoded fallback (legacy)
            try:
                body = build_form_body_from_payload(parsed_payload, csrf_token)
                headers = dict(r.get("headers") or {})
                headers.update({"X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Referer": list_fragment_url, "User-Agent": USER_AGENT, "Accept": "application/json, text/javascript, */*; q=0.01"})
                if cookie_header:
                    headers["Cookie"] = cookie_header
                resp = page.request.post(api_url, data=body, headers=headers, timeout=30000)
                txt = resp.text()
                pf = DATA_DIR / "listings" / f"page_{page_num}_resp_replay.json"
                pf.write_text(txt or "", encoding="utf-8")
                rf = DATA_DIR / "listings" / f"page_{page_num}_req_replay.json"
                rf.write_text(json.dumps({"url": api_url, "method": "POST", "headers": headers, "post_data": parsed_payload}, indent=2), encoding="utf-8")
                print("   [REPLAY-FORM] saved replay response ->", pf)
                replay_saved = pf
                try:
                    j = json.loads(txt)
                    docs = (j.get("response", {}).get("response", {}).get("docs")
                            or j.get("response", {}).get("docs") or j.get("docs") or j.get("data"))
                    if docs and isinstance(docs, list):
                        docs_arr.extend(docs)
                        break
                except Exception:
                    pass
            except Exception as e:
                print("   [REPLAY-FORM] replay POST failed:", e)

        else:
            # try extracting payload=... substring then same logic
            try:
                m = re.search(r'payload=([^&]+)', pd_raw)
                if m:
                    payload_val = urllib.parse.unquote(m.group(1))
                    try:
                        parsed_payload2 = json.loads(payload_val)
                        if "start" in parsed_payload2:
                            rows = int(parsed_payload2.get("rows", 10))
                            parsed_payload2["start"] = (page_num - 1) * rows
                        elif "page" in parsed_payload2:
                            parsed_payload2["page"] = page_num
                        else:
                            parsed_payload2["start"] = (page_num - 1) * (parsed_payload2.get("rows") or 10)
                        csrf_token = csrf_token or get_csrf_token_from_page(page)
                        cookie_header = cookie_header or build_cookie_header_from_context(page)

                        # JSON try
                        try:
                            json_body = json.dumps(parsed_payload2, separators=(",", ":"))
                            headers_json = dict(r.get("headers") or {})
                            headers_json.update({
                                "Content-Type": "application/json; charset=UTF-8",
                                "Accept": "application/json, text/javascript, */*; q=0.01",
                                "X-Requested-With": "XMLHttpRequest",
                                "Referer": list_fragment_url,
                                "User-Agent": USER_AGENT
                            })
                            if cookie_header:
                                headers_json["Cookie"] = cookie_header
                            resp = page.request.post(api_url, data=json_body, headers=headers_json, timeout=30000)
                            txt = resp.text()
                            pf = DATA_DIR / "listings" / f"page_{page_num}_resp_replay.json"
                            pf.write_text(txt or "", encoding="utf-8")
                            rf = DATA_DIR / "listings" / f"page_{page_num}_req_replay.json"
                            rf.write_text(json.dumps({"url": api_url, "method": "POST", "headers": headers_json, "post_data": parsed_payload2}, indent=2), encoding="utf-8")
                            print("   [REPLAY-JSON(2)] saved replay response ->", pf)
                            replay_saved = pf
                            try:
                                j = json.loads(txt)
                                docs = (j.get("response", {}).get("response", {}).get("docs")
                                        or j.get("response", {}).get("docs") or j.get("docs") or j.get("data"))
                                if docs and isinstance(docs, list):
                                    docs_arr.extend(docs)
                                    break
                            except Exception:
                                pass
                        except Exception:
                            pass

                        time.sleep(0.12 + random.random()*0.12)

                        # Form fallback
                        try:
                            body = build_form_body_from_payload(parsed_payload2, csrf_token)
                            headers = dict(r.get("headers") or {})
                            headers.update({"X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Referer": list_fragment_url, "User-Agent": USER_AGENT, "Accept": "application/json, text/javascript, */*; q=0.01"})
                            if cookie_header:
                                headers["Cookie"] = cookie_header
                            resp = page.request.post(api_url, data=body, headers=headers, timeout=30000)
                            txt = resp.text()
                            pf = DATA_DIR / "listings" / f"page_{page_num}_resp_replay.json"
                            pf.write_text(txt or "", encoding="utf-8")
                            rf = DATA_DIR / "listings" / f"page_{page_num}_req_replay.json"
                            rf.write_text(json.dumps({"url": api_url, "method": "POST", "headers": headers, "post_data": parsed_payload2}, indent=2), encoding="utf-8")
                            print("   [REPLAY-FORM(2)] saved replay response ->", pf)
                            replay_saved = pf
                            try:
                                j = json.loads(txt)
                                docs = (j.get("response", {}).get("response", {}).get("docs")
                                        or j.get("response", {}).get("docs") or j.get("docs") or j.get("data"))
                                if docs and isinstance(docs, list):
                                    docs_arr.extend(docs)
                                    break
                            except Exception:
                                pass
                        except Exception:
                            pass
                    except Exception:
                        pass
            except Exception:
                pass

    # fallback: direct POST (try JSON first, then form)
    if not docs_arr:
        try:
            payload = {"page": page_num, "param": {"searchBid": "", "searchType": "fullText"},
                       "filter": {"bidStatusType": "ongoing_bids", "byType": "all", "highBidValue": "",
                                  "byEndDate": {"from": "", "to": ""}, "sort": "Bid-End-Date-Oldest"}}
            csrf_token = get_csrf_token_from_page(page)
            cookie_header = build_cookie_header_from_context(page)
            # JSON attempt
            try:
                headers_json = {"Content-Type": "application/json; charset=UTF-8", "Accept": "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest", "Referer": list_fragment_url, "User-Agent": USER_AGENT}
                if cookie_header:
                    headers_json["Cookie"] = cookie_header
                resp = page.request.post(api_url, data=json.dumps(payload), headers=headers_json, timeout=30000)
                txt = resp.text()
                pf = DATA_DIR / "listings" / f"page_{page_num}_resp_api_fallback.json"
                pf.write_text(txt or "", encoding="utf-8")
                rf = DATA_DIR / "listings" / f"page_{page_num}_req_api_fallback.json"
                rf.write_text(json.dumps({"url": api_url, "method": "POST", "headers": headers_json, "post_data": payload}, indent=2), encoding="utf-8")
                print("   [HTTP-API-fallback-JSON] saved ->", pf)
                try:
                    j = json.loads(txt)
                    docs = (j.get("response", {}).get("response", {}).get("docs")
                            or j.get("response", {}).get("docs") or j.get("docs") or j.get("data"))
                    if docs and isinstance(docs, list):
                        docs_arr.extend(docs)
                        saved_capture_fname = str(pf)
                except Exception:
                    pass
            except Exception:
                # form fallback
                try:
                    body = build_form_body_from_payload(payload, csrf_token)
                    headers = {"X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Referer": list_fragment_url, "User-Agent": USER_AGENT, "Accept": "application/json, text/javascript, */*; q=0.01"}
                    if cookie_header:
                        headers["Cookie"] = cookie_header
                    resp = page.request.post(api_url, data=body, headers=headers, timeout=30000)
                    txt = resp.text()
                    pf = DATA_DIR / "listings" / f"page_{page_num}_resp_api_fallback.json"
                    pf.write_text(txt or "", encoding="utf-8")
                    rf = DATA_DIR / "listings" / f"page_{page_num}_req_api_fallback.json"
                    rf.write_text(json.dumps({"url": api_url, "method": "POST", "headers": headers, "post_data": payload}, indent=2), encoding="utf-8")
                    print("   [HTTP-API-fallback-FORM] saved ->", pf)
                    try:
                        j = json.loads(txt)
                        docs = (j.get("response", {}).get("response", {}).get("docs")
                                or j.get("response", {}).get("docs") or j.get("docs") or j.get("data"))
                        if docs and isinstance(docs, list):
                            docs_arr.extend(docs)
                            saved_capture_fname = str(pf)
                    except Exception:
                        pass
                except Exception as e:
                    print("   [HTTP-API-fallback-FORM] failed:", e)
        except Exception as e:
            print("   [HTTP-API-fallback] direct POST failed:", e)

    # HTML fallback
    if not docs_arr:
        try:
            html = page.content()
            soup = BeautifulSoup(html, "html.parser")
            anchors = soup.select("a[href]")
            seen = set()
            for a in anchors:
                href = a.get("href") or ""
                m = re.search(r"/public-bid-other-details/(\d+)", href)
                if m:
                    docid = m.group(1)
                    if docid in seen:
                        continue
                    seen.add(docid)
                    pseudo = {"id": docid}
                    docs_arr.append(pseudo)
            if docs_arr:
                print(f"   [HTML-fallback] page {page_num} found {len(docs_arr)} anchors")
        except Exception as e:
            print("   [HTML-fallback] error:", e)

    if not docs_arr:
        print("   No listing JSON/anchors captured on page", page_num)
        cur.execute("INSERT INTO page_captures (run_id, run_ts, page_num, capture_file, num_docs, unique_docs, downloaded_count, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (run_id, datetime.now(timezone.utc).isoformat(), page_num, saved_capture_fname or None, 0, 0, 0, "no-capture"))
        conn.commit()
        return 0

    # dedupe
    unique = {}
    for d in docs_arr:
        key = None
        if d.get("id"):
            key = f"id:{d.get('id')}"
        else:
            bno = d.get("b_bid_number") or d.get("bidnumber") or d.get("b_bid_no")
            if isinstance(bno, (list,tuple)) and bno:
                bno = bno[0]
            key = f"bid:{bno}" if bno else None
        if not key:
            b_id = d.get("b_id")
            if isinstance(b_id, (list,tuple)) and b_id:
                key = f"id:{b_id[0]}"
            elif b_id:
                key = f"id:{b_id}"
        if not key:
            key = f"raw:{json.dumps(d, sort_keys=True)[:120]}"
        if key not in unique:
            unique[key] = d
    docs_arr = list(unique.values())

    # Save capture
    num_docs = len(docs_arr)
    unique_ids = {extract_docid_and_bid(d)[0] for d in docs_arr if extract_docid_and_bid(d)[0]}
    unique_count = len(unique_ids)
    cur.execute("INSERT INTO page_captures (run_id, run_ts, page_num, capture_file, num_docs, unique_docs, downloaded_count, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (run_id, datetime.now(timezone.utc).isoformat(), page_num, saved_capture_fname or None, num_docs, unique_count, 0, None))
    conn.commit()

    # Record page_docs
    for d in docs_arr:
        docid, gem_bid = extract_docid_and_bid(d)
        title_candidate = d.get("b_category_name") or d.get("bd_category_name") or d.get("b_bid_title") or None
        title = safe_norm(title_candidate) if title_candidate else None
        detail_field = d.get("detail_url") or d.get("detailPage") or None
        if isinstance(detail_field, (list,tuple)):
            detail_field = detail_field[0] if detail_field else None
        if detail_field:
            detail_url = urljoin(BASE, str(detail_field))
        else:
            detail_url = urljoin(BASE, f"/public-bid-other-details/{docid}") if docid else None

        cur.execute("INSERT INTO page_docs (run_id, page_num, doc_id, gem_bid_id, title, detail_url, captured_file, downloaded) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (run_id, page_num, str(docid) if docid else None, gem_bid, title, detail_url, saved_capture_fname or None, 0))
    conn.commit()

    # Choose up to target_per_page docs not in seen_docs
    chosen = []
    seen_docs = seen_docs or set()
    for d in docs_arr:
        docid, gem_bid = extract_docid_and_bid(d)
        key = docid or gem_bid
        if key and key not in seen_docs and len(chosen) < target_per_page:
            chosen.append(d)
            seen_docs.add(key)
    if len(chosen) < target_per_page:
        for d in docs_arr:
            if d in chosen:
                continue
            if len(chosen) >= target_per_page:
                break
            chosen.append(d)

    # Upsert chosen docs into tenders
    for d in chosen:
        bid_no = None
        if isinstance(d.get("b_bid_number"), (list, tuple)):
            bid_no = d.get("b_bid_number")[0] if d.get("b_bid_number") else None
        else:
            bid_no = d.get("b_bid_number") or d.get("bidnumber") or d.get("b_bid_no") or None

        doc_id = d.get("id")
        if not doc_id:
            b_id = d.get("b_id")
            if isinstance(b_id, (list,tuple)) and b_id:
                doc_id = b_id[0]
            else:
                doc_id = b_id

        title_candidate = d.get("b_category_name") or d.get("bd_category_name") or d.get("b_bid_title") or None
        title = safe_norm(title_candidate) if title_candidate else None

        detail_field = d.get("detail_url") or d.get("detailPage") or None
        if isinstance(detail_field, (list,tuple)):
            detail_field = detail_field[0] if detail_field else None
        if detail_field:
            detail_url = urljoin(BASE, str(detail_field))
        else:
            detail_url = urljoin(BASE, f"/public-bid-other-details/{doc_id}") if doc_id else None

        if not bid_no:
            if doc_id:
                bid_no = f"UNKNOWN/{doc_id}"
            else:
                continue

        bid_no = str(bid_no).strip()
        is_rev = 1 if "/R/" in bid_no.upper() else 0

        cur.execute("INSERT OR IGNORE INTO tenders (gem_bid_id, doc_id, title, detail_url, is_reverse, parsed_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (bid_no, str(doc_id) if doc_id else None, title, detail_url, is_rev, datetime.now(timezone.utc).isoformat()))
        cur.execute("UPDATE tenders SET doc_id = COALESCE(doc_id, ?), title = COALESCE(title, ?), detail_url = COALESCE(detail_url, ?) WHERE gem_bid_id = ?",
                    (str(doc_id) if doc_id else None, title, detail_url, bid_no))
        conn.commit()
        updated += 1

    return updated

# ---------------------------
# download_pdf_for_tender (unchanged)
# ---------------------------
def download_pdf_for_tender(page, gem_bid_id, detail_url, doc_id):
    def save_bytes_pdf(b: bytes, docid: str):
        sha = sha256_bytes(b)
        fname = f"GEM_doc_{docid}_{sha[:10]}.pdf"
        outp = PDF_DIR / fname
        outp.write_bytes(b)
        print("   saved PDF ->", outp, "size=", outp.stat().st_size)
        return str(outp), sha

    def save_download_obj(download_obj, docid: str):
        tmp = PDF_DIR / f"tmp_{docid}.pdf"
        try:
            download_obj.save_as(str(tmp))
            b = tmp.read_bytes()
            if not b:
                tmp.unlink(missing_ok=True)
                return None, None
            sha = sha256_bytes(b)
            final = PDF_DIR / f"GEM_doc_{docid}_{sha[:10]}.pdf"
            tmp.rename(final)
            print("   saved (download) ->", final, "size=", final.stat().st_size)
            return str(final), sha
        except Exception as e:
            print("   save_download_obj error:", e)
            try:
                tmp.unlink(missing_ok=True)
            except Exception:
                pass
            return None, None

    if detail_url:
        try:
            page.goto(detail_url, wait_until="networkidle", timeout=45000)
            time.sleep(0.3 + random.random()*0.4)
        except Exception as e:
            print("  warning: visiting detail_url:", e)

    is_reverse = None
    anchor_candidates = []
    try:
        html = page.content()
        m_bid = re.search(r'/showbidDocument/(\d{4,9})', html)
        m_ra  = re.search(r'/showradocumentPdf/(\d{4,9})', html, re.IGNORECASE)
        if m_bid:
            doc_id = doc_id or m_bid.group(1)
            is_reverse = 0 if is_reverse is None else is_reverse
        if m_ra:
            doc_id = doc_id or m_ra.group(1)
            is_reverse = 1
        soup = BeautifulSoup(html, "html.parser")
        for a in soup.find_all("a", href=True):
            h = a["href"]
            if "/showbidDocument/" in h or "/showradocumentPdf/" in h or h.lower().endswith(".pdf"):
                anchor_candidates.append(h if h.startswith("http") else urljoin(BASE, h))
    except Exception as e:
        print("   docid extraction error:", e)
        anchor_candidates = []

    if not doc_id and not anchor_candidates:
        print("   no doc_id or anchors available for", gem_bid_id)
        return None, None

    candidates = []
    if doc_id:
        if is_reverse == 1:
            candidates = [urljoin(BASE, f"/showradocumentPdf/{doc_id}"), urljoin(BASE, f"/showbidDocument/{doc_id}")]
        else:
            candidates = [urljoin(BASE, f"/showbidDocument/{doc_id}"), urljoin(BASE, f"/showradocumentPdf/{doc_id}")]
    for a in anchor_candidates:
        if a not in candidates:
            candidates.append(a)

    referer = detail_url if detail_url else urljoin(BASE, "/all-bids")
    base_headers = {
        "Referer": referer,
        "Origin": BASE,
        "Accept": "application/pdf,application/octet-stream,*/*",
        "User-Agent": USER_AGENT
    }

    # A: try background GETs
    for show_url in candidates:
        for attempt in range(1, RETRIES + 1):
            try:
                resp = page.request.get(show_url, headers=base_headers, timeout=60000)
                status = resp.status
                ctype = resp.headers.get("content-type","")
                try:
                    body = resp.body() if resp.ok else b""
                except Exception:
                    body = b""
                blen = len(body) if body else 0
                print(f"   attempt bg-request: status={status} ctype={ctype} bytes={blen} for url {show_url}")
                if status == 200 and blen >= MIN_PDF_BYTES and (body.startswith(b"%PDF") or "pdf" in ctype.lower()):
                    return save_bytes_pdf(body, doc_id or show_url.split("/")[-1])
                if blen > 0 and blen < MIN_PDF_BYTES:
                    dbg = PDF_DIR / f"debug_{doc_id or show_url.split('/')[-1]}_{show_url.split('/')[-1]}_bg.bin"
                    dbg.write_bytes(body)
                    print("   saved debug payload ->", dbg)
            except Exception as e:
                print("   bg-request error for", show_url, e)
            time.sleep(0.2 + random.random()*0.4)

    # B: anchor-click with expect_download
    try:
        anchors = page.query_selector_all("a[href]")
    except Exception:
        anchors = []
    for a in anchors:
        try:
            href = a.get_attribute("href")
        except Exception:
            href = None
        if not href:
            continue
        href_full = href if href.startswith("http") else urljoin(BASE, href)
        low = href_full.lower()
        if not (("showbiddocument" in low) or ("showradocumentpdf" in low) or low.endswith(".pdf")):
            continue
        try:
            ctx = page.context
            try:
                with page.expect_download(timeout=DOWNLOAD_TIMEOUT) as dl_info:
                    a.click()
                download_obj = dl_info.value
            except Exception:
                download_obj = None
                try:
                    download_obj = ctx.wait_for_event("download", timeout=5000)
                except Exception:
                    download_obj = None
            if download_obj:
                outp, sha = save_download_obj(download_obj, doc_id or href_full.split("/")[-1])
                if outp:
                    return outp, sha
        except Exception:
            pass

    # C: page.goto with expect_download
    for show_url in candidates:
        try:
            try:
                with page.expect_download(timeout=DOWNLOAD_TIMEOUT) as dl_info:
                    page.goto(show_url, timeout=DOWNLOAD_TIMEOUT)
                download_obj = dl_info.value
            except Exception:
                download_obj = None
                try:
                    download_obj = page.context.wait_for_event("download", timeout=8000)
                except Exception:
                    download_obj = None
            if download_obj:
                outp, sha = save_download_obj(download_obj, doc_id or show_url.split("/")[-1])
                if outp:
                    return outp, sha
        except PlaywrightTimeoutError as e:
            print("   navigation expect_download timed out for", show_url, e)
        except Exception as e:
            print("   navigation attempt error (expect_download) for", show_url, ":", e)

    # D: GET with extra headers
    for show_url in candidates:
        try:
            extra_headers = {
                "User-Agent": USER_AGENT,
                "Accept": "application/pdf,application/octet-stream,*/*",
                "Referer": referer,
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Dest": "document",
                "Accept-Language": "en-US,en;q=0.9",
            }
            resp = page.request.get(show_url, headers=extra_headers, timeout=60000)
            body = resp.body() if resp.ok else b""
            blen = len(body) if body else 0
            print(f"   attempt bg-request with extra headers: status={resp.status} ctype={resp.headers.get('content-type')} bytes={blen} for url {show_url}")
            if resp.ok and blen >= MIN_PDF_BYTES and (body.startswith(b"%PDF") or "pdf" in resp.headers.get("content-type","").lower()):
                return save_bytes_pdf(body, doc_id or show_url.split("/")[-1])
            if blen > 0:
                dbg = PDF_DIR / f"debug_{doc_id or show_url.split('/')[-1]}_extra_{show_url.split('/')[-1]}.bin"
                dbg.write_bytes(body)
                print("   saved debug payload ->", dbg)
        except Exception as e:
            print("   extra request error for", show_url, e)

    print("   all attempts failed for docid", doc_id)
    return None, None

# ---------------------------
# Main pipeline
# ---------------------------
def crawl_pipeline(max_pages=3, max_new=200, headful=False):
    conn = connect_db()
    init_db(conn)
    sku_df = load_skus(SKU_CSV)

    new_downloads = 0
    parsed_count = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=(not headful))
        if STORAGE_STATE.exists():
            context = browser.new_context(storage_state=str(STORAGE_STATE), user_agent=USER_AGENT)
            print("Loaded storage_state from", STORAGE_STATE)
        else:
            context = browser.new_context(user_agent=USER_AGENT)
        page = context.new_page()

        try:
            cur = conn.cursor()
            run_ts = datetime.now(timezone.utc).isoformat()
            cur.execute("INSERT INTO page_runs (run_ts, max_pages, headful, note) VALUES (?, ?, ?, ?)",
                        (run_ts, max_pages, int(bool(headful)), None))
            conn.commit()
            run_id = cur.lastrowid

            total_upserted = 0
            seen_docs = set()
            for pg in range(1, max_pages+1):
                print(f"[listing] rendering page {pg}")
                updated = capture_listing_xhr_and_upsert(page, conn, pg, run_id=run_id, seen_docs=seen_docs, target_per_page=TARGET_PER_PAGE)
                total_upserted += updated
                print("  upserted/updated", updated, "tenders from page", pg)

            cur.execute("SELECT gem_bid_id, doc_id, detail_url, pdf_path FROM tenders ORDER BY parsed_at DESC, created_at DESC")
            rows = cur.fetchall()
            candidates = []
            for gem, doc_id, detail_url, pdf_path in rows:
                need = False
                if not pdf_path:
                    need = True
                else:
                    pth = Path(pdf_path)
                    if not pth.exists() or pth.stat().st_size < MIN_PDF_BYTES:
                        need = True
                if need:
                    candidates.append((gem, doc_id, detail_url))
            print("Candidates needing PDF download:", len(candidates))

            for gem, doc_id, detail_url in tqdm(candidates[:max_new], desc="download"):
                time.sleep(REQUEST_SLEEP + random.random()*0.5)
                outp, sha = download_pdf_for_tender(page, gem, detail_url, doc_id)
                now = datetime.now(timezone.utc).isoformat()
                if outp and sha:
                    cur.execute("UPDATE tenders SET pdf_path=?, pdf_sha256=?, parsed_at=?, last_fail_reason=NULL WHERE gem_bid_id=?",
                                (outp, sha, now, gem))
                    conn.commit()
                    print("Saved & recorded:", gem, "->", outp)
                    new_downloads += 1
                    try:
                        cur.execute("UPDATE page_docs SET downloaded=1, pdf_path=? WHERE run_id=? AND (gem_bid_id=? OR doc_id=?)",
                                    (outp, run_id, gem, doc_id if doc_id else gem))
                        conn.commit()
                    except Exception:
                        pass
                else:
                    cur.execute("UPDATE tenders SET last_fail_reason=?, parsed_at=? WHERE gem_bid_id=?",
                                ("download-failed", now, gem))
                    conn.commit()
                    print("  failed to download for", gem)

            # update page_captures.downloaded_count
            try:
                cur.execute("SELECT page_num, COUNT(*) FROM page_docs WHERE run_id=? AND downloaded=1 GROUP BY page_num", (run_id,))
                rows = cur.fetchall()
                for page_num, cnt in rows:
                    cur.execute("UPDATE page_captures SET downloaded_count=? WHERE run_id=? AND page_num=?", (cnt, run_id, page_num))
                conn.commit()
            except Exception:
                pass

            # parse downloaded PDFs
            cur.execute("SELECT gem_bid_id, pdf_path FROM tenders WHERE pdf_path IS NOT NULL")
            downloaded = cur.fetchall()
            for gem, pdf_path in tqdm(downloaded, desc="parse"):
                cur.execute("SELECT 1 FROM boq_lines WHERE gem_bid_id = ? LIMIT 1", (gem,))
                if cur.fetchone():
                    continue
                if not pdf_path or not Path(pdf_path).exists():
                    continue
                lines = extract_boq_lines_from_pdf(pdf_path)
                if not lines:
                    print("  no lines extracted for", gem)
                    continue
                for ln in lines:
                    cur.execute("INSERT INTO boq_lines (gem_bid_id, line_no, description, quantity, pdf_path, parsed_at) VALUES (?, ?, ?, ?, ?, ?)",
                                (gem, ln["line_no"], ln["description"], ln["quantity"], pdf_path, datetime.now(timezone.utc).isoformat()))
                    ln_id = cur.lastrowid
                    mlist = top_matches_for_text(ln["description"], sku_df, top_k=3)
                    for m in mlist:
                        cur.execute("INSERT INTO matches (boq_line_id, sku_id, sku_title, score, exact_match, matched_at) VALUES (?, ?, ?, ?, ?, ?)",
                                    (ln_id, m["sku_id"], m["sku_title"], m["score"], m["exact"], datetime.now(timezone.utc).isoformat()))
                conn.commit()
                parsed_count += 1

            try:
                context.storage_state(path=str(STORAGE_STATE))
                print("Saved storage_state to", STORAGE_STATE)
            except Exception as e:
                print("Could not save storage_state:", e)

            try:
                csv_fp = DATA_DIR / "listings" / f"page_capture_summary_{run_ts.replace(':','').replace('+','')}.csv"
                with open(csv_fp, "w", newline="", encoding="utf-8") as csvf:
                    w = csv.writer(csvf)
                    w.writerow(["run_id","run_ts","page_num","capture_file","num_docs","unique_docs","downloaded_count"])
                    cur.execute("SELECT run_id, run_ts, page_num, capture_file, num_docs, unique_docs, downloaded_count FROM page_captures WHERE run_id=? ORDER BY page_num", (run_id,))
                    for row in cur.fetchall():
                        w.writerow(row)
                print("Wrote CSV summary ->", csv_fp)
            except Exception as e:
                print("Could not write CSV summary:", e)

        finally:
            try: page.close()
            except: pass
            try: context.close()
            except: pass
            try: browser.close()
            except: pass
            conn.close()

    print("Crawl done. New PDFs downloaded:", new_downloads, "Parsed PDFs:", parsed_count)

# ---------------------------
# CLI
# ---------------------------
if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=3, help="listing pages to scan")
    ap.add_argument("--max-new", type=int, default=200, help="max tenders to download in this run")
    ap.add_argument("--headful", action="store_true", help="run browser in headful mode (for debugging downloads)")
    args = ap.parse_args()
    print("Starting crawler: pages=", args.pages, "max-new=", args.max_new, "headful=", args.headful)
    crawl_pipeline(max_pages=args.pages, max_new=args.max_new, headful=args.headful)
