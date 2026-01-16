#!/usr/bin/env python3
import os, json, sys
from datetime import datetime, timedelta
from dotenv import load_dotenv
from supabase import create_client
import argparse

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

if args.date:
    target_date = args.date
else:
    target_date = (datetime.now() - timedelta(days=1)).strftime("%d-%m-%Y")

json_path = f"gem-scraper/results/gem_results_{target_date}.json"


if not os.path.exists(json_path):
    print(f"Results file not found: {json_path}")
    sys.exit(1)


with open(json_path, "r", encoding="utf-8") as f:
    payload = json.load(f)

scraped_on = datetime.strptime(target_date, "%d-%m-%Y").strftime("%Y-%m-%d")

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
on conflict (bid_number, scraped_on) do nothing;
"""

res = supabase.postgrest.rpc(
    "execute_sql",
    {
        "sql": sql,
        "payload": payload,
        "scraped_on": scraped_on,
    }
).execute()


print(f"Loaded {len(payload)} records from {json_path}")
