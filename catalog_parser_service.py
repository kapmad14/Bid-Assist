# catalog_parser_service.py
# Minimal FastAPI service to parse uploaded catalog CSVs into catalog_items,
# and to create matching jobs.
# Usage:
#   pip install fastapi uvicorn python-dotenv supabase
#   SUPABASE_URL=... SERVICE_ROLE_KEY=... uvicorn catalog_parser_service:app --reload
#
# Notes:
# - Defensive about different `supabase-py` client return shapes.
# - Resilient when storage.download returns bytes, a file-like object, or other shapes.

import os
import io
import csv
import math
import time
import logging
from typing import Tuple, Any, List, Dict
from datetime import datetime
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from supabase import create_client
from dotenv import load_dotenv

# load .env (if present)
load_dotenv()

# logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("catalog-parser")

# Config
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_ROLE_KEY = os.environ.get("SERVICE_ROLE_KEY")  # MUST be service_role for server operations
BUCKET = os.environ.get("CATALOG_BUCKET", "catalogs")

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    raise RuntimeError("Set SUPABASE_URL and SERVICE_ROLE_KEY environment variables before running.")

# create supabase client
sb = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

app = FastAPI(title="Catalog Parser Service")

class ParseResponse(BaseModel):
    catalog_id: str
    inserted: int
    batches: int
    elapsed_seconds: float

def _normalize_response(resp: Any) -> Tuple[Any, Any]:
    """
    Normalize various response shapes returned by supabase-py / postgrest client.
    Returns (data, error) where either may be None.
    """
    if resp is None:
        return None, "no-response"
    # dictionary-like response (older/newer variations)
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    # object-like response that has .data and .error attributes
    data = getattr(resp, "data", None)
    error = getattr(resp, "error", None)
    # some SDK returns a .json() or .content — we prefer data/error above
    if data is None and hasattr(resp, "json"):
        try:
            j = resp.json()
            return j.get("data"), j.get("error")
        except Exception:
            pass
    return data, error

@app.post("/api/catalogs/{catalog_id}/parse", response_model=ParseResponse)
async def parse_catalog(catalog_id: str):
    """
    Parse the CSV at user_catalogs.file_path for the given catalog_id and insert rows into catalog_items.
    """
    # 1) fetch catalog metadata (robust to different client shapes)
    try:
        q = sb.table("user_catalogs").select("file_path,user_id").eq("id", catalog_id).limit(1).execute()
    except Exception as e:
        logger.exception("Error calling Supabase to fetch catalog metadata")
        raise HTTPException(status_code=500, detail=f"Error fetching catalog metadata: {e}")

    q_data, q_error = _normalize_response(q)
    if q_error:
        logger.error("Supabase returned error fetching catalog metadata: %s", q_error)
        raise HTTPException(status_code=500, detail=f"DB error fetching catalog: {q_error}")
    if not q_data:
        raise HTTPException(status_code=404, detail="catalog not found")
    # q_data is expected to be a list with single dict
    first = q_data[0] if isinstance(q_data, (list, tuple)) and len(q_data) > 0 else None
    if not first:
        raise HTTPException(status_code=404, detail="catalog not found")
    file_path = first.get("file_path")
    if not file_path:
        raise HTTPException(status_code=400, detail="catalog has no file_path")

    logger.info("Parsing catalog_id=%s file_path=%s", catalog_id, file_path)

    # 2) download file from storage (private bucket)
    try:
        dl = sb.storage.from_(BUCKET).download(file_path)
    except Exception as e:
        logger.exception("Storage download call failed")
        raise HTTPException(status_code=500, detail=f"Error calling storage.download: {e}")

    dl_data, dl_error = _normalize_response(dl)
    if dl_error:
        logger.error("Error downloading file from storage: %s", dl_error)
        raise HTTPException(status_code=500, detail=f"Error downloading file: {dl_error}")

    # dl_data may be:
    # - a file-like object with .read()
    # - raw bytes / bytearray
    # - some clients may return an object with .content
    raw = None
    try:
        if hasattr(dl_data, "read"):
            # file-like
            raw = dl_data.read()
        elif isinstance(dl_data, (bytes, bytearray)):
            raw = bytes(dl_data)
        elif hasattr(dl_data, "content"):
            raw = getattr(dl_data, "content")
        else:
            # sometimes the download returns the bytes directly (dl itself was the data)
            # attempt to coerce dl into bytes
            if isinstance(dl, (bytes, bytearray)):
                raw = bytes(dl)
            else:
                # as a last resort try to str() then encode
                raw = str(dl_data).encode("utf-8")
    except Exception as e:
        logger.exception("Failed to read downloaded data")
        raise HTTPException(status_code=500, detail=f"Failed to read downloaded data: {e}")

    if not raw:
        raise HTTPException(status_code=500, detail="Downloaded file is empty or unreadable")

    # 3) decode text and parse CSV
    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception:
        # fallback: try latin-1
        text = raw.decode("latin-1", errors="replace")

    reader = csv.DictReader(io.StringIO(text))

    # 4) prepare rows and insert in batches
    BATCH = 200
    rows = []
    inserted = 0
    start = time.time()

    def _insert_batch(batch_rows):
        if not batch_rows:
            return 0
        try:
            res = sb.table("catalog_items").insert(batch_rows).execute()
        except Exception as e:
            logger.exception("DB insert exception")
            raise HTTPException(status_code=500, detail=f"DB insert exception: {e}")

        data, error = _normalize_response(res)
        if error:
            logger.error("DB insert returned error: %s", error)
            raise HTTPException(status_code=500, detail=f"DB insert error: {error}")
        # success - return count
        return len(batch_rows)

    for r in reader:
        # Map expected columns. Adjust keys to match your CSV headers.
        title = (r.get("title") or r.get("name") or r.get("Title") or "").strip()
        if not title:
            # skip if no title
            continue
        sku = (r.get("sku_id") or r.get("SKU") or r.get("sku") or "").strip() or None
        vendor = (r.get("vendor") or r.get("manufacturer") or "").strip() or None
        price_min_raw = r.get("price_min") or r.get("price") or None
        price_max_raw = r.get("price_max") or None

        # collect any extra attributes
        attrs = {k: v for k, v in r.items() if k and k.lower() not in {
            "sku_id", "sku", "title", "name", "vendor", "manufacturer", "price_min", "price_max", "price"
        }}

        # safe parse numeric fields
        price_min = None
        price_max = None
        try:
            if price_min_raw and str(price_min_raw).strip() != "":
                price_min = float(str(price_min_raw).replace(",", "").strip())
        except Exception:
            price_min = None
        try:
            if price_max_raw and str(price_max_raw).strip() != "":
                price_max = float(str(price_max_raw).replace(",", "").strip())
        except Exception:
            price_max = None

        item = {
            "catalog_id": catalog_id,
            "sku_id": sku,
            "title": title,
            "vendor": vendor,
            "attributes": attrs or None,
            "price_min": price_min,
            "price_max": price_max,
        }
        rows.append(item)

        if len(rows) >= BATCH:
            inserted += _insert_batch(rows)
            rows = []

    # last batch
    if rows:
        inserted += _insert_batch(rows)

    elapsed = time.time() - start
    batches = math.ceil(inserted / BATCH) if inserted else 0
    logger.info("Parsed catalog %s: inserted=%d batches=%d elapsed=%.2fs", catalog_id, inserted, batches, elapsed)
    return ParseResponse(catalog_id=catalog_id, inserted=inserted, batches=batches, elapsed_seconds=round(elapsed, 2))


