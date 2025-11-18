# matching_worker.py
import os
import time
import math
from collections import defaultdict
from typing import List, Dict
from datetime import datetime, timezone

# pip install supabase rapidfuzz
from supabase import create_client  # supabase-py
try:
    from rapidfuzz import fuzz
except Exception:
    fuzz = None

# CONFIG
SUPABASE_URL = os.environ['SUPABASE_URL']
SUPABASE_KEY = os.environ['SUPABASE_KEY']
THRESHOLD = int(os.environ.get('MATCH_THRESHOLD', 65))
BATCH_TENDERS = int(os.environ.get('BATCH_TENDERS', 200))  # process per batch
BATCH_UPSERT = int(os.environ.get('BATCH_UPSERT', 500))

# create supabase client
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

def normalize_text(s: str) -> str:
    if not s:
        return ""
    s = s.strip().lower()
    # remove extra punctuation except spaces; keep alphanum and spaces
    import re
    s = re.sub(r'[^a-z0-9\s]', ' ', s)
    s = re.sub(r'\s+', ' ', s)
    return s

def cheap_token_overlap(a: str, b: str) -> bool:
    # Very cheap prefilter: if no token overlap, skip
    if not a or not b:
        return False
    a_tokens = set(a.split())
    b_tokens = set(b.split())
    return len(a_tokens & b_tokens) > 0

def fuzzy_score(a: str, b: str) -> int:
    if not a or not b:
        return 0
    if fuzz:
        # token_sort_ratio is robust to word order variations
        try:
            return int(fuzz.token_sort_ratio(a, b))
        except Exception:
            pass
    # fallback naive approach
    from difflib import SequenceMatcher
    ratio = SequenceMatcher(None, a, b).ratio()
    return int(ratio * 100)

def upsert_recommendations(rows: List[Dict]):
    """
    Upsert recommendations into Postgres via Supabase SQL RPC or direct SQL.
    This code uses a direct SQL upsert; supabase-py does not always expose
    'on_conflict' consistently, so raw SQL is less ambiguous.
    """
    if not rows:
        return

    # Build VALUES list and run a parameterized insert with ON CONFLICT
    # columns: user_id, catalog_item_id, tender_id, score, catalog_text, tender_text, matched_at
    vals = []
    placeholders = []
    for i, r in enumerate(rows):
        vals.extend([
            r['user_id'], r['catalog_item_id'], r['tender_id'],
            int(r['score']), r.get('catalog_text', None), r.get('tender_text', None)
        ])
        idx = i * 6
        placeholders.append(f"($${vals_start}$$)")  # not used: we will use supabase RPC below

    # Simpler: call a Postgres function via Supabase RPC that accepts jsonb[] and does upsert.
    # But for simplicity, use supabase.table('recommendations').upsert if available:
    try:
        resp = sb.table('recommendations').upsert(rows, on_conflict='user_id,tender_id').execute()
        if resp.error:
            print("Upsert error:", resp.error)
        return resp
    except Exception as e:
        print("Upsert via supabase-py failed, falling back to RPC/raw SQL. Error:", e)
        # You can implement a SQL RPC endpoint in Supabase that accepts JSONB and inserts/upserts in DB.
        # Alternatively, if you have direct DB access, use psycopg2 to run an INSERT ... ON CONFLICT statement.

def process_tender_batch(tenders: List[Dict], active_catalog_items: List[Dict]):
    # Group catalog by user
    catalog_by_user = defaultdict(list)
    for c in active_catalog_items:
        catalog_by_user[c['user_id']].append(c)

    rows_to_upsert = []
    for tender in tenders:
        tender_id = tender['id']
        tender_text_raw = tender.get('item_category_parsed') or ""
        tender_text = normalize_text(tender_text_raw)
        # Iterate all users who have a catalog (or restrict to users of interest)
        # For efficiency, you could precompute the set of users who have catalogs and iterate per user.
        # Here, we will match each user separately: short-circuit per (user,tender)
        for user_id, cat_items in catalog_by_user.items():
            if not tender_text:
                continue

            matched = False
            for c in cat_items:
                cat_text_raw = c.get('category') or ""
                cat_text = normalize_text(cat_text_raw)
                # cheap token prefilter
                if not cheap_token_overlap(tender_text, cat_text):
                    continue
                score = fuzzy_score(tender_text, cat_text)
                if score >= THRESHOLD:
                    rows_to_upsert.append({
                        'user_id': user_id,
                        'catalog_item_id': c['id'],
                        'tender_id': tender_id,
                        'score': int(score),
                        'catalog_text': cat_text_raw,
                        'tender_text': tender_text_raw
                    })
                    matched = True
                    break  # SHORT-CIRCUIT: stop for this user+tender
            # next user
        # if rows_to_upsert grows, flush in batches
        if len(rows_to_upsert) >= BATCH_UPSERT:
            upsert_recommendations(rows_to_upsert)
            rows_to_upsert = []

    if rows_to_upsert:
        upsert_recommendations(rows_to_upsert)

def fetch_active_catalog_items():
    # Select active catalog items for all users
    resp = sb.table('catalog_items').select('id,user_id,category').neq('status', 'paused').execute()
    data, error = resp.data, resp.error
    if error:
        raise Exception(f"Error fetching catalog items: {error}")
    return data or []

def fetch_new_tenders(since_id=None, limit=BATCH_TENDERS):
    # Simple example: fetch tenders where created_at > last_processed or by batch pages
    # Here we fetch a batch of tenders. You might maintain a jobs table or a watermark.
    resp = sb.table('tenders').select('id,item_category_parsed,created_at').order('created_at', desc=False).limit(limit).execute()
    data, error = resp.data, resp.error
    if error:
        raise Exception(f"Error fetching tenders: {error}")
    return data or []

def main_loop():
    # simple loop; in production use queue, cron or cloud-run task
    while True:
        try:
            catalog_items = fetch_active_catalog_items()
            if not catalog_items:
                print("No active catalog items - sleeping")
                time.sleep(60)
                continue

            tenders = fetch_new_tenders(limit=BATCH_TENDERS)
            if not tenders:
                print("No new tenders - sleeping")
                time.sleep(60)
                continue

            process_tender_batch(tenders, catalog_items)
            print(f"Processed {len(tenders)} tenders")
            # Adjust sleep based on throughput
            time.sleep(5)
        except Exception as e:
            print("Worker error:", e)
            time.sleep(30)

if __name__ == "__main__":
    main_loop()
