#!/usr/bin/env python3
"""
Backfill missing rows in the Supabase `tenders` table
based on PDFs present in Supabase Storage (`gem-pdfs/bids`).

Usage:
    python backfill_tenders_from_storage.py

What it does:
- Connects to Supabase using SUPABASE_URL + SUPABASE_KEY_SERVICE (or SUPABASE_KEY).
- Lists all files under the `bids/` prefix in the SUPABASE_BUCKET (default: gem-pdfs).
- For each *.pdf file:
    - Extracts gem_bid_id from the filename (e.g. GeM-Bidding-7555029.pdf -> 7555029).
    - Checks if a row with that gem_bid_id already exists in `tenders`.
    - If it does not exist, inserts a minimal stub row:
        - gem_bid_id
        - bid_number = "GEM/UNKNOWN/B/<gem_bid_id>"
        - documents_extracted = False
        - extraction_status = NULL (or "pending" if you prefer)
- Prints a summary of how many rows were created / already existed / skipped.
"""

import os
import re
from typing import Optional

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
# Prefer a service role key if available, otherwise fall back to SUPABASE_KEY
SUPABASE_KEY_SERVICE = (
    os.getenv("SUPABASE_KEY_SERVICE")
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_KEY")
)
SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "gem-pdfs")
TENDERS_TABLE = os.getenv("TENDERS_TABLE", "tenders")

if not SUPABASE_URL or not SUPABASE_KEY_SERVICE:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_KEY_SERVICE (or SUPABASE_KEY) must be set in your .env"
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY_SERVICE)


def extract_gem_bid_id_from_filename(filename: str) -> Optional[int]:
    """
    Extract numeric gem_bid_id from filenames like:
      - GeM-Bidding-7555029.pdf
      - GEM_doc_8549908_87dbe7adf6.pdf
    Returns int or None if no digits found.
    """
    m = re.search(r"(\d+)", filename)
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


def list_bid_pdfs() -> list[dict]:
    """
    List PDF files in Supabase Storage under `bids/` in the given bucket.
    NOTE: This uses a single-page list; if you ever have >1000 files,
    you may want to add pagination.
    """
    files = supabase.storage.from_(SUPABASE_BUCKET).list("bids")
    pdf_files = [f for f in files if f.get("name", "").lower().endswith(".pdf")]
    return pdf_files


def tender_exists(gem_bid_id: int) -> bool:
    """
    Check if a row for this gem_bid_id already exists in the `tenders` table.
    """
    resp = (
        supabase.table(TENDERS_TABLE)
        .select("id")
        .eq("gem_bid_id", gem_bid_id)
        .limit(1)
        .execute()
    )
    return bool(resp.data)


def create_stub_tender(gem_bid_id: int) -> None:
    """
    Insert a minimal stub row into `tenders` so that the parser
    (`parse_supabase_bids.py`) has something to attach parsed data to.
    """
    bid_number = f"GEM/UNKNOWN/B/{gem_bid_id}"

    payload = {
        "gem_bid_id": gem_bid_id,
        "bid_number": bid_number,
        "documents_extracted": False,
        "extraction_status": None,
    }

    resp = supabase.table(TENDERS_TABLE).insert(payload).execute()
    if resp.data is None:
        raise RuntimeError(f"Insert returned no data for gem_bid_id={gem_bid_id}")



def main():
    print("\n============================================================")
    print("🧩 Backfill Supabase tenders from Storage PDFs (bids/)")
    print("============================================================\n")

    pdf_files = list_bid_pdfs()
    total_pdfs = len(pdf_files)

    print(f"Found {total_pdfs} PDFs in storage folder 'bids/'\n")

    created = 0
    already = 0
    skipped = 0
    errors = 0

    for f in pdf_files:
        filename = f.get("name") or ""
        print(f"📄 Checking: {filename}")

        gem_bid_id = extract_gem_bid_id_from_filename(filename)
        if not gem_bid_id:
            print("  ⏭️  Could not extract gem_bid_id from filename, skipping")
            skipped += 1
            continue

        try:
            if tender_exists(gem_bid_id):
                print(f"  ⏭️  Row already exists in '{TENDERS_TABLE}' for gem_bid_id={gem_bid_id}")
                already += 1
                continue

            create_stub_tender(gem_bid_id)
            print(f"  ✅ Created stub tender row for gem_bid_id={gem_bid_id}")
            created += 1

        except Exception as e:
            print(f"  ❌ Error while processing gem_bid_id={gem_bid_id}: {e}")
            errors += 1

    print("\n============================================================")
    print("📊 BACKFILL SUMMARY")
    print("============================================================")
    print(f"Total PDFs seen:          {total_pdfs}")
    print(f"  ✅ Created new rows:    {created}")
    print(f"  ⏭️  Already had rows:   {already}")
    print(f"  ⏭️  Skipped (no ID):    {skipped}")
    print(f"  ❌ Errors:              {errors}")
    print("============================================================\n")


if __name__ == "__main__":
    main()
