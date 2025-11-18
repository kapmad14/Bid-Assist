#!/usr/bin/env python3
"""
download_from_db.py

Attempts to download PDFs for tenders in today's DB that don't yet have a pdf_path.
Usage:
  python3 download_from_db.py --limit 20
"""
import sqlite3, hashlib, time, random, os, argparse, json
from pathlib import Path
from datetime import date, datetime, timezone
from urllib.parse import urljoin, urlparse
from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup

BASE = "https://bidplus.gem.gov.in"
DATA_DIR = Path("data")
DB_DIR = DATA_DIR / "db"
PDF_DIR = DATA_DIR / "pdfs"
BIDS_PDF_DIR = PDF_DIR / "bids"
RA_PDF_DIR = PDF_DIR / "ra"

# create dirs if missing
PDF_DIR.mkdir(parents=True, exist_ok=True)
BIDS_PDF_DIR.mkdir(parents=True, exist_ok=True)
RA_PDF_DIR.mkdir(parents=True, exist_ok=True)
DB_DIR.mkdir(parents=True, exist_ok=True)

USER_AGENT = "GeM-TriageBot/0.1 (+your-email@example.com)"
MIN_PDF_BYTES = 200        # small tolerance; raise if you want larger
REQUEST_SLEEP = 0.4

def sha256_bytes(b: bytes):
    import hashlib
    h = hashlib.sha256()
    h.update(b)
    return h.hexdigest()

def ensure_columns(conn):
    """
    Ensure the tenders table has the extra columns we rely on.
    """
    cur = conn.cursor()
    cur.execute("PRAGMA table_info('tenders')")
    cols = [r[1] for r in cur.fetchall()]
    extras = {
        "pdf_path": "TEXT",
        "pdf_sha256": "TEXT",
        "last_fail_reason": "TEXT",
        "downloaded_at": "TEXT"
    }
    for c, ctype in extras.items():
        if c not in cols:
            try:
                cur.execute(f"ALTER TABLE tenders ADD COLUMN {c} {ctype}")
                print("  [DB] added column", c)
            except Exception as e:
                print("  [DB] failed to add column", c, e)
    conn.commit()

def save_pdf_bytes(b: bytes, docid: str, gem_bid: str):
    """
    Save bytes into either bids/ or ra/ subfolder depending on gem_bid (contains '/R/' or '/B/').
    Returns (path_str, sha)
    """
    sha = sha256_bytes(b)
    fname = f"GEM_doc_{docid}_{sha[:10]}.pdf"
    # choose folder by gem_bid
    is_ra = False
    if gem_bid and "/R/" in gem_bid:
        is_ra = True
    out_dir = RA_PDF_DIR if is_ra else BIDS_PDF_DIR
    outp = out_dir / fname
    outp.write_bytes(b)
    return str(outp), sha

def try_get_as_pdf(request_api, url, headers):
    """
    Try a simple GET via page.request and check if response is a PDF.
    Returns bytes if looks like a PDF, else None.
    """
    try:
        resp = request_api.get(url, headers=headers, timeout=60000)
        status = resp.status
        body = resp.body() if resp.ok else b""
        blen = len(body) if body else 0
        ctype = resp.headers.get("content-type","")
        print(f"    GET {url} -> status {status} bytes={blen} ctype={ctype}")
        if status == 200 and blen >= MIN_PDF_BYTES and (body.startswith(b"%PDF") or "pdf" in ctype.lower()):
            return body
        return None
    except Exception as e:
        print("    GET error", e)
        return None

def find_pdf_anchors_from_html(html, base):
    """
    Parse HTML and return candidate anchor hrefs that may point to PDFs.
    """
    soup = BeautifulSoup(html, "html.parser")
    anchors = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        href_full = href if href.startswith("http") else urljoin(base, href)
        low = href_full.lower()
        if (low.endswith(".pdf")
            or "showbiddocument" in low
            or "showradocumentpdf" in low
            or "list-ra-schedules" in low):
            anchors.append(href_full)
    # de-duplicate preserving order
    return list(dict.fromkeys(anchors))

