#!/usr/bin/env python3
"""
Parse PDFs directly from Supabase Storage /bids folder
No local downloads needed - all cloud-to-cloud.

Flow:
- List PDFs in Supabase Storage bucket (bids/ prefix)
- For each PDF:
    - Derive gem_bid_id from filename (e.g. GeM-Bidding-7556449.pdf -> 7556449)
    - Ensure a matching tender row exists in Supabase `tenders` table
      - Upsert basic record if missing
      - Update pdf_storage_path, pdf_public_url, downloaded_at
    - Skip if already parsed (extraction_status == 'success' or documents_extracted == True)
    - Download PDF bytes from Supabase Storage
    - Extract text with pdfplumber
    - Parse with OpenAI (GPT) into structured fields (39 fields)
    - Update Supabase `tenders` row with parsed fields and status

This script runs once per invocation.
Your Docker loop (run_parser_loop.sh) is responsible for calling it periodically.
"""

import os
import io
import re
import json
import time
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client, Client
from openai import OpenAI
import pdfplumber

load_dotenv()

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY_SERVICE = os.getenv("SUPABASE_KEY_SERVICE") or os.getenv("SUPABASE_KEY")
SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "gem-pdfs")
TENDERS_TABLE = os.getenv("TENDERS_TABLE", "tenders")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not SUPABASE_URL or not SUPABASE_KEY_SERVICE:
    raise RuntimeError("SUPABASE_URL or SUPABASE_KEY_SERVICE/SUPABASE_KEY not set in environment")

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY not set in environment")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY_SERVICE)
client = OpenAI(api_key=OPENAI_API_KEY)


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------

def build_public_url(bucket: str, remote_path: str) -> str:
    """
    Build a public URL for an object in Supabase storage.
    Assumes the bucket is public.
    """
    # remote_path should NOT start with leading slash
    return f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/{bucket}/{remote_path}"


def list_bid_pdfs() -> list[dict]:
    """List all PDF files under the `bids/` folder of the Supabase Storage bucket."""
    # Supabase Storage list may be paginated; for now we assume single page
    files = supabase.storage.from_(SUPABASE_BUCKET).list("bids")
    # Filter for PDFs only
    pdf_files = [f for f in files if f.get("name", "").lower().endswith(".pdf")]
    return pdf_files


def extract_gem_bid_id_from_filename(filename: str) -> str | None:
    """
    Extract the gem_bid_id from filenames like:
      - GeM_301125_B_6775977.pdf  -> 6775977
      - GeM-Bidding-7556449.pdf   -> 7556449
      - GEM_doc_8549908_87dbe7adf6.pdf -> 8549908

    Strategy:
    1) find all digit groups with re.findall()
    2) prefer the last group (most filenames put the bid id at the end)
    3) fallback: choose the longest digit group (defensive)
    """
    if not filename:
        return None

    # find all digit sequences
    groups = re.findall(r"(\d+)", filename)
    if not groups:
        return None

    # Preferred heuristic: the last group is most likely the bid id
    candidate = groups[-1]

    # Defensive check: if the last group seems too short (e.g., 4 digits),
    # consider the longest group instead (common case: date = 6 digits vs bid id = 7+)
    if len(candidate) < 6:
        # find the longest group
        candidate = max(groups, key=len)

    return candidate



def fetch_tender_row(gem_bid_id: str) -> dict | None:
    """
    Fetch a single tender row from Supabase `tenders` table by gem_bid_id.
    Returns a dict (row) or None if not found.
    """
    resp = (
        supabase.table(TENDERS_TABLE)
        .select("*")
        .eq("gem_bid_id", gem_bid_id)
        .limit(1)
        .execute()
    )

    rows = resp.data or []
    if not rows:
        return None
    # IMPORTANT: Supabase always returns a list; we must take the first row
    return rows[0]


def upsert_tender_for_pdf(gem_bid_id: str, filename: str) -> dict | None:
    """
    Ensure there is a `tenders` row for the given gem_bid_id and PDF filename.
    - Sets/updates pdf_storage_path, pdf_public_url, downloaded_at.
    - Sets is_ra=False (RAs out of scope).
    Returns the up-to-date tender row (dict) or None on failure.
    """
    storage_path = f"bids/{filename}"
    public_url = build_public_url(SUPABASE_BUCKET, storage_path)
    now_iso = datetime.now(timezone.utc).isoformat()

    # Try fetch existing row first
    existing = fetch_tender_row(gem_bid_id)

    try:
        if existing:
            # Update PDF metadata on existing row
            (
                supabase.table(TENDERS_TABLE)
                .update(
                    {
                        "pdf_storage_path": storage_path,
                        "pdf_public_url": public_url,
                        "downloaded_at": now_iso,
                    }
                )
                .eq("id", existing["id"])
                .execute()
            )
        else:
            # Insert a minimal row for this bid
            # You can add more default fields here if you like
            (
                supabase.table(TENDERS_TABLE)
                .insert(
                    {
                        "gem_bid_id": gem_bid_id,
                        "pdf_storage_path": storage_path,
                        "pdf_public_url": public_url,
                        "downloaded_at": now_iso,
                        "is_ra": False,  # RAs are out of scope for this pipeline
                        # these will be filled by the parser:
                        "documents_extracted": False,
                        "extraction_status": "pending",
                    }
                )
                .execute()
            )

        # Re-fetch to return the latest row
        return fetch_tender_row(gem_bid_id)
    except Exception as e:
        print(f"  ❌ Failed to upsert tender for gem_bid_id={gem_bid_id}: {e}")
        return None


