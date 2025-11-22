#!/usr/bin/env python3
"""
worker_matcher.py
- Claim jobs from `match_jobs`
- For each job (single catalog_item_id): run matching or delete/pause
- Uses Supabase admin client for safe DB writes (service-role)
- Uses psycopg2 for atomic claiming if DATABASE_URL is provided (recommended)
- Supports --worker-loop and --dry-run

Key points:
- DELETE jobs:
    * Do NOT try to read catalog_items (it’s already deleted).
    * Select recommendations for that catalog_item_id, log how many, then delete them.
    * Treat "0 rows" / PGRST116 as success (idempotent delete).
- PAUSE jobs:
    * Same delete behavior as above, but the catalog item still exists.
- CREATE / UPDATE / RESUME:
    * Only compute matches if catalog item status == 'active'.
"""

import os
import time
import argparse
import logging
import re
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Set

from rapidfuzz import fuzz
from supabase import create_client

# optional: use psycopg2 for safe FOR UPDATE SKIP LOCKED claiming
try:
    import psycopg2
    import psycopg2.extras
except Exception:
    psycopg2 = None

from dotenv import load_dotenv
load_dotenv()

# Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("matcher-worker")

# ENV / config
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")  # optional but recommended for atomic claim
WORKER_POLL_INTERVAL = int(os.getenv("WORKER_POLL_INTERVAL", "5"))
THRESHOLD = int(os.getenv("MATCH_THRESHOLD", "65"))
DRY_RUN_DEFAULT = os.getenv("DRY_RUN", "false").lower() in ("1", "true", "yes")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.")

supabase_admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# ---------------------------------------
# Utilities
# ---------------------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_text_simple(s: Optional[str]) -> str:
    if not s:
        return ""
    t = str(s).lower()
    t = re.sub(r'\([^)]*\)', ' ', t)          # remove (...) parts
    t = re.sub(r'[^a-z0-9\s]', ' ', t)       # remove punctuation
    toks = [
        tok for tok in t.split()
        if tok not in {"v2", "q2", "kit", "kits", "auto", "automatic", "semi", "analyser", "analyzer"}
    ]
    t = " ".join(toks)
    t = " ".join(t.split())
    return t


def extract_tokens(s: str) -> List[str]:
    # Unique tokens, keep order
    return list(dict.fromkeys(s.split()))


def _resp_error_text(resp: Any) -> Optional[str]:
    if resp is None:
        return None
    err = getattr(resp, "error", None)
    if err:
        return str(err)
    if isinstance(resp, dict):
        e = resp.get("error") or resp.get("message")
        if e is not None:
            return str(e)
    return None


def _is_zero_rows_error(err_text: Optional[str]) -> bool:
    """
    Detect PostgREST PGRST116 / "contains 0 rows" messages which just mean:
    "you tried to get a single row, but there were 0".
    For deletes, that’s safe to ignore (idempotent).
    """
    if not err_text:
        return False
    if "PGRST116" in err_text or "contains 0 rows" in err_text or "0 rows" in err_text:
        return True
    return False


