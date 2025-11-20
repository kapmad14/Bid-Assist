#!/usr/bin/env python3
"""
matching_worker.py — COMPATIBLE WITH OLD SUPABASE-PY (your version)

- Uses .order("column", True/False)
- Uses .in_() for list filters
- Defensive response handling
- Fuzzy match using rapidfuzz.token_sort_ratio
- Short-circuits per user+tender
"""

import os
import time
import re
import argparse
from datetime import datetime, timezone
from typing import List, Dict, Any

from rapidfuzz import fuzz
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

PAREN_RE = re.compile(r'\([^)]*\)')
PUNCT_RE = re.compile(r'[^a-z0-9\s]')

# Accept multiple environment variable names for the service-role key
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_KEY_SERVICE")
    or os.getenv("SUPABASE_SERVICE_KEY")
)

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise SystemExit(
        "Missing SUPABASE_URL or service-role key. "
        "Set SUPABASE_SERVICE_ROLE_KEY or SERVICE_ROLE_KEY in your .env"
    )

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# CONFIG
THRESHOLD = 65
BATCH_SIZE = 200
WRITE_MULTIPLE_MATCHES = False
SLEEP_BETWEEN_BATCHES = 0.05
VERBOSE = True


# ----------------------------
# SAFE RESPONSE EXTRACTION
# ----------------------------
def safe_resp(resp):
    """
    Extract data/error/status safely from different supabase-py response shapes.
    """
    if resp is None:
        return None, {"error": "no-response", "status": None}

    data = getattr(resp, "data", None)
    error = getattr(resp, "error", None)
    status = getattr(resp, "status_code", None)

    # older versions sometimes return dict-like response
    if data is None and isinstance(resp, dict):
        data = resp.get("data")
        error = resp.get("error")
        status = resp.get("status")

    return data, {"error": error, "status": status}


# ----------------------------
# NORMALIZATION
# ----------------------------
def normalize_text(s: str) -> str:
    """
    Normalize category text:
    - lower-case
    - remove parentheses and their contents (e.g., (V2), (Q2))
    - remove punctuation
    - remove common stopwords/tokens like 'kit', 'kits', 'q2', 'v2' (case-insensitive)
    - collapse multiple spaces
    """
    if not s:
        return ""
    t = str(s).lower()
    # remove parenthetical parts
    t = PAREN_RE.sub(" ", t)
    # remove punctuation
    t = PUNCT_RE.sub(" ", t)
    # remove common meaningless tokens
    # expand as needed
    tokens_to_remove = {"v2", "q2", "kit", "kits", "auto", "automatic", "semi", "semi-automatic", "analyser", "analyzer"}
    toks = [tok for tok in t.split() if tok not in tokens_to_remove]
    t = " ".join(toks)
    # collapse spaces
    t = " ".join(t.split())
    return t

# ----------------------------
# FETCH TENDERS
# ----------------------------
def fetch_tender_batch(offset: int, limit: int) -> List[Dict[str, Any]]:
    """
    Fetch a batch of tenders (pagination via range). Avoid using supabase.order()
    because different client versions expose different signatures.
    We fetch an offset..end range and then sort locally by id for determinism.
    """
    try:
        # fetch using range only (no .order call)
        resp = (
            supabase.table("tenders")
            .select("id, item_category_parsed, title, bid_date, bid_end_datetime")
            .range(offset, offset + limit - 1)
            .execute()
        )
    except Exception as e:
        # if the client raises on this chaining (rare) surface the original error
        raise RuntimeError(f"Error fetching tenders (range): {e}")

    data, meta = safe_resp(resp)
    if meta["error"]:
        raise RuntimeError(f"Fetch tenders error: {meta['error']}")
    if meta["status"] and meta["status"] >= 400:
        raise RuntimeError(f"Fetch tenders failed: HTTP {meta['status']}")

    batch = data or []

    # Ensure deterministic order by sorting locally on numeric id (ascending)
    try:
        batch.sort(key=lambda x: int(x.get("id", 0)))
    except Exception:
        # if IDs are not numeric, fallback to string-sort
        batch.sort(key=lambda x: str(x.get("id", "")))

    return batch



# ----------------------------
# FETCH ACTIVE CATALOG ITEMS
# ----------------------------
def fetch_all_users_with_catalogs() -> List[Dict[str, Any]]:
    resp = (
        supabase.table("catalog_items")
        .select("id, user_id, category, status")
        .eq("status", "active")
        .execute()
    )

    data, meta = safe_resp(resp)
    if meta["error"]:
        raise RuntimeError(f"Catalog fetch error: {meta['error']}")
    if meta["status"] and meta["status"] >= 400:
        raise RuntimeError(f"Catalog fetch failed: HTTP {meta['status']}")

    items = data or []

    grouped = {}
    for it in items:
        uid = it["user_id"]
        grouped.setdefault(uid, []).append(it)

    return [{"user_id": uid, "catalog_items": grouped[uid]} for uid in grouped]