def should_skip_tender(tender: dict) -> bool:
    """
    Decide whether to skip parsing a tender.
    Conditions:
    - is_ra == True => skip (only BIDs for this script)
    - extraction_status == 'success' => already parsed
    - documents_extracted == True => treat as already parsed
    """
    if tender.get("is_ra"):
        print("  ⏭️  Skipping: is_ra == True")
        return True

    if tender.get("extraction_status") == "success":
        print("  ⏭️  Skipping: extraction_status == 'success'")
        return True

    if tender.get("documents_extracted") is True:
        print("  ⏭️  Skipping: documents_extracted == True")
        return True

    return False


def download_pdf_bytes_from_storage(filename: str) -> bytes:
    """
    Download PDF bytes from Supabase Storage bucket under `bids/filename`.
    """
    key = f"bids/{filename}"
    data: bytes = supabase.storage.from_(SUPABASE_BUCKET).download(key)
    return data


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    """Extract text from PDF bytes using pdfplumber."""
    text = ""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
    return text


def parse_tender_with_gpt(pdf_text: str) -> dict:
    """
    Parse tender using GPT-3.5-Turbo.
    Returns a dict with the 39 required fields.
    """

    prompt = f"""You are a GeM tender document parser. Extract the following 39 fields from this tender document.
Return ONLY a valid JSON object with these exact field names. Use null for missing values.

Required fields:
{{
  "bid_number": "string - e.g., GEM/2025/B/1234567",
  "bid_date": "YYYY-MM-DD",
  "bid_end_datetime": "YYYY-MM-DD HH:MM:SS+05:30",
  "total_quantity": number,
  "item_category": "string",
  
  "mse_turnover_exemption": boolean,
  "startup_turnover_exemption": boolean,
  "oem_avg_turnover": number,
  "required_experience_years": number,
  "mse_experience_exemption": boolean,
  "startup_experience_exemption": boolean,
  "past_performance_percentage": number,
  "emd_required": boolean,
  "emd_amount": number,
  "emd_exemption_mse": boolean,
  
  "ministry": "string",
  "department": "string",
  "organization_name": "string",
  "organization_type": "string - Central/State/Autonomous",
  "organization_address": "string",
  "pincode": "string",
  
  "mse_preference": boolean,
  "mii_preference": boolean,
  "make_in_india_preference": boolean,
  "local_content_requirement": "string - e.g., Class-I/Class-II",
  "bid_type": "string - Open/Limited",
  "participation_fee": number,
  
  "epbg_required": boolean,
  "epbg_percentage": number,
  "payment_terms": "string",
  "advance_payment_percentage": number,
  "warranty_required": boolean,
  "warranty_period": "string - e.g., 12 months",
  
  "boq_items": [
    {{
      "item_title": "string",
      "quantity": number,
      "unit": "string - e.g., Nos, Pcs, Kg",
      "category": "string",
      "specifications": "string",
      "delivery_days": number
    }}
  ]
}}

Important parsing rules:
1. For boolean fields, look for keywords: Yes/No, Applicable/Not Applicable, Required/Not Required
2. For dates, convert to YYYY-MM-DD format
3. For money amounts, extract numeric value only (remove currency symbols)
4. For BOQ items, extract all items listed in the Bill of Quantities section
5. If a field is not mentioned or unclear, use null

Document text:
{pdf_text[:15000]}

Return ONLY the JSON object, no explanation or markdown formatting."""

    response = client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[
            {
                "role": "system",
                "content": "You are a tender document parser. Return only valid JSON with no additional text.",
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.1,
        max_tokens=2000,
    )

    json_str = response.choices[0].message.content.strip()

    # Clean up markdown code blocks if present
    if json_str.startswith("```"):
        lines = json_str.split("\n")
        json_str = "\n".join(lines[1:-1])
        if json_str.startswith("json"):
            json_str = json_str[4:].strip()

    parsed_data = json.loads(json_str)

    # Add metadata
    parsed_data["_metadata"] = {
        "parsed_at": datetime.utcnow().isoformat() + "Z",
        "parser_version": "1.0",
        "model": "gpt-3.5-turbo",
        "text_length": len(pdf_text),
    }

    return parsed_data


def build_update_payload_from_parsed(tender: dict, parsed: dict) -> dict:
    """
    Map parsed fields into the Supabase `tenders` row payload.

    We assume the `tenders` table already has columns for these parsed values.
    This function returns a dict suitable for .update().
    """
    update = {}

    # Direct 1:1 fields (if present)
    direct_fields = [
        "bid_number",
        "bid_date",
        "bid_end_datetime",
        "total_quantity",
        "item_category",
        "mse_turnover_exemption",
        "startup_turnover_exemption",
        "oem_avg_turnover",
        "required_experience_years",
        "mse_experience_exemption",
        "startup_experience_exemption",
        "past_performance_percentage",
        "emd_required",
        "emd_amount",
        "emd_exemption_mse",
        "ministry",
        "department",
        "mse_preference",
        "mii_preference",
        "make_in_india_preference",
        "local_content_requirement",
        "bid_type",
        "participation_fee",
        "epbg_required",
        "epbg_percentage",
        "payment_terms",
        "advance_payment_percentage",
        "warranty_required",
        "warranty_period",
    ]

    for field in direct_fields:
        if field in parsed:
            update[field] = parsed[field]

    # Organization-related fields
    if "organization_name" in parsed:
        update["organization_name"] = parsed["organization_name"]
    if "organization_type" in parsed:
        update["organization_type"] = parsed["organization_type"]
    if "organization_address" in parsed:
        update["organization_address"] = parsed["organization_address"]
    if "pincode" in parsed:
        update["pincode"] = parsed["pincode"]

    # BOQ items: store as JSON (Supabase jsonb)
    if "boq_items" in parsed and parsed["boq_items"] is not None:
        update["boq_items"] = parsed["boq_items"]

    # Status fields
    update["documents_extracted"] = True
    update["extraction_status"] = "success"
    update["extraction_logs"] = []  # jsonb
    update["extracted_at"] = datetime.utcnow().isoformat() + "Z"

    return update


# -------------------------------------------------------------------
# Main processing loop
# -------------------------------------------------------------------

def process_supabase_bids():
    print(f"\n{'='*60}")
    print("🤖 Direct Supabase Parser (Cloud-to-Cloud)")
    print(f"{'='*60}\n")

    pdf_files = list_bid_pdfs()
    total_files = len(pdf_files)
    print(f"Found {total_files} PDFs in /bids folder\n")

    success = 0
    skipped = 0
    failed = 0

    for f in pdf_files:
        filename = f.get("name") or ""
        print(f"📄 Processing: {filename}")

        gem_bid_id = extract_gem_bid_id_from_filename(filename)
        if not gem_bid_id:
            print("  ⏭️  Could not extract gem_bid_id from filename, skipping")
            skipped += 1
            continue

        # 🔑 Ensure there's a tender row and that PDF metadata is stored
        tender = upsert_tender_for_pdf(gem_bid_id, filename)
        if not tender:
            print(f"  ⏭️  Failed to upsert/fetch tender for gem_bid_id={gem_bid_id}, skipping")
            skipped += 1
            continue

        if should_skip_tender(tender):
            skipped += 1
            continue

        try:
            # Download PDF bytes
            pdf_bytes = download_pdf_bytes_from_storage(filename)

            # Extract text
            pdf_text = extract_text_from_pdf_bytes(pdf_bytes)

            # Parse with GPT
            parsed_data = parse_tender_with_gpt(pdf_text)

            # Build update payload
            update_payload = build_update_payload_from_parsed(tender, parsed_data)

            # Update Supabase row
            (
                supabase.table(TENDERS_TABLE)
                .update(update_payload)
                .eq("id", tender["id"])
                .execute()
            )

            print("  ✅ Parsed and updated Supabase successfully")
            success += 1

        except Exception as e:
            print(f"  ❌ Error: {e}")
            failed += 1
            # Optionally update extraction_status to 'failed' with log
            try:
                error_log = [str(e)]
                (
                    supabase.table(TENDERS_TABLE)
                    .update(
                        {
                            "extraction_status": "failed",
                            "documents_extracted": False,
                            "extraction_logs": error_log,
                            "extracted_at": datetime.utcnow().isoformat() + "Z",
                        }
                    )
                    .eq("id", tender["id"])
                    .execute()
                )
            except Exception:
                # don't let secondary failure crash everything
                pass

        # Optional small sleep to avoid hammering OpenAI/Supabase too hard
        time.sleep(0.5)

    print(f"\n{'='*60}")
    print("📊 COMPLETE")
    print(f"{'='*60}")
    print(f"✅ Success: {success}")
    print(f"⏭️  Skipped: {skipped}")
    print(f"❌ Failed: {failed}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    process_supabase_bids()
