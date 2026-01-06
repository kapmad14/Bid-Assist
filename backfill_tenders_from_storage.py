#!/usr/bin/env python3
"""
Simplified backfill script — consumes scraper-produced run-level JSON
and upserts rows into `tenders` table in Supabase.

Behavior (per our agreement):
- Deterministic target date (CLI positional arg or yesterday)
- Fetch run JSON from `daily_meta/gem_bids_<YYYY-MM-DD>_no_ra_meta.json` in Supabase storage;
  fallback to local `daily_data/` file.
- Treat run JSON `bids` array as the sole source of truth.
- Key records by bid_number / gem_bid_id. Do not use basenames.
- Trust all fields from run JSON except `pdf_sha256` when missing — then try HEAD, then bounded GET.
- Idempotent: INSERT if not found, PATCH minimally when present.
- --dry-run supported; verbose logging if requested.
"""

from __future__ import annotations

import os
import sys
import json
import time
import argparse
import logging
import hashlib
import random
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Tuple
from urllib.parse import quote
from dotenv import load_dotenv

import requests

load_dotenv()

# ------------------------- Configuration & env -------------------------
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
TENDERS_TABLE = os.environ.get("TENDERS_TABLE", "tenders")

# timeouts / retries
STORAGE_HEAD_TIMEOUT = int(os.environ.get("BACKFILL_HEAD_TIMEOUT", 15))
DOWNLOAD_TIMEOUT = int(os.environ.get("BACKFILL_DOWNLOAD_TIMEOUT", 60))
DB_TIMEOUT = int(os.environ.get("BACKFILL_DB_TIMEOUT", 30))
DB_RETRY_ATTEMPTS = int(os.environ.get("BACKFILL_DB_RETRY_ATTEMPTS", 3))
MAX_DOWNLOAD_BYTES = int(os.environ.get("BACKFILL_MAX_DOWNLOAD_BYTES", 200 * 1024 * 1024))

# local paths
SCRIPT_DIR = os.path.dirname(__file__)
SCRAPER_DIR = os.path.join(SCRIPT_DIR, "gem-scraper")
DAILY_DATA_DIR = os.path.join(SCRAPER_DIR, "daily_data")
LOCAL_META_DIR = DAILY_DATA_DIR


# ------------------------- Logging & session -------------------------
root_logger = logging.getLogger("backfill")
handler = logging.StreamHandler(sys.stdout)
formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
handler.setFormatter(formatter)
root_logger.addHandler(handler)

SESSION = requests.Session()

AUTH_HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"} if SUPABASE_KEY else {}

# ------------------------- Helpers -------------------------

def ensure_env():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment")


def parse_args():
    p = argparse.ArgumentParser(description="Backfill tenders from scraper run JSON (daily_meta)")
    p.add_argument("date", nargs="?", help="Target date YYYY-MM-DD (defaults to yesterday)")
    p.add_argument("--dry-run", action="store_true", help="Do not write to DB")
    p.add_argument("--verbose", action="store_true", help="Enable debug logging")
    p.add_argument("--max-download-bytes", type=int, default=MAX_DOWNLOAD_BYTES, help="Max bytes when streaming PDFs")
    p.add_argument("--max-candidates", type=int, default=0, help="Process at most N candidates (0 = all)")
    p.add_argument("--table", default=TENDERS_TABLE, help="Supabase table name (overrides TENDERS_TABLE env)")
    return p.parse_args()


def effective_target_date(arg_date: Optional[str]) -> datetime.date:
    if arg_date:
        try:
            return datetime.strptime(arg_date, "%Y-%m-%d").date()
        except Exception:
            raise SystemExit(f"Invalid date format: {arg_date} (expected YYYY-MM-DD)")
    return (datetime.now().date() - timedelta(days=1))


def run_meta_filename(date: datetime.date) -> str:
    return f"gem_bids_{date.strftime('%Y-%m-%d')}_no_ra_meta.json"


