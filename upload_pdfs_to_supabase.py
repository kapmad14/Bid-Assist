#!/usr/bin/env python3
"""
upload_pdfs_to_supabase.py

Uploads local PDFs under data/pdfs to a Supabase storage bucket.
Ensures Content-Type=application/pdf by performing a PUT to the storage endpoint
after upload (this fixes the 'text/plain' issue).

Usage:
  set -a; source .env; set +a
  python3 upload_pdfs_to_supabase.py
  python3 upload_pdfs_to_supabase.py --overwrite
  python3 upload_pdfs_to_supabase.py --path "data/pdfs/ra/GEM_doc_8520891_1bac176772.pdf"
"""
import os
import sys
import time
import argparse
import urllib.parse
from pathlib import Path

import requests
from supabase import create_client

from dotenv import load_dotenv
load_dotenv()

# ---- config from env -------------------------------------------------------
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY_SERVICE = os.environ.get("SUPABASE_KEY_SERVICE") or os.environ.get("SUPABASE_KEY")
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET", "gem-pdfs")

if not SUPABASE_URL or not SUPABASE_KEY_SERVICE:
    print("❌ Missing SUPABASE_URL or SUPABASE_KEY_SERVICE (or SUPABASE_KEY) in environment.")
    print("Export them or run: set -a; source .env; set +a")
    sys.exit(2)

# ---- paths -----------------------------------------------------------------
ROOT = Path.cwd()
DATA_DIR = ROOT / "data"
PDF_DIR = DATA_DIR / "pdfs"

# ---- helper utilities -----------------------------------------------------
def build_public_url(bucket, remote_path):
    remote_enc = urllib.parse.quote(remote_path, safe="/~")
    return f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/{bucket}/{remote_enc}"

def find_local_pdfs():
    if not PDF_DIR.exists():
        return []
    files = []
    for p in sorted(PDF_DIR.rglob("*.pdf")):
        rel = p.relative_to(PDF_DIR)
        files.append((p, str(rel).replace("\\", "/")))
    return files

def put_with_content_type(remote_path, data_bytes, content_type="application/pdf"):
    """
    PUT raw bytes to Supabase storage endpoint with correct Content-Type.
    Uses service role key so it's allowed to write/overwrite.
    """
    remote_enc = urllib.parse.quote(remote_path, safe="/~")
    url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/{SUPABASE_BUCKET}/{remote_enc}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY_SERVICE}",
        "apikey": SUPABASE_KEY_SERVICE,
        "Content-Type": content_type,
        # using x-upsert true allows creating or overwriting the object in one call
        "x-upsert": "true",
    }
    try:
        r = requests.put(url, headers=headers, data=data_bytes, timeout=60)
        return r
    except Exception as e:
        return e

# ---- core upload logic ----------------------------------------------------
def upload_via_client_then_fix(client, local_path: Path, remote_path: str, overwrite=False):
    """
    Try upload via client API (for compatibility). After upload, ensure Content-Type using PUT.
    Returns (True, public_url) or (False, error).
    """
    bucket_api = client.storage.from_(SUPABASE_BUCKET)

    # attempt remove if overwrite requested
    if overwrite:
        try:
            bucket_api.remove([remote_path])
        except Exception:
            pass

    # read bytes
    try:
        data = local_path.read_bytes()
    except Exception as e:
        return False, f"read-error: {e}"

    # Try using client upload first (different supabase-py versions behave differently)
    upload_ok = False
    upload_err = None
    try:
        # Some client versions accept bytes, some want file-like. We'll try bytes first.
        res = bucket_api.upload(remote_path, data)
        # If res is a dict and indicates duplicate - treat as success
        if isinstance(res, dict):
            if res.get("statusCode") in (200, 201, 409) or res.get("error") is None:
                upload_ok = True
            else:
                # If dict contains 'error', treat as possible failure but continue to do PUT (fix)
                upload_err = res
        else:
            # Many versions return empty string or None for success; treat that as success
            upload_ok = True
    except Exception as e:
        # fallback: we'll still try PUT to ensure object is present
        upload_err = e

    # Ensure correct Content-Type by directly PUTting bytes to storage endpoint (this will also create/overwrite)
    r = put_with_content_type(remote_path, data, content_type="application/pdf")
    if isinstance(r, Exception):
        # network / requests error
        return False, f"put-error: {r}"
    if hasattr(r, "status_code"):
        if r.status_code in (200, 201):
            public_url = build_public_url(SUPABASE_BUCKET, remote_path)
            return True, public_url
        else:
            # try to return textual failure
            return False, f"put-status:{r.status_code} text:{r.text[:200]}"
    else:
        return False, f"put-unknown-response:{r}"

# ---- main -----------------------------------------------------------------
def main(overwrite=False, single_path=None):
    print("Supabase URL:", SUPABASE_URL)
    print("Supabase Bucket:", SUPABASE_BUCKET)

    client = create_client(SUPABASE_URL, SUPABASE_KEY_SERVICE)

    if single_path:
        p = Path(single_path)
        if not p.exists():
            print("File not found:", single_path)
            return
        files = [(p, str(p.relative_to(PDF_DIR)).replace("\\", "/"))]
    else:
        files = find_local_pdfs()

    total = len(files)
    print("Found local PDFs:", total)
    if total == 0:
        print("Nothing to upload. Exit.")
        return

    uploaded = 0
    failed = 0
    details = []

    for idx, (local_path, rel_path) in enumerate(files, start=1):
        print(f"[{idx}/{total}] -> {local_path}  -> remote: {rel_path}")
        ok, info = upload_via_client_then_fix(client, local_path, rel_path, overwrite=overwrite)
        if ok:
            uploaded += 1
            print("   uploaded OK / ensured content-type. public_url:", info)
            details.append((str(local_path), rel_path, info))
        else:
            failed += 1
            print("   upload FAILED:", info)
        time.sleep(0.10)

    print(f"\nDone. Uploaded (or re-fixed): {uploaded}  Failed: {failed}  Total scanned: {total}")
    if details:
        print("Sample uploaded files (first 10):")
        for r in details[:10]:
            print(" ", r)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing files")
    parser.add_argument("--path", type=str, default=None, help="Path to a single PDF to upload")
    args = parser.parse_args()

    # ensure env again
    SUPABASE_URL = os.environ.get("SUPABASE_URL")
    SUPABASE_KEY_SERVICE = os.environ.get("SUPABASE_KEY_SERVICE")
    SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET", "gem-pdfs")

    if not SUPABASE_URL or not SUPABASE_KEY_SERVICE:
        raise SystemExit("Missing SUPABASE_URL or SUPABASE_KEY_SERVICE in environment")

    main(overwrite=args.overwrite, single_path=args.path)
