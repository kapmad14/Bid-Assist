#!/usr/bin/env python3
"""
Standalone single-file backfill tester:
- Downloads a per-bid JSON
- Resolves pdf sha via HEAD or streaming
- POSTs to rest/v1/tenders (or does dry-run)
"""

import os
import sys
import json
import hashlib
import requests
from urllib.parse import quote
from datetime import datetime

# CONFIG: set these env vars in the same command line or export them
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
BUCKET = os.environ.get("SUPABASE_BUCKET_NAME", os.environ.get("SUPABASE_BUCKET", "gem-pdfs"))

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Set SUPABASE_URL and SUPABASE_KEY in env.", file=sys.stderr)
    sys.exit(2)

AUTH_HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

# INPUTS - change these or pass via env
# Either set FILE_BASENAME to "GeM_051225_B_6757151" and PREFIX to the date folder,
# or set JSON_PATH and PDF_PATH to full storage object keys.
FILE_BASENAME = os.environ.get("SINGLE_BASENAME") or "GeM_051225_B_6757151"
JSON_PATH = os.environ.get("SINGLE_JSON_PATH") or f"daily_json_files/2025-12-05/{FILE_BASENAME}.json"
PDF_PATH = os.environ.get("SINGLE_PDF_PATH") or f"bids/2025-12-05/{FILE_BASENAME}.pdf"

DRY_RUN = os.environ.get("DRY_RUN", "1") != "0"

session = requests.Session()

def session_request(method, url, **kwargs):
    headers = kwargs.pop("headers", {})
    h = {**AUTH_HEADERS, **headers}
    return session.request(method, url, headers=h, timeout=30, **kwargs)

def download_json(path):
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{quote(path, safe='')}"
    r = session_request("GET", url, stream=True)
    if r.status_code != 200:
        print("JSON GET failed", r.status_code, r.text[:300])
        return None
    return r.content

def compute_sha_streaming_for_path(path):
    encodings = [lambda n: quote(n, safe=""), lambda n: n, lambda n: quote(n, safe="/")]
    for enc in encodings:
        p = enc(path)
        url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{p}"
        r = session_request("GET", url, stream=True)
        if r.status_code == 200:
            h = hashlib.sha256()
            total = 0
            for ch in r.iter_content(8192):
                if not ch: continue
                total += len(ch)
                h.update(ch)
            return h.hexdigest()
        elif r.status_code in (404, 400):
            continue
        else:
            print("GET returned", r.status_code, "for", path)
            continue
    return None

def head_for_xmeta(path):
    encodings = [lambda n: quote(n, safe=""), lambda n: n, lambda n: quote(n, safe="/")]
    for enc in encodings:
        p = enc(path)
        url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{p}"
        r = session_request("HEAD", url)
        if r.status_code == 200:
            return r.headers.get("x-meta-sha256")
        if r.status_code in (404,400):
            continue
    return None

def db_select_by_gem(gid):
    url = f"{SUPABASE_URL}/rest/v1/tenders"
    params = {"gem_bid_id": f"eq.{gid}", "select": "*"}
    r = session_request("GET", url, params=params)
    return r.status_code, r.text

def db_insert(payload):
    url = f"{SUPABASE_URL}/rest/v1/tenders"
    headers = {"Content-Type": "application/json", "Prefer": "return=representation"}
    if DRY_RUN:
        print("DRY-RUN payload:", json.dumps(payload, indent=2))
        return None
    r = session_request("POST", url, headers=headers, json=payload)
    print("INSERT status", r.status_code, r.text[:1000])
    return r

def extract_gem_bid_id_from_string(s: str):
    import re
    if not s: return None
    m = re.search(r"(?:\bB[_-]?\s?)(\d{5,})\b", s, re.IGNORECASE)
    if m:
        try:
            return int(m.group(1))
        except:
            pass
    nums = re.findall(r"\d{5,}", s)
    if nums:
        return int(nums[-1])
    return None

def main():
    print("Downloading JSON from path:", JSON_PATH)
    content = download_json(JSON_PATH)
    if not content:
        print("Failed to download JSON; aborting")
        return
    try:
        meta = json.loads(content.decode("utf-8"))
    except Exception as e:
        print("JSON parse failed:", e)
        return
    print("Parsed JSON keys:", list(meta.keys())[:20])

    gem_bid_id = None
    if meta.get("gem_bid_id"):
        try:
            gem_bid_id = int(meta.get("gem_bid_id"))
        except:
            gem_bid_id = None
    if gem_bid_id is None and meta.get("bid_number"):
        gem_bid_id = extract_gem_bid_id_from_string(str(meta.get("bid_number")))
    if gem_bid_id is None:
        # fallback from basename
        gem_bid_id = extract_gem_bid_id_from_string(FILE_BASENAME)
    print("Resolved gem_bid_id:", gem_bid_id)
    if gem_bid_id is None:
        print("No gem_bid_id; aborting")
        return

    # try x-meta via HEAD first
    print("HEAD for x-meta-sha256...")
    sha = head_for_xmeta(PDF_PATH)
    if sha:
        print("Found x-meta-sha256 via HEAD:", sha)
    else:
        print("No x-meta header. Streaming PDF to compute SHA256...")
        sha = compute_sha_streaming_for_path(PDF_PATH)
        print("Computed sha:", sha)

    payload = {
        "gem_bid_id": gem_bid_id,
        "bid_number": meta.get("bid_number") or meta.get("bidNo"),
        "detail_url": meta.get("detail_url") or meta.get("detailUrl"),
        "pdf_storage_path": PDF_PATH,
        "pdf_sha256": sha,
        "start_datetime": meta.get("start_datetime"),
        "item": meta.get("item"),
        "quantity": meta.get("quantity"),
        "department": meta.get("department"),
    }
    payload = {k:v for k,v in payload.items() if v is not None}
    print("Final payload keys:", list(payload.keys()))
    # try selecting existing row
    code, txt = db_select_by_gem(gem_bid_id)
    print("DB select status:", code)
    if code == 200:
        rows = json.loads(txt)
        if rows:
            print("Existing rows found (first):", json.dumps(rows[0], indent=2)[:1000])
        else:
            print("No existing rows; will insert (dry-run=%s)" % DRY_RUN)
            db_insert(payload)
    else:
        print("DB select returned non-200:", code, txt[:1000])

if __name__ == "__main__":
    main()
