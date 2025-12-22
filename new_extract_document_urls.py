#!/usr/bin/env python3
"""
extract_document_urls.py

DB-only, instant document fetcher.

- NO PDF access
- NO extraction
- NO Supabase Storage
- Read-only
"""
# NOTE:
# This script assumes URLs are already populated by the batch parser.
# It will NOT attempt PDF extraction.

import os
import sys
import json
import argparse
from dotenv import load_dotenv
import requests

# ---------------- env ----------------
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVICE_ROLE_KEY = os.getenv("SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    print(json.dumps({
        "success": False,
        "error": "Missing Supabase credentials"
    }))
    sys.exit(1)

REST_BASE = SUPABASE_URL.rstrip("/") + "/rest/v1"
DOCS_ENDPOINT = REST_BASE + "/tender_documents"

HEADERS = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
}

# ---------------- logic ----------------
def fetch_documents_for_tender(tender_id: int):
    params = {
        "select": "url,filename,source,order_index,created_at",
        "tender_id": f"eq.{tender_id}",
        "order": "order_index.asc"
    }

    r = requests.get(
        DOCS_ENDPOINT,
        headers=HEADERS,
        params=params,
        timeout=15
    )
    r.raise_for_status()
    return r.json()


# ---------------- entrypoint ----------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--tender-id", required=True)
    args = parser.parse_args()

    try:
        tender_id = int(args.tender_id)
    except Exception:
        print(json.dumps({
            "success": False,
            "error": "Invalid tender_id"
        }))
        sys.exit(1)

    try:
        documents = fetch_documents_for_tender(tender_id)
        print(json.dumps({
            "success": True,
            "documents": documents
        }))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
