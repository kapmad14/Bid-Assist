#!/usr/bin/env python3
"""
migrate_day_to_supabase.py

Usage:
  python3 migrate_day_to_supabase.py --date 2025-10-30

Reads data/db/<date>.db and upserts tenders into Supabase table 'tenders'
(does not upload PDFs — only metadata). Uses REST upsert via Prefer header.
"""
import os, sqlite3, json, argparse
from pathlib import Path
import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL or SUPABASE_KEY not found in environment (.env)")

REST_URL = SUPABASE_URL.rstrip("/") + "/rest/v1/tenders"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    # Prefer merge duplicates -> upsert on unique constraint (gem_bid_id)
    "Prefer": "resolution=merge-duplicates,return=representation"
}

DATA_DIR = Path("data")
DB_DIR = DATA_DIR / "db"

def row_to_payload(cols, row):
    d = {}
    for k, v in zip(cols, row):
        # convert bytes -> text, sqlite null -> None
        if isinstance(v, bytes):
            try:
                v = v.decode("utf-8", errors="ignore")
            except:
                v = str(v)
        d[k] = v
    # optional normalization:
    # ensure source_date if capture_file present; user can override
    return d

def migrate(date_str):
    db_file = DB_DIR / f"{date_str}.db"
    if not db_file.exists():
        print("DB not found:", db_file)
        return

    conn = sqlite3.connect(str(db_file))
    cur = conn.cursor()
    cur.execute("SELECT * FROM tenders")
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    print(f"Found {len(rows)} rows in {db_file}")

    batch = []
    for r in rows:
        payload = row_to_payload(cols, r)
        # Add source_date to help tracking
        payload["source_date"] = date_str
        # Clean up types not valid for JSON/PG if any
        batch.append(payload)

        # send in batches of 50
        if len(batch) >= 50:
            send_batch(batch)
            batch = []

    if batch:
        send_batch(batch)

    print("Migration complete.")
    conn.close()

def send_batch(batch):
    # POST array to Supabase REST endpoint with Prefer header 'merge-duplicates'
    resp = requests.post(REST_URL, headers=HEADERS, json=batch, timeout=60)
    if resp.status_code in (200, 201):
        print(f"  batch upsert OK (rows: {len(batch)})")
    else:
        print("  batch upsert failed:", resp.status_code, resp.text)
        # show minimal debug
        raise RuntimeError("Supabase upsert failed")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True, help="YYYY-MM-DD date for data/db/<date>.db")
    args = ap.parse_args()
    migrate(args.date)
