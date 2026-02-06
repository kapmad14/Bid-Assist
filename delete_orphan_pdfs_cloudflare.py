#!/usr/bin/env python3
import os
import boto3
from datetime import datetime, timezone, timedelta
from supabase import create_client
from dotenv import load_dotenv
from typing import Optional
from collections import defaultdict

# ---------- load env ----------
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

R2_ACCESS_KEY = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_BUCKET = os.getenv("R2_BUCKET")

# ---------- helpers ----------
def normalize(path: str) -> Optional[str]:
    if not path:
        return None
    path = path.strip()
    if "cloudflarestorage.com/" in path:
        path = path.split("cloudflarestorage.com/", 1)[1]
    if path.startswith(f"{R2_BUCKET}/"):
        path = path[len(R2_BUCKET) + 1:]
    return path.lstrip("/")

# ---------- clients ----------
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=R2_ACCESS_KEY,
    aws_secret_access_key=R2_SECRET_KEY,
)

# ---------- load valid DB keys ----------
print("Fetching DB storage paths...")
valid_keys = set()
page = 0
page_size = 1000

while True:
    res = supabase.table("tenders") \
        .select("pdf_storage_path") \
        .range(page * page_size, (page + 1) * page_size - 1) \
        .execute()

    if not res.data:
        break

    for r in res.data:
        k = normalize(r.get("pdf_storage_path"))
        if k:
            valid_keys.add(k)
    page += 1

if len(valid_keys) < 500:
    raise RuntimeError("Valid keyset unexpectedly small – aborting.")

print("Valid DB keys:", len(valid_keys))

# ---------- scan R2 ----------
cutoff_date = (datetime.now(timezone.utc) - timedelta(days=3)).date()
orphans = []
orphans_by_date = defaultdict(int)

print("\nScanning R2 bucket...")

paginator = s3.get_paginator("list_objects_v2")

for page in paginator.paginate(Bucket=R2_BUCKET, Prefix="bids/"):
    for obj in page.get("Contents", []):
        key = obj["Key"]

        if not key.lower().endswith(".pdf"):
            continue

        try:
            folder_date = datetime.strptime(key.split("/")[1], "%Y-%m-%d").date()
        except:
            continue

        if folder_date >= cutoff_date:
            continue

        if key not in valid_keys:
            orphans.append(key)
            orphans_by_date[str(folder_date)] += 1

# ---------- report ----------
print("\nORPHAN PDF SUMMARY:")
for d in sorted(orphans_by_date):
    print(f"{d} -> {orphans_by_date[d]}")

print(f"\nTOTAL ORPHAN PDFs TO DELETE: {len(orphans)}")

if not orphans:
    print("\nNothing to delete.")
    exit(0)

confirm = input("\nType YES to permanently delete these files: ")

if confirm != "YES":
    print("Aborted.")
    exit(0)

# ---------- delete ----------
print("\nDeleting orphan PDFs...")

deleted = 0
total = len(orphans)

for key in orphans:
    try:
        s3.delete_object(Bucket=R2_BUCKET, Key=key)
        deleted += 1

        if deleted % 50 == 0 or deleted == total:
            print(f"{deleted}/{total} PDFs deleted")

    except Exception as e:
        print("FAILED:", key, str(e))

print("\nCleanup completed.")
