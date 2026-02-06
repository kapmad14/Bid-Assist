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
    help="Date of results to load in DD-MM-YYYY format (default: yesterday). "
        "File must exist as: results_DD-MM-YYYY.jsonl"
)
args = parser.parse_args()

# ✅ Validate date format early
if args.date:
    try:
        datetime.strptime(args.date, "%d-%m-%Y")
    except ValueError:
        print("Invalid --date format. Use DD-MM-YYYY (example: 31-01-2026)")
        sys.exit(1)

target_date = (
    args.date
    if args.date
    else datetime.now().strftime("%d-%m-%Y")
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

json_path = os.path.join(
    BASE_DIR,
    "gem-scraper",
    "results",
    f"results_{target_date}.jsonl"
)

failure_path = os.path.join(
    BASE_DIR,
    "gem-scraper",
    "results",
    f"results_{target_date}_failed.json"
)

if not os.path.exists(json_path):
    print(f"Results file not found: {json_path}")
    sys.exit(1)

# ✅ Proper date object (not string)
scraped_on = datetime.strptime(target_date, "%d-%m-%Y").date()

scraped_on = scraped_on.isoformat()

# ------------------ Processing ------------------

BATCH_SIZE = 800
batch = []

failed = {"count": 0}
first_failure = {"flag": True}

# ✅ Failure log file stays open safely for entire run
with open(failure_path, "w", encoding="utf-8") as failure_fp:
    failure_fp.write("[\n")

    # ------------------ Failure Writer ------------------

    def write_failure(row, reason):
        failed["count"] += 1

        record = dict(row)
        record["failure_reason"] = reason

        if not first_failure["flag"]:
            failure_fp.write(",\n")

        json.dump(record, failure_fp, ensure_ascii=False)
        first_failure["flag"] = False

    # ------------------ Batch Flush ------------------

    def flush_batch(batch_rows):
        if not batch_rows:
            return

        try:
            supabase.rpc(
                "apply_gem_results_payload",
                {
                    "payload": batch_rows,
                    "scraped_on": scraped_on,
                }
            ).execute()

        except Exception:
            for r in batch_rows:
                try:
                    supabase.rpc(
                        "apply_gem_results_payload",
                        {
                            "payload": [r],
                            "scraped_on": scraped_on,
                        }
                    ).execute()
                except Exception as row_err:
                    write_failure(r, f"Row error: {row_err}")

    # ------------------ Streaming Processing ------------------

    total_rows = sum(1 for _ in open(json_path, "r", encoding="utf-8"))

    with tqdm(total=total_rows, desc="Processing", unit="row") as pbar:
        with open(json_path, "r", encoding="utf-8") as f:

            for line in f:
                pbar.update(1)

                line = line.strip()
                if not line:
                    continue

                try:
                    row = json.loads(line)
                except Exception as e:
                    write_failure({"raw_line": line}, f"Invalid JSON: {e}")
                    continue

                bid_number = row.get("bid_number")
                if not bid_number:
                    write_failure(row, "Missing bid_number")
                    continue

                try:
                    int(row.get("quantity", 0))
                except Exception:
                    write_failure(row, "Invalid quantity")
                    continue

                batch.append(row)

                if len(batch) >= BATCH_SIZE:
                    flush_batch(batch)
                    batch.clear()

                if pbar.n % 50 == 0:
                    pbar.set_postfix(failed=failed["count"])

    # Flush remaining rows
    flush_batch(batch)

    # ✅ Close failure JSON array cleanly
    failure_fp.write("\n]")

# ------------------ Summary ------------------

print("\n✅ Done")
print(f"Inserted rows: {total_rows - failed['count']}")
print(f"Failed rows : {failed['count']}")
print(f"Failure file: {failure_path}")