def download_for_row(browser, page, request_api, gem_bid, doc_id, detail_url):
    """
    Attempt to download PDF for one database row.
    Returns (pdf_path, sha) on success, or (None, None) on failure.
    Strategy:
      1) direct GET to known endpoints (showbidDocument, showradocumentPdf, list-ra-schedules)
      2) fetch detail page HTML + parse anchors for PDFs or show* endpoints
      3) Playwright fallback: create a fresh context (optionally using storage_state.json),
         go to detail page, click anchors that look promising and capture PDF responses.
    """
    # candidate URLs to try in order
    candidates = []
    if doc_id:
        candidates.append(urljoin(BASE, f"/showbidDocument/{doc_id}"))
        candidates.append(urljoin(BASE, f"/showradocumentPdf/{doc_id}"))
        candidates.append(urljoin(BASE, f"/list-ra-schedules/{doc_id}"))
    if detail_url:
        candidates.append(detail_url)
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/pdf,application/octet-stream,*/*",
        "Referer": detail_url or (BASE + "/all-bids")
    }

    # 1) direct GET attempts for showbid/showra/list-ra (fast path)
    for c in candidates[:3]:
        if not c:
            continue
        body = try_get_as_pdf(request_api, c, headers)
        if body:
            return save_pdf_bytes(body, doc_id or gem_bid, gem_bid)

    # 2) if detail_url present, fetch HTML and parse pdf anchors (fast)
    if detail_url:
        try:
            resp = request_api.get(detail_url, headers={"User-Agent":USER_AGENT, "Accept":"text/html"}, timeout=30000)
            html = resp.text() or ""
            anchors = find_pdf_anchors_from_html(html, detail_url)
            if anchors:
                for a in anchors:
                    body = try_get_as_pdf(request_api, a, headers)
                    if body:
                        return save_pdf_bytes(body, doc_id or gem_bid, gem_bid)
        except Exception as e:
            print("    error fetching/parsing detail page:", e)

    # 3) Playwright-based fallback (browser-style navigation + click)
    #    Some showradocumentPdf endpoints return a short HTML unless accessed via a browser sequence.
    try:
        # Use storage_state if file exists to preserve cookies/session captured earlier
        storage_state_path = DATA_DIR / "storage_state.json"
        storage_state_kw = {}
        if storage_state_path.exists():
            storage_state_kw["storage_state"] = str(storage_state_path)
            print("    Playwright fallback: using storage_state.json for browser context")
        else:
            print("    Playwright fallback: no storage_state.json, creating fresh context")

        # create a temporary new context (safer than reusing the existing 'page' context)
        ctx = browser.new_context(user_agent=USER_AGENT, **storage_state_kw)
        tmp_page = ctx.new_page()

        pdf_resp = None

        # response handler tries to capture pdf-like responses
        def _resp_handler(response):
            nonlocal pdf_resp
            try:
                url = response.url
                ct = (response.headers.get("content-type") or "").lower()
                lowurl = url.lower()
                # if URL has the known patterns or is .pdf and content-type contains pdf, capture it
                if (("showradocumentpdf" in lowurl or "showbiddocument" in lowurl or lowurl.endswith(".pdf"))
                        and ("pdf" in ct or response.status == 200)):
                    pdf_resp = response
            except Exception:
                pass

        tmp_page.on("response", _resp_handler)

        # 3a) visit detail page (often primes cookies/JS)
        if detail_url:
            try:
                tmp_page.goto(detail_url, wait_until="networkidle", timeout=20000)
            except Exception:
                # ignore navigation timeout, still try subsequent steps
                pass

        # 3b) scan anchors and click ones that look promising
        try:
            anchors = tmp_page.query_selector_all("a")
            for a in anchors:
                try:
                    href = a.get_attribute("href") or ""
                    lowhref = href.lower()
                    if ("showradocumentpdf" in lowhref) or ("showbiddocument" in lowhref) or lowhref.endswith(".pdf"):
                        # attempt click (some links trigger the PDF response)
                        try:
                            a.click(timeout=5000)
                        except Exception:
                            # sometimes click fails due to visibility; try direct goto
                            try:
                                tmp_page.goto(urljoin(detail_url or BASE, href), wait_until="networkidle", timeout=10000)
                            except Exception:
                                pass
                        # brief wait for responses to arrive and handler to capture
                        tmp_page.wait_for_timeout(500)
                        if pdf_resp:
                            break
                except Exception:
                    continue
        except Exception:
            pass

        # 3c) fallback: directly navigate to showradocumentPdf/{doc_id}
        if not pdf_resp and doc_id:
            try:
                pdf_direct = f"{BASE}/showradocumentPdf/{doc_id}"
                resp = tmp_page.goto(pdf_direct, wait_until="networkidle", timeout=15000)
                if resp:
                    ct = (resp.headers.get("content-type") or "").lower()
                    # if direct navigation produced a pdf-like response, capture it
                    if "pdf" in ct or resp.status == 200:
                        pdf_resp = resp
            except Exception:
                pass

        # If we captured a response that looks like PDF, write it out
        if pdf_resp:
            try:
                body = pdf_resp.body()
                if body and len(body) >= MIN_PDF_BYTES and body.startswith(b"%PDF"):
                    outp = save_pdf_bytes(body, doc_id or gem_bid, gem_bid)
                    try:
                        tmp_page.close()
                    except:
                        pass
                    try:
                        ctx.close()
                    except:
                        pass
                    return outp
                else:
                    # if body small but content-type says pdf, still try saving (some servers send wrapper)
                    if body and len(body) >= MIN_PDF_BYTES:
                        outp = save_pdf_bytes(body, doc_id or gem_bid, gem_bid)
                        try:
                            tmp_page.close()
                        except:
                            pass
                        try:
                            ctx.close()
                        except:
                            pass
                        return outp
            except Exception as e:
                print("    Playwright capture -> error reading body:", e)

        # cleanup
        try:
            tmp_page.close()
        except:
            pass
        try:
            ctx.close()
        except:
            pass

    except Exception as e:
        print("    Playwright fallback error:", e)

    # nothing worked
    return None, None

def main(limit=None, today=None):
    today = today or date.today().isoformat()
    db_path = DB_DIR / f"{today}.db"
    if not db_path.exists():
        print("DB not found:", db_path)
        return

    conn = sqlite3.connect(str(db_path))
    ensure_columns(conn)
    cur = conn.cursor()
    # select rows that still need PDF
    cur.execute("SELECT gem_bid_id, doc_id, detail_url FROM tenders WHERE (pdf_path IS NULL OR pdf_path='') LIMIT ?", (limit or -1,))
    rows = cur.fetchall()
    if not rows:
        print("No candidates found to download.")
        return

    print("Found", len(rows), "candidates (limit):", limit)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # create a starting context & page so we can use page.request (fast GETs)
        context = browser.new_context(user_agent=USER_AGENT)
        page = context.new_page()
        request_api = page.request

        succeeded = 0
        failed = 0
        for gem_bid, doc_id, detail_url in rows:
            print("->", gem_bid, "doc_id:", doc_id, "detail:", detail_url)
            # small politeness sleep
            time_sleep = REQUEST_SLEEP + random.random()*0.6
            time.sleep(time_sleep)
            outp, sha = None, None
            try:
                outp, sha = download_for_row(browser, page, request_api, gem_bid, doc_id, detail_url)
            except Exception as e:
                print("  download_for_row exception:", e)
            now = datetime.now(timezone.utc).isoformat()
            if outp and sha:
                try:
                    cur.execute("UPDATE tenders SET pdf_path=?, pdf_sha256=?, downloaded_at=?, last_fail_reason=NULL WHERE gem_bid_id=?",
                                (outp, sha, now, gem_bid))
                    conn.commit()
                    print("  saved ->", outp)
                    succeeded += 1
                except Exception as e:
                    print("  DB update error:", e)
            else:
                try:
                    cur.execute("UPDATE tenders SET last_fail_reason=?, downloaded_at=? WHERE gem_bid_id=?",
                                ("download-failed", now, gem_bid))
                    conn.commit()
                except Exception:
                    pass
                print("  failed to download for", gem_bid)
                failed += 1

        try:
            page.close()
        except:
            pass
        try:
            context.close()
        except:
            pass
        try:
            browser.close()
        except:
            pass

    print("Done. succeeded:", succeeded, "failed:", failed)
    conn.close()

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--date", type=str, default=None, help="YYYY-MM-DD override for DB file")
    args = ap.parse_args()
    main(limit=args.limit, today=args.date)