# ------------------------- Load run JSON -------------------------

def load_run_json(target_date: datetime.date) -> dict:
    filename = run_meta_filename(target_date)
    storage_path = f"daily_meta/{filename}"

    # 2) try local file
    local_path = os.path.join(LOCAL_META_DIR, filename)
    if os.path.exists(local_path):
        try:
            with open(local_path, "r", encoding="utf-8") as fh:
                js_local = json.load(fh)
            root_logger.info("Loaded run JSON from local file: %s", local_path)
            return js_local
        except Exception as e:
            raise RuntimeError(f"Failed to parse local run JSON {local_path}: {e}")

    raise RuntimeError(f"Run JSON not found in storage ({storage_path}) or locally ({local_path})")


# ------------------------- gem_bid_id extraction -------------------------

def extract_gem_bid_id_from_bid_number(bid_number: str) -> Optional[int]:
    """Extract the numeric gem_bid_id from a bid_number like 'GEM/2025/B/6967173'.
    Prefer the final numeric token of the bid_number.
    """
    if not bid_number or not isinstance(bid_number, str):
        return None
    parts = [p for p in bid_number.replace('\\\u00A0', ' ').replace('\\u200b', '').split('/') if p]
    # reverse find a numeric token >=5 digits
    for token in reversed(parts):
        if token.isdigit() and len(token) >= 5:
            try:
                return int(token)
            except Exception:
                continue
    # fallback: any numeric substring of length >=5
    import re
    m = re.search(r"(\d{5,})", bid_number)
    if m:
        try:
            return int(m.group(1))
        except Exception:
            return None
    return None



# ------------------------- DB helpers (Supabase REST) -------------------------

def _db_request_with_retries(method: str, url: str, headers: Dict[str, str], **kwargs) -> requests.Response:
    last_exc = None
    for attempt in range(1, DB_RETRY_ATTEMPTS + 1):
        try:
            resp = SESSION.request(method, url, headers=headers, timeout=DB_TIMEOUT, **kwargs)
            if resp.status_code == 429:
                wait = int(resp.headers.get('Retry-After', '5'))
                root_logger.warning('DB 429; sleeping %ds (attempt %d)', wait, attempt)
                time.sleep(wait)
                last_exc = RuntimeError('429')
                continue
            return resp
        except Exception as e:
            last_exc = e
            root_logger.warning('DB request attempt %d failed: %s', attempt, e)
            time.sleep(min(30, 2 ** attempt))
    raise RuntimeError(f"DB request failed after retries: {last_exc}")


def db_select_by_gem_bid_id(gem_bid_id: int) -> Optional[Dict[str, Any]]:
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{TENDERS_TABLE}"
    params = {"gem_bid_id": f"eq.{gem_bid_id}", "select": "*"}
    resp = _db_request_with_retries('GET', url, AUTH_HEADERS, params=params)
    if resp.status_code == 200:
        rows = resp.json()
        return rows[0] if rows else None
    root_logger.error('DB select by gem_bid_id returned %s: %s', resp.status_code, resp.text[:200])
    return None


def db_select_by_bid_number(bid_number: str) -> Optional[Dict[str, Any]]:
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{TENDERS_TABLE}"
    params = {"bid_number": f"eq.{bid_number}", "select": "*"}
    resp = _db_request_with_retries('GET', url, AUTH_HEADERS, params=params)
    if resp.status_code == 200:
        rows = resp.json()
        return rows[0] if rows else None
    root_logger.error('DB select by bid_number returned %s: %s', resp.status_code, resp.text[:200])
    return None


