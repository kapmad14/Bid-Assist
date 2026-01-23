#!/usr/bin/env python3
import os, json, sys
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client
from tqdm import tqdm

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVICE_ROLE_KEY = os.getenv("SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    print("Missing SUPABASE_URL or SERVICE_ROLE_KEY")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

# -----------------------------------------------------
#  FIXED TEMPORARY FILE ONLY
# -----------------------------------------------------
json_path = "gem-scraper/results/gem_results_18-01-2026.json"

if not os.path.exists(json_path):
    print(f"❌ Expected file NOT found: {json_path}")
    sys.exit(1)

scraped_on = "2026-01-18"

# Records with end_datetime >= this will be parked
CUTOFF = datetime.fromisoformat("2026-01-19T00:00:00")

# -----------------------------------------------------
#  SQL UPDATED FOR UNIQUE(bid_number)
# -----------------------------------------------------
sql = """
insert into public.gem_results (
    bid_number,
    bid_detail_url,
    bid_hover_url,
    has_reverse_auction,
    ra_number,
    ra_detail_url,
    ra_hover_url,
    item,
    quantity,
    ministry,
    department,
    organisation_address,
    start_datetime,
    end_datetime,
    stage,
    bid_ra_status,
    technical_status,
    raw_card_text,
    scraped_on
)
select
    bid_number,
    bid_detail_url,
    bid_hover_url,
    coalesce(has_reverse_auction, false),
    ra_number,
    ra_detail_url,
    ra_hover_url,
    item,
    quantity,
    ministry,
    department,
    organisation_address,
    start_datetime::timestamptz,
    end_datetime::timestamptz,
    stage,
    bid_ra_status,
    technical_status,
    raw_card_text,
    $2::date
from jsonb_to_recordset($1::jsonb) as t(
    bid_number text,
    bid_detail_url text,
    bid_hover_url text,
    has_reverse_auction boolean,
    ra_number text,
    ra_detail_url text,
    ra_hover_url text,
    item text,
    quantity integer,
    ministry text,
    department text,
    organisation_address text,
    start_datetime text,
    end_datetime text,
    stage text,
    bid_ra_status text,
    technical_status text,
    raw_card_text text
)
on conflict (bid_number) do nothing;
"""

# -----------------------------------------------------
#  LOAD JSON
# -----------------------------------------------------
print("Loading JSON file into memory...")
with open(json_path, "r", encoding="utf-8") as f:
    payload = json.load(f)

print(f"Total records in file: {len(payload):,}")

# -----------------------------------------------------
#  CLASSIFY RECORDS FIRST
# -----------------------------------------------------
to_upload = []
parked = []

for rec in payload:
    try:
        end_dt = datetime.fromisoformat(rec["end_datetime"])
        if end_dt >= CUTOFF:
            parked.append(rec)
        else:
            to_upload.append(rec)
    except Exception:
        # If date is bad, still attempt upload (will surface as error)
        to_upload.append(rec)

print(f"✅ Eligible for upload (<= 18 Jan): {len(to_upload):,}")
print(f"🅿️  Parked (>= 19 Jan): {len(parked):,}")

# -----------------------------------------------------
#  UPLOAD IN BATCHES
# -----------------------------------------------------
BATCH_SIZE = 500

inserted = 0      # rows actually inserted
skipped = 0       # duplicates skipped by ON CONFLICT
errors = 0        # failed batches

with tqdm(total=len(to_upload), desc="Uploading to Supabase") as pbar:
    for i in range(0, len(to_upload), BATCH_SIZE):
        batch = to_upload[i : i + BATCH_SIZE]

        try:
            res = supabase.postgrest.rpc(
                "execute_sql",
                {
                    "sql": sql,
                    "payload": batch,
                    "scraped_on": scraped_on,
                },
            ).execute()

            # We assume:
            # attempted = batch size
            # inserted = attempted minus duplicates
            attempted = len(batch)

            # PostgREST doesn't return per-row info,
            # so we conservatively assume everything succeeded as "insert or skip"
            inserted += attempted

        except Exception as e:
            print(f"\n❌ ERROR on batch starting index {i}: {e}")
            errors += len(batch)

        pbar.update(len(batch))

# -----------------------------------------------------
#  FINAL OUTPUT (CLEARER)
# -----------------------------------------------------
print("\n===== RUN SUMMARY =====")
print(f"📁 Source file : {json_path}")
print(f"🅿️  PARKED      : {len(parked):,}")
print(f"✅ ATTEMPTED OK : {inserted:,}  (inserted + duplicates skipped)")
print(f"❌ FAILED       : {errors:,}")
print("=======================")
