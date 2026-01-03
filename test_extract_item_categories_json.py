#!/usr/bin/env python3

import os
import re
import json
import random
import requests
from io import BytesIO
from dotenv import load_dotenv
from supabase import create_client
from pypdf import PdfReader
from typing import Optional

START_ID = 20000
END_ID   = 21000
MAX_PAGES = 2
FLUSH_EVERY = 50
SAMPLE_SIZE = 100
OUT_FILE = "item_categories_sample_20000_21000.json"
PAGE_SIZE = 500

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

HINDI_STOPS = [
    r"उ\s*ह\s*ं",
    r"उ\*ह\s*ं",
    r"वष\*",
]
HINDI_STOP_REGEX = re.compile("|".join(HINDI_STOPS), re.I)

ITEM_CATEGORY_REGEX = re.compile(
    r"Item\s*Category[^A-Za-z0-9]+(.{5,500})",
    re.I | re.S
)

def sanitize_category(raw: str) -> str:
    # remove GeMARPTS and everything after it
    raw = re.split(r"GeMARPTS", raw, flags=re.I)[0]

    # remove control characters
    raw = re.sub(r"[\x00-\x1F\x7F]", " ", raw)

    # remove Hindi OCR garbage blocks
    raw = re.split(r"[^\x00-\x7F]{3,}", raw)[0]

    raw = re.sub(r"\s+", " ", raw).strip(" :-\t\r\n")

    return raw or "UNCLASSIFIED ITEM"

def fetch_rows(start_id: int, end_id: int):
    all_rows = []
    page = 0

    while True:
        resp = (
            supabase
            .table("tenders")
            .select("id,bid_number,pdf_public_url")
            .gte("id", start_id)
            .lte("id", end_id)
            .order("id")
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
            .execute()
        )

        batch = resp.data or []
        if not batch:
            break

        all_rows.extend(batch)
        page += 1

    return all_rows

def fetch_pdf(url: str) -> bytes:
    r = requests.get(url, timeout=40)
    r.raise_for_status()
    return r.content

def extract_item_category(pdf_bytes: bytes) -> Optional[str]:
    reader = PdfReader(BytesIO(pdf_bytes))
    pages = min(len(reader.pages), MAX_PAGES)

    text = ""
    for i in range(pages):
        try:
            text += reader.pages[i].extract_text() or ""
        except Exception:
            pass

    m = ITEM_CATEGORY_REGEX.search(text)
    if not m:
        return None

    raw = m.group(1)

    # normalize whitespace
    raw = re.sub(r"\s+", " ", raw)

    # extend context when truncated
    full_text = text.replace("\n", " ")
    if raw.strip().endswith((",", "/", "-", " and", " &")):
        start = full_text.lower().find(raw.lower())
        if start != -1:
            raw = full_text[start:start + 900]

    # hard semantic stop
    raw = re.split(
        r"(Minimum|OEM|Years of|MSE|Startup|Document|required|Bid Number|Contract Period|Evaluation Method|Consignee|Buyer|Past Experience|Estimated Bid)",
        raw,
        flags=re.I
    )[0]

    raw = HINDI_STOP_REGEX.split(raw)[0]
    
    return sanitize_category(raw)




def main():
    print("🔎 Loading tenders from Supabase...")

    all_rows = fetch_rows(START_ID, END_ID)
    print(f"📄 Found {len(all_rows)} rows")

    rows = random.sample(all_rows, min(SAMPLE_SIZE, len(all_rows)))
    print(f"🎯 Sampling {len(rows)} random tenders")

    results = []
    total = len(rows)

    for idx, row in enumerate(rows, 1):
        rid = row["id"]
        url = row["pdf_public_url"]

        print(f"[{idx}/{total}] id={rid}")

        item_category = None
        try:
            if url:
                pdf = fetch_pdf(url)
                item_category = extract_item_category(pdf)
        except Exception as e:
            print(f"   ⚠️ ERROR id={rid} : {e}")

        results.append({
            "id": rid,
            "bid_number": row.get("bid_number"),
            "pdf_public_url": url,
            "item_category": item_category
        })

        if len(results) % FLUSH_EVERY == 0:
            with open(OUT_FILE, "w", encoding="utf-8") as f:
                json.dump(results, f, indent=2, ensure_ascii=False)
            print(f"   💾 flushed {len(results)} rows")

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\n✅ Final JSON written to {OUT_FILE}")

if __name__ == "__main__":
    main()
