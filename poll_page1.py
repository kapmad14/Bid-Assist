#!/usr/bin/env python3
"""
poll_page1.py — poll GeM page-1, append new docs to a daily sqlite DB (deduped).
Robust to existing DBs that might lack newer columns (auto-ALTERs).

Usage:
  python3 poll_page1.py
"""
import json
import time
import urllib.parse
import sqlite3
import atexit
import signal
import sys
from pathlib import Path
from datetime import datetime, timezone, date
from playwright.sync_api import sync_playwright
from urllib.parse import urljoin

# --------------------
# Config / paths
# --------------------
BASE = "https://bidplus.gem.gov.in"
API = "/all-bids-data"

DATA_DIR = Path("data")
LISTINGS_DIR = DATA_DIR / "listings"
DB_DIR = DATA_DIR / "db"
LISTINGS_DIR.mkdir(parents=True, exist_ok=True)
DB_DIR.mkdir(parents=True, exist_ok=True)

USER_AGENT = "GeM-TriageBot/0.1 (+your-email@example.com)"

REQ_TIMEOUT_MS = 30000

# --------------------
# Playwright reuse helpers
# --------------------
_playwright = None
_browser = None

def ensure_browser():
    """
    Start Playwright once and launch a single browser instance which is reused
    across poll invocations. This reduces repeated Chromium startup cost and
    memory spikes.
    """
    global _playwright, _browser
    if _playwright is None:
        _playwright = sync_playwright().start()
    if _browser is None:
        # If your environment needs it, add args=["--no-sandbox"] here.
        print("Launching shared Chromium browser for polling (one-time)...")
        _browser = _playwright.chromium.launch(headless=True)
    return _browser

def shutdown_browser():
    """
    Close browser and stop Playwright. Registered with atexit and SIG handlers.
    """
    global _playwright, _browser
    try:
        if _browser:
            try:
                _browser.close()
            except Exception:
                pass
    except Exception:
        pass
    try:
        if _playwright:
            try:
                _playwright.stop()
            except Exception:
                pass
    except Exception:
        pass
    _browser = None
    _playwright = None

# Ensure browser is shut down on process exit
atexit.register(shutdown_browser)

def _signal_handler(signum, frame):
    # close browser and exit cleanly on SIGINT/SIGTERM
    shutdown_browser()
    sys.exit(0)

signal.signal(signal.SIGINT, _signal_handler)
signal.signal(signal.SIGTERM, _signal_handler)

# --------------------
# Utility functions (unchanged)
# --------------------
def build_form_body(payload_dict, csrf_token=None):
    payload_json = json.dumps(payload_dict, separators=(",", ":"))
    form = {"payload": payload_json}
    if csrf_token:
        form["csrf_bd_gem_nk"] = csrf_token
    return urllib.parse.urlencode(form)

def try_get_csrf_from_cookies(context):
    try:
        for c in context.cookies():
            name = c.get("name","").lower()
            if name.startswith("csrf") or "csrf" in name:
                return c.get("value")
    except Exception:
        pass
    return None

def ensure_tenders_table(conn):
    """
    Ensure tenders table exists with these columns:
      gem_bid_id, doc_id, title, detail_url, capture_file, captured_at
    If table exists but columns missing, add them via ALTER TABLE.
    """
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tenders'")
    if not cur.fetchone():
        cur.execute("""
        CREATE TABLE tenders (
            id INTEGER PRIMARY KEY,
            gem_bid_id TEXT UNIQUE,
            doc_id TEXT,
            title TEXT,
            detail_url TEXT,
            capture_file TEXT,
            captured_at TEXT
        )""")
        conn.commit()
        return

    # check existing columns
    cur.execute("PRAGMA table_info('tenders')")
    cols = [r[1] for r in cur.fetchall()]  # second col is name
    required = {
        "gem_bid_id": "TEXT",
        "doc_id": "TEXT",
        "title": "TEXT",
        "detail_url": "TEXT",
        "capture_file": "TEXT",
        "captured_at": "TEXT"
    }
    for col, ctype in required.items():
        if col not in cols:
            try:
                cur.execute(f"ALTER TABLE tenders ADD COLUMN {col} {ctype}")
                print(f"  [DB] Added missing column: {col}")
            except Exception as e:
                print("  [DB] Failed to add column", col, e)
    conn.commit()

def init_db_for_date(db_path: Path):
    conn = sqlite3.connect(str(db_path))
    ensure_tenders_table(conn)
    return conn

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

def pretty_title(candidate):
    if not candidate:
        return None
    if isinstance(candidate, (list, tuple)):
        return " | ".join([str(x) for x in candidate if x])
    return str(candidate)