# ---------------------------
# Matching job creation endpoint
# ---------------------------

class JobCreateResponse(BaseModel):
    job_id: str
    status: str

@app.post("/api/catalogs/{catalog_id}/match", response_model=JobCreateResponse)
async def trigger_matching_job(catalog_id: str, user_id: str):
    """
    Create a matching_jobs row for the given catalog_id and user_id.
    Worker will poll matching_jobs for status='pending'.
    Call: POST /api/catalogs/{catalog_id}/match?user_id=<user_uuid>
    """
    # basic validation: ensure catalog exists
    try:
        q = sb.table("user_catalogs").select("id,user_id,file_path").eq("id", catalog_id).limit(1).execute()
    except Exception as e:
        logger.exception("Error checking catalog for match trigger")
        raise HTTPException(status_code=500, detail=f"DB error: {e}")
    q_data, q_error = _normalize_response(q)
    if q_error:
        raise HTTPException(status_code=500, detail=f"DB error: {q_error}")
    if not q_data:
        raise HTTPException(status_code=404, detail="catalog not found")

    payload = {
        "catalog_id": catalog_id,
        "user_id": user_id,
        "status": "pending",
        "created_at": datetime.utcnow().isoformat()
    }
    try:
        res = sb.table("matching_jobs").insert([payload]).execute()
    except Exception as e:
        logger.exception("Failed to create matching job")
        raise HTTPException(status_code=500, detail=f"Failed to create job: {e}")
    data, err = _normalize_response(res)
    if err:
        raise HTTPException(status_code=500, detail=f"Failed to create job: {err}")
    job_id = data[0].get("id") if isinstance(data, (list, tuple)) and len(data) > 0 else None
    return JobCreateResponse(job_id=job_id, status="pending")

@app.get("/api/jobs/{job_id}/recommendations")
async def get_recommendations_for_job(job_id: str) -> List[Dict]:
    """
    Return recommendations for a matching job.
    Query flow:
      1) lookup job -> get catalog_id + user_id
      2) query recommendations where catalog_id = job.catalog_id AND user_id = job.user_id
    """
    try:
        q = sb.table("matching_jobs").select("catalog_id,user_id,status").eq("id", job_id).limit(1).execute()
    except Exception as e:
        logger.exception("Error fetching job")
        raise HTTPException(status_code=500, detail=f"Error fetching job: {e}")

    q_data, q_error = _normalize_response(q)
    if q_error:
        raise HTTPException(status_code=500, detail=f"DB error: {q_error}")
    if not q_data:
        raise HTTPException(status_code=404, detail="job not found")

    job = q_data[0]
    catalog_id = job.get("catalog_id")
    user_id = job.get("user_id")

    # fetch recommendations
    try:
        r = sb.table("recommendations").select("*").eq("catalog_id", catalog_id).eq("user_id", user_id).order("score", desc=True).execute()
    except Exception as e:
        logger.exception("Error fetching recommendations")
        raise HTTPException(status_code=500, detail=f"Error fetching recommendations: {e}")

    r_data, r_err = _normalize_response(r)
    if r_err:
        raise HTTPException(status_code=500, detail=f"DB error fetching recommendations: {r_err}")
    # return list (may be empty)
    return r_data or []