# ---------------------------------------
# Claim job
# ---------------------------------------
def claim_job_psycopg2(conn) -> Optional[Dict[str, Any]]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            BEGIN;
            WITH candidate AS (
              SELECT id FROM match_jobs
              WHERE status = 'pending'
              ORDER BY created_at
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            UPDATE match_jobs
            SET status = 'processing',
                attempts = match_jobs.attempts + 1,
                updated_at = now()
            WHERE id IN (SELECT id FROM candidate)
            RETURNING id, user_id, catalog_item_id, action, payload, attempts;
        """)
        row = cur.fetchone()
        conn.commit()
        return dict(row) if row else None


def claim_job_supabase() -> Optional[Dict[str, Any]]:
    resp = (
        supabase_admin.from_("match_jobs")
        .select("id,user_id,catalog_item_id,action,payload,attempts")
        .eq("status", "pending")
        .order("created_at", desc=False)
        .limit(1)
        .execute()
    )

    data = resp.data if hasattr(resp, "data") else (resp.get("data") if isinstance(resp, dict) else None)
    candidates = data or []
    if not candidates:
        return None

    job = candidates[0]
    job_id = job["id"]

    upd = (
        supabase_admin.from_("match_jobs")
        .update({"status": "processing", "attempts": job.get("attempts", 0) + 1, "updated_at": now_iso()})
        .eq("id", job_id)
        .eq("status", "pending")
        .execute()
    )
    udata = upd.data if hasattr(upd, "data") else (upd.get("data") if isinstance(upd, dict) else None)
    if udata:
        return {**job}
    return None


# ---------------------------------------
# Core: process single job
# ---------------------------------------
def _delete_recommendations_for_catalog(cid: str, dry_run: bool) -> Dict[str, Any]:
    """
    Helper used by both 'delete' and 'pause' actions.
    It:
      1) Counts current recommendations for this catalog_item_id (just a select of ids).
      2) Deletes them.
      3) Logs before/after counts.
    """
    # 1) Check existing recommendations
    before_resp = (
        supabase_admin.from_("recommendations")
        .select("id")
        .eq("catalog_item_id", cid)
        .execute()
    )
    before_data = before_resp.data if hasattr(before_resp, "data") else (
        before_resp.get("data") if isinstance(before_resp, dict) else None
    )
    before_count = len(before_data or [])
    logger.info("DELETE/Pause: catalog_item_id=%s has %d recommendation(s) BEFORE delete", cid, before_count)

    if dry_run:
        logger.info("[DRY] Would delete %d recommendations for catalog_item_id=%s", before_count, cid)
        return {"deleted": True, "before": before_count, "after": before_count}

    # 2) Perform delete
    del_resp = (
        supabase_admin.from_("recommendations")
        .delete()
        .eq("catalog_item_id", cid)
        .execute()
    )
    err_text = _resp_error_text(del_resp)
    if err_text and not _is_zero_rows_error(err_text):
        # Only treat non-0-rows errors as fatal
        raise RuntimeError(f"Error deleting recommendations: {err_text}")

    # 3) Check again after delete (just to be 100% sure)
    after_resp = (
        supabase_admin.from_("recommendations")
        .select("id")
        .eq("catalog_item_id", cid)
        .execute()
    )
    after_data = after_resp.data if hasattr(after_resp, "data") else (
        after_resp.get("data") if isinstance(after_resp, dict) else None
    )
    after_count = len(after_data or [])
    logger.info("DELETE/Pause: catalog_item_id=%s has %d recommendation(s) AFTER delete", cid, after_count)

    return {"deleted": True, "before": before_count, "after": after_count}


def process_single_catalog_item(job: Dict[str, Any], dry_run: bool = True):
    """
    job: { id, user_id, catalog_item_id, action, payload }
    """
    jid = job["id"]
    user_id = job["user_id"]
    cid = job["catalog_item_id"]
    action = job["action"]
    payload = job.get("payload")

    logger.info("Processing job id=%s action=%s catalog_item_id=%s", jid, action, cid)

    # -------------------------
    # 1) DELETE: do NOT read catalog_items (row is already gone).
    # -------------------------
    if action == "delete":
        res = _delete_recommendations_for_catalog(cid, dry_run=dry_run)
        logger.info("Delete job completed for catalog_item_id=%s, result=%s", cid, res)
        return res

    # -------------------------
    # 2) For non-delete actions, we DO need the catalog_items row
    # -------------------------
    cat_resp = (
        supabase_admin
        .from_("catalog_items")
        .select("id, user_id, category, status")
        .eq("id", cid)
        .single()
        .execute()
    )

    cat_data = cat_resp.data if hasattr(cat_resp, "data") else (
        cat_resp.get("data") if isinstance(cat_resp, dict) else None
    )
    if not cat_data:
        raise RuntimeError(f"Catalog item {cid} not found")

    # Ensure item belongs to that user
    if str(cat_data.get("user_id")) != str(user_id):
        raise RuntimeError("Ownership mismatch: aborting")

    # -------------------------
    # 3) PAUSE: delete recs but keep catalog row
    # -------------------------
    if action == "pause":
        res = _delete_recommendations_for_catalog(cid, dry_run=dry_run)
        logger.info("Pause job completed for catalog_item_id=%s, result=%s", cid, res)
        return res

    # -------------------------
    # 4) CREATE / UPDATE / RESUME -> matching
    #    Only run if status == 'active'
    # -------------------------
    if action in ("create", "update", "resume"):
        status = (cat_data.get("status") or "").lower()
        if status != "active":
            logger.info(
                "Catalog item %s status is '%s' — skipping matching "
                "(only active items should have recommendations).",
                cid,
                status,
            )
            return {"matches": 0}

    # Normalize catalog text (use payload.norm if provided)
    if payload and isinstance(payload, dict) and payload.get("norm"):
        catalog_text = payload["norm"]
    else:
        catalog_text = normalize_text_simple(cat_data.get("category"))

    if not catalog_text:
        logger.info("Catalog item has no text after normalization, skipping")
        return {"matches": 0}

    cat_tokens = extract_tokens(catalog_text)
    if not cat_tokens:
        logger.info("No tokens for catalog item, skipping")
        return {"matches": 0}

    # Candidate tender selection by tokens
    tender_ids_set: Set[str] = set()
    for tok in cat_tokens[:6]:
        q = (
            supabase_admin.from_("tenders")
            .select("id, item_category_parsed, title, bid_date, bid_end_datetime")
            .ilike("item_category_parsed", f"%{tok}%")
            .limit(500)
            .execute()
        )
        tdata = q.data if hasattr(q, "data") else (q.get("data") if isinstance(q, dict) else None)
        for r in tdata or []:
            tender_ids_set.add(str(r["id"]))

    if not tender_ids_set:
        logger.info("No token-filtered tenders found, falling back to latest 200 tenders")
        qall = (
            supabase_admin.from_("tenders")
            .select("id, item_category_parsed, title, bid_date, bid_end_datetime")
            .order("id", desc=True)
            .limit(200)
            .execute()
        )
        tdata = qall.data if hasattr(qall, "data") else (qall.get("data") if isinstance(qall, dict) else None)
        for r in tdata or []:
            tender_ids_set.add(str(r["id"]))

    # Fetch full tender rows
    tender_list: List[Dict[str, Any]] = []
    tender_ids = list(tender_ids_set)
    if tender_ids:
        chunk_size = 200
        for i in range(0, len(tender_ids), chunk_size):
            chunk = tender_ids[i : i + chunk_size]
            q = (
                supabase_admin.from_("tenders")
                .select("id, item_category_parsed, title, bid_date, bid_end_datetime")
                .in_("id", chunk)
                .execute()
            )
            if hasattr(q, "data"):
                tender_list.extend(q.data or [])
            elif isinstance(q, dict):
                tender_list.extend(q.get("data") or [])

    # Score each tender
    matches = []
    for tender in tender_list:
        tender_text = normalize_text_simple(tender.get("item_category_parsed") or tender.get("title"))
        score = fuzz.token_set_ratio(catalog_text, tender_text)
        if score >= THRESHOLD:
            matches.append((tender, int(score)))

    logger.info("Found %d matches for catalog_item_id=%s", len(matches), cid)

    # Upsert each match via RPC
    written = 0
    for tender, score in matches:
        rec = {
            "p_user_id": user_id,
            "p_catalog_item_id": cid,
            "p_tender_id": int(tender["id"]),
            "p_score": int(score),
            "p_catalog_text": catalog_text,
            "p_tender_text": normalize_text_simple(
                tender.get("item_category_parsed") or tender.get("title")
            ),
            "p_matched_at": now_iso(),
        }
        if dry_run:
            logger.info("[DRY] rpc upsert: %s", rec)
            written += 1
            continue

        try:
            resp = supabase_admin.rpc("usp_upsert_recommendation", rec).execute()
            err_text = _resp_error_text(resp)
            if err_text:
                logger.error("RPC error for tender %s: %s", tender["id"], err_text)
                continue
            written += 1
        except Exception as e:
            logger.exception("RPC call failed for tender %s: %s", tender["id"], e)
            continue

    return {"matches": len(matches), "written": written}


# ---------------------------------------
# Mark job done/failed
# ---------------------------------------
def mark_job_done_psycopg2(conn, job_id):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE match_jobs SET status='done', updated_at=now() WHERE id = %s",
            (job_id,),
        )
        conn.commit()


def mark_job_failed_psycopg2(conn, job_id, err_text):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE match_jobs SET status='failed', last_error=%s, updated_at=now() WHERE id = %s",
            (err_text[:1000], job_id),
        )
        conn.commit()


def mark_job_done_supabase(job_id):
    supabase_admin.from_("match_jobs").update(
        {"status": "done", "updated_at": now_iso()}
    ).eq("id", job_id).execute()


def mark_job_failed_supabase(job_id, err_text):
    supabase_admin.from_("match_jobs").update(
        {"status": "failed", "last_error": err_text[:1000], "updated_at": now_iso()}
    ).eq("id", job_id).execute()


# ---------------------------------------
# Main loop
# ---------------------------------------
def main_loop(dry_run: bool = True, poll_interval: int = WORKER_POLL_INTERVAL):
    conn = None
    use_psycopg2 = False
    if DATABASE_URL and psycopg2:
        try:
            conn = psycopg2.connect(DATABASE_URL)
            use_psycopg2 = True
            logger.info("Using psycopg2 with DATABASE_URL for atomic claiming.")
        except Exception as e:
            logger.warning(
                "Could not connect via psycopg2, falling back to supabase claiming: %s",
                e,
            )
            conn = None

    logger.info(
        "Worker started (dry_run=%s, poll_interval=%s, threshold=%s)",
        dry_run,
        poll_interval,
        THRESHOLD,
    )
    try:
        while True:
            job = None
            try:
                if use_psycopg2 and conn:
                    job = claim_job_psycopg2(conn)
                else:
                    job = claim_job_supabase()
            except Exception as e:
                logger.exception("Error claiming job: %s", e)
                job = None

            if not job:
                time.sleep(poll_interval)
                continue

            jid = job["id"]
            try:
                result = process_single_catalog_item(job, dry_run=dry_run)
                logger.info("Job %s processed result=%s", jid, result)
                if use_psycopg2 and conn:
                    mark_job_done_psycopg2(conn, jid)
                else:
                    mark_job_done_supabase(jid)
            except Exception as e:
                logger.exception("Job %s failed: %s", jid, e)
                if use_psycopg2 and conn:
                    mark_job_failed_psycopg2(conn, jid, str(e))
                else:
                    mark_job_failed_supabase(jid, str(e))

    except KeyboardInterrupt:
        logger.info("Worker shutting down by KeyboardInterrupt")
    finally:
        if conn:
            conn.close()


# ---------------------------------------
# CLI
# ---------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--worker-loop",
        action="store_true",
        help="Run continuously (polling loop).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=DRY_RUN_DEFAULT,
        help="Dry run: do not write recommendations.",
    )
    parser.add_argument(
        "--poll-interval",
        type=int,
        default=WORKER_POLL_INTERVAL,
    )
    args = parser.parse_args()

    if args.worker_loop:
        main_loop(dry_run=args.dry_run, poll_interval=args.poll_interval)
    else:
        # single-run mode: process at most one job then exit
        if psycopg2 and DATABASE_URL:
            conn = psycopg2.connect(DATABASE_URL)
            job = claim_job_psycopg2(conn)
        else:
            job = claim_job_supabase()

        if not job:
            logger.info("No pending job found.")
        else:
            try:
                res = process_single_catalog_item(job, dry_run=args.dry_run)
                logger.info("Processed job result=%s", res)
                if psycopg2 and DATABASE_URL:
                    mark_job_done_psycopg2(conn, job["id"])
                    conn.close()
                else:
                    mark_job_done_supabase(job["id"])
            except Exception as e:
                logger.exception("Processing failed: %s", e)
                if psycopg2 and DATABASE_URL:
                    mark_job_failed_psycopg2(conn, job["id"], str(e))
                    conn.close()
                else:
                    mark_job_failed_supabase(job["id"], str(e))
