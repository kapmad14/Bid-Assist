# matching_worker.py (FIXED for bigint boq_line_id)

import os
import time
import logging
from datetime import datetime
from typing import List
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_ROLE_KEY = os.environ.get("SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SERVICE_ROLE_KEY")

sb = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

# Fuzzy matching setup
try:
    from rapidfuzz.fuzz import token_sort_ratio
    def fuzzy_score(a: str, b: str) -> float:
        if not a or not b:
            return 0.0
        return token_sort_ratio(a, b) / 100.0
    logger.info("Using rapidfuzz for fuzzy scoring")
except Exception:
    from difflib import SequenceMatcher
    def fuzzy_score(a: str, b: str) -> float:
        if not a or not b:
            return 0.0
        return SequenceMatcher(None, a.lower(), b.lower()).ratio()
    logger.info("rapidfuzz not found; using difflib.SequenceMatcher")

# Configuration
SCORE_THRESHOLD = float(os.getenv("MATCH_THRESHOLD", "0.45"))
POLL_INTERVAL = 5  # seconds


def normalize(response):
    """Handle different supabase response formats"""
    if hasattr(response, 'data'):
        return response.data, None
    if isinstance(response, dict):
        return response.get('data'), response.get('error')
    return response, None


def process_job(job):
    """Process a single matching job"""
    job_id = job["id"]
    catalog_id = job["catalog_id"]
    user_id = job["user_id"]

    logger.info(f"âš™ï¸  Processing job {job_id} for catalog {catalog_id}")

    try:
        # Update job status to running
        sb.table("matching_jobs").update({
            "status": "running",
            "started_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", job_id).execute()

        # Fetch BOQ lines for this catalog
        boq_resp = sb.table("boq_lines")\
            .select("*")\
            .eq("catalog_id", catalog_id)\
            .execute()
        boq_rows, _ = normalize(boq_resp)

        # Fetch catalog items
        cat_resp = sb.table("catalog_items")\
            .select("*")\
            .eq("catalog_id", catalog_id)\
            .execute()
        catalog_items, _ = normalize(cat_resp)

        if not boq_rows or not catalog_items:
            logger.warning(f"No BOQ lines or catalog items found for {catalog_id}")
            sb.table("matching_jobs").update({
                "status": "done",
                "finished_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            }).eq("id", job_id).execute()
            return

        logger.info(f"Found {len(boq_rows)} BOQ lines and {len(catalog_items)} catalog items for matching")

        # Compute matches
        recs = []
        for boq in boq_rows:
            boq_id = boq.get("id")
            boq_desc = (boq.get("description") or "").strip()
            if not boq_desc:
                continue

            for item in catalog_items:
                item_id = item.get("id")
                item_title = (item.get("title") or "").strip()
                if not item_title:
                    continue

                score = fuzzy_score(boq_desc, item_title)
                if score >= SCORE_THRESHOLD:
                    recs.append({
                        "catalog_id": catalog_id,
                        "user_id": user_id,
                        "tender_id": boq.get("tender_id"),
                        "boq_line_id": boq_id,  # Keep as integer - don't convert
                        "catalog_item_id": item_id,
                        "score": round(score, 4),
                        "note": f"fuzzy match (threshold: {SCORE_THRESHOLD})",
                        "status": "suggested"
                    })

        # Insert recommendations
        if recs:
            logger.info(f"Inserting {len(recs)} recommendations...")
            sb.table("recommendations").insert(recs).execute()

        # Mark job as done
        sb.table("matching_jobs").update({
            "status": "done",
            "finished_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", job_id).execute()

        logger.info(f"âœ… Job {job_id} done â€” {len(recs)} recs inserted.")

    except Exception as e:
        logger.error(f"âŒ Job {job_id} failed: {e}")
        sb.table("matching_jobs").update({
            "status": "failed",
            "finished_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "logs": [{"error": str(e), "timestamp": datetime.utcnow().isoformat()}]
        }).eq("id", job_id).execute()


def main():
    logger.info(f"ðŸš€ Fuzzy matching worker started (polling every {POLL_INTERVAL}s)")
    logger.info(f"Score threshold: {SCORE_THRESHOLD}")

    while True:
        try:
            # Poll for pending jobs
            resp = sb.table("matching_jobs")\
                .select("*")\
                .eq("status", "pending")\
                .limit(1)\
                .execute()

            jobs, _ = normalize(resp)

            if jobs:
                for job in jobs:
                    process_job(job)

        except KeyboardInterrupt:
            logger.info("\nðŸ‘‹ Worker stopped by user")
            break
        except Exception as e:
            logger.error(f"Worker error: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()