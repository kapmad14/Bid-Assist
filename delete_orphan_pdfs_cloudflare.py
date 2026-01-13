#!/usr/bin/env python3
import os
import boto3
from datetime import datetime, timezone, timedelta
from supabase import create_client
from dotenv import load_dotenv
from typing import Optional

# ---------- load env ----------
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

R2_ACCESS_KEY = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_BUCKET = os.getenv("R2_BUCKET")

for k, v in {
    "SUPABASE_URL": SUPABASE_URL,
    "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_KEY,
    "R2_ACCESS_KEY": R2_ACCESS_KEY,
    "R2_SECRET_KEY": R2_SECRET_KEY,
    "R2_ACCOUNT_ID": R2_ACCOUNT_ID,
    "R2_BUCKET": R2_BUCKET
}.items():
    if not v:
        raise RuntimeError(f"Missing environment variable: {k}")

# ---------- helpers ----------
def normalize(path: str) -> Optional[str]:
    if not path:
        return None

    path = path.strip()

    if "cloudflarestorage.com" in path:
        path = path.split("cloudflarestorage.com/")[-1]

    if path.startswith(R2_BUCKET + "/"):
        path = path[len(R2_BUCKET) + 1 :]

    return path.lstrip("/")

# ---------- clients ----------
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=R2_ACCESS_KEY,
    aws_secret_access_key=R2_SECRET_KEY,
)

# ---------- build authoritative set ----------
print("Fetching valid paths from Supabase...")

rows = supabase.table("tenders") \
    .select("pdf_storage_path, pdf_public_url") \
    .execute()

valid_keys = set()

for r in rows.data:
    for field in ("pdf_storage_path", "pdf_public_url"):
        k = normalize(r.get(field))
        if k:
            valid_keys.add(k)

print("Valid keys in DB:", len(valid_keys))

# ---------- scan R2 ----------
CUTOFF = datetime.now(timezone.utc) - timedelta(days=14)

orphans = []

print("Scanning R2 bucket...")

paginator = s3.get_paginator("list_objects_v2")

for page in paginator.paginate(Bucket=R2_BUCKET):
    for obj in page.get("Contents", []):
        key = obj["Key"]
        last_modified = obj["LastModified"]

        if key not in valid_keys and last_modified < CUTOFF:
            orphans.append(key)

# ---------- dry run ----------
print("\nOrphan PDFs found:", len(orphans))
for k in orphans[:20]:
    print("ORPHAN:", k)

if not orphans:
    print("\nNo cleanup required.")
    exit(0)

confirm = input(f"\nType DELETE to permanently delete {len(orphans)} files: ")

if confirm != "DELETE":
    print("Aborted.")
    exit(0)

# ---------- delete ----------
print("\nDeleting orphans...")

for key in orphans:
    s3.delete_object(Bucket=R2_BUCKET, Key=key)
    print("Deleted:", key)

print("\nCleanup complete.")
