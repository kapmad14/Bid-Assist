#!/usr/bin/env python3
import os, json, sys
from datetime import datetime, timedelta
from dotenv import load_dotenv
from supabase import create_client
import argparse
from tqdm import tqdm

# ------------------ Setup ------------------

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVICE_ROLE_KEY = os.getenv("SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    print("Missing SUPABASE_URL or SERVICE_ROLE_KEY")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

parser = argparse.ArgumentParser()
parser.add_argument(
    "--date",
    help="Date of results to load in DD-MM-YYYY format (default: yesterday)"
)
args = parser.parse_args()

target_date = (
    args.date
    if args.date
    else (datetime.now() - timedelta(days=1)).strftime("%d-%m-%Y")
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
json_path = os.path.join(
    BASE_DIR,
    "gem-scraper",
    "results",
    f"gem_results_{target_date}.json"
)

failure_path = os.path.join(
    BASE_DIR,
    "gem-scraper",
    "results",
    f"gem_results_{target_date}_failed.json"
)

if not os.path.exists(json_path):
    print(f"Results file not found: {json_path}")
    sys.exit(1)

scraped_on = datetime.strptime(target_date, "%d-%m-%Y").strftime("%Y-%m-%d")

# ------------------ Load JSON ------------------

with open(json_path, "r", encoding="utf-8") as f:
    payload = json.load(f)

if not isinstance(payload, list):
    print("Invalid JSON format: expected list")
    sys.exit(1)


# ------------------ SQL ------------------

SQL = """
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

# ------------------ Processing ------------------

BATCH_SIZE = 100
batch = []

failed = 0

failure_fp = open(failure_path, "w", encoding="utf-8")
failure_fp.write("[\n")
first_failure = True

def write_failure(row, reason):
    global first_failure, failed
    failed += 1

    record = dict(row)
    record["failure_reason"] = reason

    if not first_failure:
        failure_fp.write(",\n")
    json.dump(record, failure_fp, ensure_ascii=False)
    first_failure = False

def flush_batch(batch_rows):
    if not batch_rows:
        return
    try:
        supabase.postgrest.rpc(
            "execute_sql",
            {
                "sql": SQL,
                "payload": batch_rows,
                "scraped_on": scraped_on,
            }
        ).execute()
    except Exception as e:
        for r in batch_rows:
            write_failure(r, f"DB insert error: {str(e)}")

# ------------------ Main loop ------------------

with tqdm(total=len(payload), desc="Processing", unit="row") as pbar:
    for row in payload:
        pbar.update(1)

        bid_number = row.get("bid_number")
        if not bid_number:
            write_failure(row, "Missing bid_number")
            continue

        # minimal structural validation
        try:
            int(row.get("quantity", 0))
        except Exception:
            write_failure(row, "Invalid quantity")
            pbar.set_postfix(failed=failed)
            continue

        batch.append(row)

        if len(batch) >= BATCH_SIZE:
            flush_batch(batch)
            batch.clear()

        pbar.set_postfix(failed=failed)

# flush remaining
flush_batch(batch)

# close failure file
failure_fp.write("\n]")
failure_fp.close()

# ------------------ Summary ------------------

print("\n✅ Done")
print(f"Failed   : {failed}")
print(f"Failure file: {failure_path}")
