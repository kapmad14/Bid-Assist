#!/usr/bin/env python3
"""
update_tenders_with_pdf_urls.py

For each local PDF under data/pdfs, parse the doc_id from filename (GEM_doc_{docid}_...) and
update the Supabase 'tenders' table row where doc_id matches, setting pdf_public_url.

Prereq: run in Supabase SQL editor:
  ALTER TABLE tenders ADD COLUMN IF NOT EXISTS pdf_public_url TEXT;
"""
import os
import re
from pathlib import Path
import urllib.parse
from supabase import create_client

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY_SERVICE = os.environ.get("SUPABASE_KEY_SERVICE") or os.environ.get("SUPABASE_KEY")
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET", "gem-pdfs")

if not SUPABASE_URL or not SUPABASE_KEY_SERVICE:
    raise SystemExit("Missing SUPABASE_URL or SUPABASE_KEY_SERVICE in environment")

PDF_ROOT = Path("data/pdfs")

def build_public_url(bucket, remote_path):
    remote_enc = urllib.parse.quote(remote_path, safe="/~")
    return f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/{bucket}/{remote_enc}"

def find_local_pdfs():
    if not PDF_ROOT.exists():
        return []
    files = []
    for p in sorted(PDF_ROOT.rglob("*.pdf")):
        # remote path relative to data/pdfs
        rel = p.relative_to(PDF_ROOT)
        files.append((p, str(rel).replace("\\", "/")))
    return files

def parse_docid_from_filename(fname):
    # expected pattern: GEM_doc_{docid}_{sha}.pdf
    m = re.search(r"GEM_doc_(\d+)_", fname)
    if m:
        return m.group(1)
    # fallback: try to find a 7-digit-ish number
    m2 = re.search(r"(\d{6,8})", fname)
    return m2.group(1) if m2 else None

def main(dry_run=True):
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY_SERVICE)
    files = find_local_pdfs()
    print("Local pdfs found:", len(files))
    updates = []

    for p, remote_path in files:
        docid = parse_docid_from_filename(p.name)
        if not docid:
            print("Skipping (no docid):", p)
            continue
        public_url = build_public_url(SUPABASE_BUCKET, remote_path)
        updates.append((docid, remote_path, public_url))

    print("Prepared updates:", len(updates))
    if dry_run:
        print("Dry run mode — no DB writes. Use dry_run=False to apply changes.")
        for docid, rp, url in updates[:30]:
            print(docid, rp, url)
        return

    # Apply updates
    applied = 0
    for docid, rp, url in updates:
        try:
            # Update by doc_id column
            res = supabase.table("tenders").update({"pdf_public_url": url}).eq("doc_id", int(docid)).execute()
            # res returns (data, count?) depending on client; check for errors
            # print result for debugging
            print(f"Updated doc_id={docid} -> {url} ; result: {getattr(res, 'data', res)}")
            applied += 1
        except Exception as e:
            print(f"Failed updating doc_id={docid}: {e}")

    print("Done. Applied updates:", applied)

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Actually write updates to Supabase. Otherwise dry-run.")
    args = parser.parse_args()
    main(dry_run=not args.apply)