# ----------------------------
# UPSERT RECOMMENDATION
# ----------------------------
def upsert_recommendation(row: dict, dry_run: bool = False):
    """
    Use DB-side RPC usp_upsert_recommendation to atomically insert/update a recommendation.
    Expects row keys: user_id (uuid), catalog_item_id (uuid), tender_id (bigint), score (int),
    catalog_text (text), tender_text (text), matched_at (ISO timestamp string).

    If dry_run=True, prints the intended payload and returns without writing.
    """
    if dry_run:
        if VERBOSE:
            print("[DRY] rpc upsert:", row)
        return

    # Prepare RPC payload matching the function parameters
    payload = {
        "p_user_id": row.get("user_id"),
        "p_catalog_item_id": row.get("catalog_item_id"),
        "p_tender_id": int(row.get("tender_id")) if row.get("tender_id") is not None else None,
        "p_score": int(row.get("score")) if row.get("score") is not None else None,
        "p_catalog_text": row.get("catalog_text"),
        "p_tender_text": row.get("tender_text"),
        "p_matched_at": row.get("matched_at"),
    }

    # Call RPC
    try:
        resp = supabase.rpc("usp_upsert_recommendation", payload).execute()
    except Exception as e:
        # Defensive: try to extract message and re-raise a clear error
        raise RuntimeError(f"RPC call failed: {e}") from e

    # Safe response handling (different client versions)
    resp_data = getattr(resp, "data", None)
    resp_error = getattr(resp, "error", None)
    status = getattr(resp, "status_code", None)

    # fallback for dict-like response
    if resp_data is None and isinstance(resp, dict):
        resp_data = resp.get("data")
        resp_error = resp.get("error") or resp.get("message")
        status = resp.get("status")

    if resp_error:
        # RPC returned error object
        raise RuntimeError(f"RPC error: {resp_error}")
    if status and status >= 400:
        raise RuntimeError(f"RPC failed: status={status}")

    # The function returns void, so resp_data may be None or empty — treat success if no error
    if VERBOSE:
        print("RPC upsert succeeded for tender_id:", payload["p_tender_id"], "user:", payload["p_user_id"])
    return resp_data




# ----------------------------
# PROCESS BATCH
# ----------------------------
def process_batch(tenders_batch, users_with_catalogs, dry_run: bool = True):
    stats = {
        "tenders_processed": 0,
        "matches_found": 0,
        "matches_written": 0,
    }

    for tender in tenders_batch:
        stats["tenders_processed"] += 1
        tid = tender.get("id")
        tender_text = normalize_text(tender.get("item_category_parsed"))

        if not tender_text:
            continue

        for user in users_with_catalogs:
            user_id = user["user_id"]

            for cat in user["catalog_items"]:
                cat_text = normalize_text(cat["category"])
                if not cat_text:
                    continue

                score = fuzz.token_set_ratio(tender_text, cat_text)

                if score >= THRESHOLD:
                    stats["matches_found"] += 1

                    rec = {
                        "user_id": user_id,
                        "catalog_item_id": cat["id"],
                        "tender_id": int(tid),
                        "score": int(score),
                        "catalog_text": cat_text,
                        "tender_text": tender_text,
                        "matched_at": datetime.now(timezone.utc).isoformat(),
                    }

                    upsert_recommendation(rec, dry_run=dry_run)

                    if not dry_run:
                        stats["matches_written"] += 1

                    if not WRITE_MULTIPLE_MATCHES:
                        break

    return stats


# ----------------------------
# MAIN
# ----------------------------
def main(dry_run=True, limit=None, batch_size=None):
    global BATCH_SIZE
    if batch_size:
        BATCH_SIZE = batch_size

    print(
        "Starting matching worker",
        {"dry_run": dry_run, "threshold": THRESHOLD, "batch_size": BATCH_SIZE},
    )

    users_with_catalogs = fetch_all_users_with_catalogs()
    if not users_with_catalogs:
        print("No active catalog items found. Exiting.")
        return

    offset = 0
    total_processed = 0
    total_matches = 0

    while True:
        if limit and offset >= limit:
            break

        tenders_batch = fetch_tender_batch(offset, BATCH_SIZE)
        if not tenders_batch:
            break

        stats = process_batch(tenders_batch, users_with_catalogs, dry_run=dry_run)
        total_processed += stats["tenders_processed"]
        total_matches += stats["matches_found"]

        print(
            f"Batch offset={offset} processed={stats['tenders_processed']} "
            f"matches_found={stats['matches_found']}"
        )

        offset += BATCH_SIZE
        if limit and offset >= limit:
            break

        time.sleep(SLEEP_BETWEEN_BATCHES)

    print(
        "DONE.",
        "tenders_processed:", total_processed,
        "total_matches_found:", total_matches,
    )


# ----------------------------
# ENTRY POINT
# ----------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=None)
    args = parser.parse_args()

    main(
        dry_run=args.dry_run,
        limit=args.limit,
        batch_size=args.batch_size,
    )
