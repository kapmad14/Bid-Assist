#!/usr/bin/env python3
import os, csv, json, threading
from tqdm import tqdm
from dotenv import load_dotenv
import boto3
from botocore.exceptions import ClientError
from concurrent.futures import ThreadPoolExecutor, as_completed

load_dotenv()

# ----------------------------
# CONFIG (edit if needed)
# ----------------------------
CSV_FILE = "test.csv"   # <-- your file name
MAX_WORKERS = 20
TARGET_VALID = 20

# ----------------------------
# R2 CLIENT
# ----------------------------
s3 = boto3.client(
    "s3",
    endpoint_url=os.getenv("R2_ENDPOINT"),
    aws_access_key_id=os.getenv("R2_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY"),
)

BUCKET = os.getenv("R2_BUCKET")

def exists_in_r2(storage_path: str) -> bool:
    try:
        s3.head_object(Bucket=BUCKET, Key=storage_path)
        return True
    except ClientError:
        return False

# ---------------------------------------------------
# STEP 1 — Load your CSV (already has common bids)
# ---------------------------------------------------
rows = []
with open(CSV_FILE, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for r in reader:
        # skip empty paths just in case
        if r.get("pdf_storage_path"):
            rows.append({
                "bid_number": r["bid_number"],
                "pdf_storage_path": r["pdf_storage_path"]
            })

print(f"Loaded {len(rows)} rows from {CSV_FILE}\n")

# ---------------------------------------------------
# STEP 2 — Parallel R2 checking
# ---------------------------------------------------
valid = []
missing = []
lock = threading.Lock()
checked = 0

def check_one(row):
    path = row["pdf_storage_path"]
    bid = row["bid_number"]

    ok = exists_in_r2(path)

    with lock:
        if ok:
            valid.append({
                "bid_number": bid,
                "pdf_storage_path": path
            })
        else:
            missing.append({
                "bid_number": bid,
                "pdf_storage_path": path
            })
    return ok

print("Checking files in R2 (parallel)...\n")

with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
    futures = [executor.submit(check_one, r) for r in rows]

    for f in tqdm(as_completed(futures), total=len(futures)):
        checked += 1
        _ = f.result()

        if len(valid) >= TARGET_VALID:
            print(f"\n🎯 Reached {TARGET_VALID} valid records — stopping early.")
            break

# ---------------------------------------------------
# STEP 3 — Output results
# ---------------------------------------------------
with open("valid_common_bids_in_r2.json", "w") as f:
    json.dump(valid, f, indent=2)

valid_bids = sorted({v["bid_number"] for v in valid})
with open("valid_bid_numbers_common.txt", "w") as f:
    f.write("\n".join(valid_bids))

print("\n✅ DONE")
print(f"Rows checked in R2   : {checked}")
print(f"Valid in R2          : {len(valid)}")
print("Files written:")
print("- valid_common_bids_in_r2.json")
print("- valid_bid_numbers_common.txt")