def db_insert(payload: Dict[str, Any], dry_run: bool) -> Optional[Dict[str, Any]]:
    if dry_run:
        root_logger.info('DRY-RUN INSERT: %s', {k: (v if k != 'raw_text' else '<raw_text>' ) for k,v in payload.items()})
        return {'_dry_run': True}
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{TENDERS_TABLE}"
    headers = {**AUTH_HEADERS, 'Content-Type': 'application/json', 'Prefer': 'return=representation'}
    resp = _db_request_with_retries('POST', url, headers, json=payload)
    if resp.status_code in (200, 201):
        rows = resp.json()
        return rows[0] if rows else None
    root_logger.error('DB insert returned %s: %s', resp.status_code, resp.text[:500])
    return None


def db_patch(row_id: int, payload: Dict[str, Any], dry_run: bool) -> bool:
    if dry_run:
        root_logger.info('DRY-RUN PATCH id=%s: %s', row_id, payload)
        return True
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{TENDERS_TABLE}?id=eq.{row_id}"
    headers = {**AUTH_HEADERS, 'Content-Type': 'application/json', 'Prefer': 'return=representation'}
    resp = _db_request_with_retries('PATCH', url, headers, json=payload)
    if resp.status_code in (200, 204):
        return True
    root_logger.error('DB patch returned %s: %s', resp.status_code, resp.text[:500])
    return False


# ------------------------- Main processing -------------------------

def build_payload_from_bid(bid: Dict[str, Any], scraped_at: Optional[str]) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    bid_number = bid.get('bid_number')
    if not bid_number:
        return payload
    payload['bid_number'] = bid_number
    gem_bid_id = extract_gem_bid_id_from_bid_number(bid_number)
    if gem_bid_id:
        payload['gem_bid_id'] = gem_bid_id

    # straightforward mapping from run JSON
    for f in ('detail_url', 'start_datetime', 'end_datetime', 'item', 'quantity', 'department'):
        v = bid.get(f)
        if v is not None:
            payload[f] = v

    # PDF-related
    if bid.get('pdf_storage_path'):
        payload['pdf_storage_path'] = bid.get('pdf_storage_path')
    if bid.get('pdf_sha256'):
        payload['pdf_sha256'] = bid.get('pdf_sha256')
    if 'pdf_uploaded' in bid:
        payload['pdf_uploaded'] = bid.get('pdf_uploaded')
    if bid.get('pdf_public_url'):
        payload['pdf_public_url'] = bid.get('pdf_public_url')

    # provenance
    if scraped_at:
        payload['scraped_at'] = scraped_at

    return payload