# --------------------
# Main polling logic (core behaviour preserved)
# --------------------
def poll_once_and_store():
    payload = {
        "page": 1,
        "param": {"searchBid": "", "searchType": "fullText"},
        "filter": {"bidStatusType": "ongoing_bids", "byType": "all", "highBidValue": "",
                   "byEndDate": {"from": "", "to": ""}, "sort": "Bid-Start-Date-Latest"}
    }

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    capture_fn = LISTINGS_DIR / f"page1_capture_{ts}.json"
    req_fn = LISTINGS_DIR / f"page1_capture_{ts}_req.json"

    today = date.today().isoformat()
    db_path = DB_DIR / f"{today}.db"

    conn = init_db_for_date(db_path)
    cur = conn.cursor()

    added = 0
    seen_total = 0

    # Reuse a single browser across calls to avoid repeated heavy launches
    try:
        browser = ensure_browser()
    except Exception as e:
        print("Failed to start/reuse browser:", e)
        conn.close()
        return 0, str(db_path)

    # create a context & page per invocation (lightweight)
    context = None
    page = None
    try:
        context = browser.new_context(user_agent=USER_AGENT)
        page = context.new_page()
        try:
            page.goto(BASE + "/all-bids", wait_until="networkidle", timeout=REQ_TIMEOUT_MS)
            time.sleep(0.6)
            csrf = try_get_csrf_from_cookies(context)
            if csrf:
                print("CSRF from cookie:", csrf[:8] + "...")
            else:
                print("No CSRF cookie found (continuing)")

            body = build_form_body(payload, csrf_token=csrf)
            headers = {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": BASE + "/all-bids",
                "User-Agent": USER_AGENT,
                "Accept": "application/json, text/javascript, */*; q=0.01"
            }
            resp = page.request.post(BASE + API, data=body, headers=headers, timeout=REQ_TIMEOUT_MS)
            txt = resp.text() or ""
            capture_fn.write_text(txt, encoding="utf-8")
            req_fn.write_text(json.dumps({"url": BASE+API, "headers": headers, "body_sample": (body[:200] + "...")}, indent=2), encoding="utf-8")
            print("Saved capture ->", capture_fn.name)

            try:
                j = json.loads(txt)
            except Exception as e:
                print("Response not JSON:", e)
                return 0, str(db_path)

            docs = (j.get("response", {}).get("response", {}).get("docs")
                    or j.get("response", {}).get("docs") or j.get("docs") or j.get("data"))

            if not isinstance(docs, list):
                print("No docs array in response (keys):", list(j.keys()))
                return 0, str(db_path)

            seen_total = len(docs)
            now = datetime.now(timezone.utc).isoformat()
            # ensure final table has required columns (in case state changed)
            ensure_tenders_table(conn)

            for d in docs:
                doc_id, gem_bid = extract_docid_and_bid(d)
                title_candidate = d.get("b_category_name") or d.get("bd_category_name") or d.get("b_bid_title") or None
                title = pretty_title(title_candidate)
                detail_field = d.get("detail_url") or d.get("detailPage") or None
                if isinstance(detail_field, (list,tuple)):
                    detail_field = detail_field[0] if detail_field else None
                detail_url = None
                if detail_field:
                    detail_url = urljoin(BASE, str(detail_field))
                else:
                    detail_url = urljoin(BASE, f"/public-bid-other-details/{doc_id}") if doc_id else None

                key = gem_bid or doc_id
                if not key:
                    continue
                try:
                    cur.execute("""INSERT OR IGNORE INTO tenders
                                   (gem_bid_id, doc_id, title, detail_url, capture_file, captured_at)
                                   VALUES (?, ?, ?, ?, ?, ?)""",
                                (gem_bid, doc_id, title, detail_url, str(capture_fn), now))
                    if cur.rowcount:
                        added += 1
                except sqlite3.OperationalError as e:
                    # if column missing despite attempts, print and continue
                    print("DB insert error for", key, e)
                except Exception as e:
                    print("DB insert error for", key, e)
            conn.commit()
            print(f"Poll result: total_docs={seen_total} added_new={added} DB={db_path.name}")

        finally:
            try:
                if page:
                    page.close()
            except:
                pass
            try:
                if context:
                    context.close()
            except:
                pass

    except Exception as e:
        print("Polling exception:", e)

    finally:
        conn.close()

    return added, str(db_path)

if __name__ == "__main__":
    added, dbname = poll_once_and_store()
    print("Done. New rows added:", added, "DB:", dbname)
