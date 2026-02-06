#!/usr/bin/env python3
"""
Upload CPWD JSONL → Supabase (Batch Mode)

✅ Default input: results/cpwd_results_<today>.jsonl
✅ Optional override via CLI argument
✅ Uploads in batches of 100
✅ Upserts using tender_id
✅ Keeps only docs/covers as JSONB
"""

import json
import os
import sys
from datetime import datetime
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()


# ---------------- CONFIG ----------------

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise Exception("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment")

TABLE_NAME = "cpwd_tenders"
BATCH_SIZE = 100

# ---------------- INPUT FILE LOGIC ----------------

today = str(datetime.today().date())

default_file = f"gem-scraper/results/cpwd/cpwd_results_{today}.jsonl"

# ✅ Use CLI argument if provided, else today's file
INPUT_FILE = sys.argv[1] if len(sys.argv) > 1 else default_file

if not os.path.exists(INPUT_FILE):
    raise FileNotFoundError(f"❌ Input file not found: {INPUT_FILE}")

print(f"\n📌 Using input file: {INPUT_FILE}")

# ---------------- SUPABASE INIT ----------------

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ---------------- HELPERS ----------------


def transform_record(obj):
    """
    Convert scraper JSON into DB row format:

    ✅ Normal fields → separate DB columns
    ✅ Only docs/covers stay JSONB
    """

    details = obj["details"]
    listing = obj["listing"]

    return {
        # ✅ Unique Tender Key (always from listing)
        "tender_id": listing["tender_id"],

        # ✅ Listing Info
        "nit_no": listing["nit_no"],
        "title": listing["title"],
        "status": listing["status"],


        # Core Fields
        "name_of_work": details["name_of_work"],
        "tender_type": details["tender_type"],
        "procurement_type": details["procurement_type"],
        "bid_type": details["bid_type"],

        "estimated_cost": details["estimated_cost"],
        "time_allowed": details["time_allowed"],

        "type_of_work": details["type_of_work"],
        "category_of_tendered": details["category_of_tendered"],
        "competitive_bidding_type": details["competitive_bidding_type"],
        "no_of_stages": details["no_of_stages"],

        # Dates
        "publishing_datetime": details["publishing_datetime"],
        "prebid_deadline": details["prebid_deadline"],
        "closing_datetime": details["closing_datetime"],

        "bid_validity_days": details["bid_validity_days"],
        "bid_validity_expiry": details["bid_validity_expiry"],
        "tender_notice_type": details["tender_notice_type"],

        # Authority Info
        "office_inviting_bids": details["office_inviting_bids"],
        "designation": details["designation"],
        "address": details["address"],
        "phone": details["phone"],
        "email": details["email"],

        # EMD
        "emd_amount": details["emd_amount"],
        "emd_in_favour_of": details["emd_in_favour_of"],
        "emd_mode": details["emd_mode"],

        # ✅ JSON Fields Only
        # ✅ JSON Fields Only (safe)
        "mandatory_documents": details.get("mandatory_documents", []),
        "eligibility_documents": details.get("eligibility_documents", []),
        "covers": details.get("covers", []),

        # Metadata
        "scraped_on": obj["scraped_on"],
        "source": obj["source"],
    }


def upload_batch(batch):
    """
    Push one batch into Supabase.
    Uses UPSERT on tender_id.
    """

    resp = (
        supabase.table(TABLE_NAME)
        .upsert(batch, on_conflict="tender_id")
        .execute()
    )

    return resp


# ---------------- MAIN ----------------


def main():
    print("\n🚀 Starting CPWD Batch Upload...\n")

    batch = []
    total_uploaded = 0

    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):

            obj = json.loads(line)
            row = transform_record(obj)

            batch.append(row)

            # ✅ Upload when batch full
            if len(batch) == BATCH_SIZE:
                print(f"⬆️ Uploading rows {total_uploaded + 1} → {total_uploaded + BATCH_SIZE}")

                upload_batch(batch)

                total_uploaded += len(batch)
                batch = []

    # ✅ Upload leftover rows
    if batch:
        print(f"⬆️ Uploading final batch ({len(batch)} rows)...")
        upload_batch(batch)
        total_uploaded += len(batch)

    print("\n✅ Upload Complete!")
    print("✅ Total rows pushed:", total_uploaded)


if __name__ == "__main__":
    main()