def process_bids(bids: List[Dict[str, Any]], scraped_at: Optional[str], dry_run: bool, max_download_bytes: int, max_candidates: int = 0) -> Dict[str, int]:
    stats = {'total': 0, 'inserted': 0, 'updated': 0, 'skipped_existing': 0, 'skipped_missing_id': 0, 'errors': 0}
    seen = 0
    for bid in bids:
        if max_candidates and seen >= max_candidates:
            break
        seen += 1
        stats['total'] += 1

        # progress log every 50 items
        if seen % 50 == 0:
            root_logger.info('Progress: %d / %d bids processed', seen, len(bids))

        bid_number = bid.get('bid_number')
        if not bid_number:
            root_logger.warning('Skipping entry with no bid_number')
            stats['skipped_missing_id'] += 1
            continue

        payload = build_payload_from_bid(bid, scraped_at)
        if not payload:
            root_logger.warning('Empty payload for bid %s', bid_number)
            stats['skipped_missing_id'] += 1
            continue

        gem_bid_id = payload.get('gem_bid_id')

        # Find existing row
        existing = None
        if gem_bid_id:
            existing = db_select_by_gem_bid_id(gem_bid_id)
        if not existing:
            existing = db_select_by_bid_number(bid_number)

        # pdf_public_url must already exist in scraper JSON
        # never auto-generate URLs here

        # Decide insert vs patch
        if not existing:
            # Insert
            inserted = db_insert(payload, dry_run)
            if inserted is not None:
                stats['inserted'] += 1
            else:
                stats['errors'] += 1
            continue

        # existing row -> patch minimally
        row_id = existing.get('id')
        if row_id is None:
            root_logger.warning('Existing row for %s missing id field; skipping', bid_number)
            stats['skipped_missing_id'] += 1
            continue

        to_patch: Dict[str, Any] = {}
        # pdf_sha256 logic
        new_sha = payload.get('pdf_sha256')
        existing_sha = existing.get('pdf_sha256')
        if new_sha:
            if not existing_sha or existing_sha.lower() != new_sha.lower():
                to_patch['pdf_sha256'] = new_sha
                # also ensure path + public url updated
                if payload.get('pdf_storage_path') and payload.get('pdf_storage_path') != existing.get('pdf_storage_path'):
                    to_patch['pdf_storage_path'] = payload['pdf_storage_path']
                    to_patch['pdf_public_url'] = payload.get('pdf_public_url')
        else:
            # no new sha: we can still populate missing path/public url and other metadata
            if payload.get('pdf_public_url') and not existing.get('pdf_public_url'):
                to_patch['pdf_public_url'] = payload['pdf_public_url']

                # preserve storage_path only if it already exists in DB
                if existing.get('pdf_storage_path'):
                    to_patch['pdf_storage_path'] = existing.get('pdf_storage_path')


        # fill other fields if missing in DB
        for f in ('bid_number', 'detail_url', 'start_datetime', 'end_datetime', 'item', 'quantity', 'department', 'scraped_at'):
            if payload.get(f) and not existing.get(f):
                to_patch[f] = payload.get(f)

        if to_patch:
            ok = db_patch(row_id, to_patch, dry_run)
            if ok:
                stats['updated'] += 1
            else:
                stats['errors'] += 1
        else:
            stats['skipped_existing'] += 1

    return stats


# ------------------------- Entrypoint -------------------------

def main():
    args = parse_args()
    if args.verbose:
        root_logger.setLevel(logging.DEBUG)
    else:
        root_logger.setLevel(logging.INFO)

    # allow overriding the table name via CLI flag
    global TENDERS_TABLE
    try:
        if args.table:
            TENDERS_TABLE = args.table
            root_logger.debug('Using TENDERS_TABLE=%s (from CLI)', TENDERS_TABLE)
    except Exception:
        pass

    target_date = effective_target_date(args.date)
    root_logger.info('Target date: %s', target_date)

    try:
        run_json = load_run_json(target_date)
    except Exception as e:
        root_logger.exception('Could not load run JSON: %s', e)
        sys.exit(2)

    # validate run JSON
    if not isinstance(run_json, dict):
        root_logger.error('Run JSON is not an object')
        sys.exit(2)
    bids = run_json.get('bids')
    scraped_at = (
    run_json.get('scraped_at_utc')
    or run_json.get('scraped_at')
    or run_json.get('scrapedAt')
    )
    if not isinstance(bids, list) or not bids:
        root_logger.error('Run JSON missing bids array or it is empty')
        sys.exit(2)
    if not scraped_at:
        root_logger.error('Run JSON missing scraped_at')
        sys.exit(2)

    max_candidates = int(args.max_candidates or 0)
    if max_candidates and max_candidates > 0:
        bids = bids[:max_candidates]

    # progress indicator for large runs
    if len(bids) > 10:
        root_logger.info("Processing %d bids...", len(bids))

    stats = process_bids(bids, scraped_at, args.dry_run, args.max_download_bytes, max_candidates)

    # print summary
    summary = {
        'target_date': target_date.isoformat(),
        'scraped_at': scraped_at,
        **stats,
        'dry_run': bool(args.dry_run),
    }
    root_logger.info('=== Backfill Summary ===')
    root_logger.info(json.dumps(summary, ensure_ascii=False))

    # exit nonzero if errors
    if stats['errors'] > 0:
        sys.exit(2)
    sys.exit(0)


if __name__ == '__main__':
    main()
