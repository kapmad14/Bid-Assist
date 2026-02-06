#!/usr/bin/env python3
"""
update_tenders_from_pdfs_fixed_v3.py

Changes in this revision:
- Fetch only rows where simple_extraction IS NULL.
- Use keyset pagination (id > last_id) to guarantee processing from lowest id -> highest id
  without skipping rows when earlier rows are updated during the run.
- Always set updated_at to the attempt timestamp for every attempt (success or failure).
- Mark simple_extraction = 'success' on success, 'error' on failure.
- NO CHANGES to the extraction logic itself.
"""

import os
import sys
import tempfile
import requests
import re
import json
from datetime import datetime, timezone
from dotenv import load_dotenv
from pypdf import PdfReader
from pdf_url_extractor import extract_urls_from_pdf
from extractor import parse_pdf
import time

# ensure unbuffered stdout for GitHub Actions / CI logs
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass


# ---------------- env / rest ----------------
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVICE_ROLE_KEY = (
    os.getenv("SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
)


if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    print("Please set SUPABASE_URL and SERVICE_ROLE_KEY in .env", file=sys.stderr)
    sys.exit(2)

REST_BASE = SUPABASE_URL.rstrip("/") + "/rest/v1"
TENDERS_ENDPOINT = REST_BASE + "/tenders"
HEADERS = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

# ---------------- config ----------------
PAGE_SIZE = 80  # how many rows to fetch per request
SIMPLE_EXTRACTION_COL = "simple_extraction"

# -------- Text helpers & extraction (UNCHANGED) --------
DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]+")
NON_ASCII_RE = re.compile(r"[^\x00-\x7F]+")
CONTROL_RE = re.compile(r"[\x00-\x1F\u007F]+")
MULTI_WHITESPACE_RE = re.compile(r"\s+")
ALLOWED_FINAL_RE = re.compile(r"[^A-Za-z0-9\s\-\.,:/\(\)%&\|]+")

LOG_EVERY = 20

def log_progress(done, total):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"{ts} INFO Progress: {done} / {total} rows processed")

def normalize_whitespace(s: str) -> str:
    return MULTI_WHITESPACE_RE.sub(" ", s).strip()


def strip_devanagari_and_non_ascii(s: str) -> str:
    if not s:
        return ""
    s = s.replace("\r", " ").replace("\n", " ")
    s = DEVANAGARI_RE.sub(" ", s)
    s = NON_ASCII_RE.sub(" ", s)
    s = CONTROL_RE.sub(" ", s)
    return normalize_whitespace(s)


def sanitize_final_field(s: str) -> str:
    if not s:
        return ""
    s = s.replace("\r", " ").replace("\n", " ")
    s = CONTROL_RE.sub(" ", s)
    s = ALLOWED_FINAL_RE.sub(" ", s)
    s = normalize_whitespace(s)
    s = re.sub(r"^[^\w%]+", "", s)
    s = re.sub(r"[^\w%]+$", "", s)
    return s.strip()


def load_pdf_pages(path: str):
    pages = []
    try:
        reader = PdfReader(path)
        for p in reader.pages:
            try:
                txt = p.extract_text() or ""
            except Exception:
                txt = ""
            pages.append(txt)
    except Exception:
        return []
    return pages


def find_label_value_singleline(text: str, label_variants):
    for label in label_variants:
        pat = re.compile(rf"{re.escape(label)}\s*[:/]\s*(?P<v>[^\n\r]+)", re.IGNORECASE)
        m = pat.search(text)
        if m:
            return m.group("v").strip()
        pat2 = re.compile(rf"{re.escape(label)}\s+(?P<v>[^\n\r]+)", re.IGNORECASE)
        m2 = pat2.search(text)
        if m2:
            return m2.group("v").strip()[:800].strip()
    return None


def detect_yes_no_near(text: str, markers):
    for mk in markers:
        for m in re.finditer(re.escape(mk), text, re.IGNORECASE):
            window = text[max(0, m.start() - 200): m.end() + 200]
            if re.search(r"Yes\s*\|\s*Complete", window, re.IGNORECASE):
                return "Yes"
            if re.search(r"\bYes\b", window, re.IGNORECASE):
                return "Yes"
            if re.search(r"\bNo\b", window, re.IGNORECASE):
                return "No"
    return None


def extract_numeric_amount(text: str, label_variants):
    for lv in label_variants:
        m = re.search(re.escape(lv) + r".{0,100}?([\d,]+)", text, re.IGNORECASE)
        if m:
            num = m.group(1).replace(",", "")
            try:
                return int(num)
            except Exception:
                continue
    m2 = re.search(r"EMD\s*Amount[:\s]*([\d,]+)", text, re.IGNORECASE)
    if m2:
        try:
            return int(m2.group(1).replace(",", ""))
        except Exception:
            return None
    return None


def extract_type_of_bid(text: str):
    m = re.search(
        r"(Single Packet Bid|Two Packet Bid|Two - Packet Bid|Single - Packet Bid|Two Packet)",
        text,
        re.IGNORECASE,
    )
    if not m:
        m = re.search(
            r"(Single Packet|Two Packet|Two - Packet|Single - Packet)",
            text,
            re.IGNORECASE,
        )
    if m:
        found = m.group(1)
        if "two" in found.lower():
            return "Two Packet Bid"
        elif "single" in found.lower():
            return "Single Packet Bid"
        else:
            return found.strip()
    return None


def extract_selected_fields_from_pdf(pdf_path: str) -> dict:
    pages = load_pdf_pages(pdf_path)
    full_text = "\n\n".join(pages)
    ascii_text = strip_devanagari_and_non_ascii(full_text)

    # ministry_state_name
    ministry = find_label_value_singleline(
        full_text,
        [
            "Ministry/State Name",
            "Ministry /State Name",
            "Ministry / State Name",
            "Ministry Name",
            "Ministry",
        ],
    )
    if not ministry:
        ministry = find_label_value_singleline(
            ascii_text,
            ["Ministry/State Name", "Ministry Of Defence", "Ministry"],
        )
    ministry = strip_devanagari_and_non_ascii(ministry or "")
    ministry = sanitize_final_field(ministry) or "N/A"

    # organisation_name
    org = find_label_value_singleline(
        full_text,
        [
            "Organisation Name",
            "Organisation / Name",
            "Organisation",
            "Organisation Name /",
            "Office Name",
            "Organisation Name /Office Name",
        ],
    )
    if not org:
        org = find_label_value_singleline(
            ascii_text,
            ["Organisation Name", "Indian Army", "Organisation", "Office Name"],
        )
    org = strip_devanagari_and_non_ascii(org or "")
    org = sanitize_final_field(org) or "N/A"

    # bid_to_ra_enabled
    bid_to_ra = detect_yes_no_near(
        full_text, ["Bid to RA enabled", "Bid to RA", "Bid to RA enabled?"]
    )
    if not bid_to_ra:
        bid_to_ra = detect_yes_no_near(ascii_text, ["Bid to RA enabled", "Bid to RA"])
    bid_to_ra = "Yes" if bid_to_ra and re.search(r"yes", bid_to_ra, re.IGNORECASE) else ("No" if bid_to_ra else "N/A")

    # type_of_bid
    t_of_bid = extract_type_of_bid(full_text) or extract_type_of_bid(ascii_text) or "N/A"
    t_of_bid = sanitize_final_field(t_of_bid)

    # emd_amount
    emd = extract_numeric_amount(
        full_text,
        [
            "EMD Amount",
            "EMD Amount:",
            "EMD Amount (",
            "EMD Amount (Rs)",
            "EMD Amount (Rs.)",
        ],
    )
    if emd is None:
        emd = extract_numeric_amount(ascii_text, ["EMD Amount", "EMD Amount:"])
    if isinstance(emd, int) and emd < 1000:
        emd_out = None
    else:
        emd_out = emd if isinstance(emd, int) else None

    # pages_count
    try:
        reader = PdfReader(pdf_path)
        pages_count = len(reader.pages)
    except Exception:
        pages_count = None
    pages_count_out = pages_count if isinstance(pages_count, int) and pages_count > 0 else None

    return {
        "ministry_state_name": ministry,
        "organisation_name": org,
        "bid_to_ra_enabled": bid_to_ra,
        "type_of_bid": t_of_bid,
        "emd_amount": emd_out,
        "pages_count": pages_count_out,
    }

def insert_tender_documents(tender_id: int, urls: list[dict], extraction_version: str):
    """
    Best-effort insert of document URLs.
    - Uses tender_id (tenders.id)
    - Ignores duplicates
    - Never raises
    """
    if not urls:
        return

    for u in urls:
        payload = {
            "tender_id": tender_id,
            "url": u.get("url"),
            "filename": u.get("filename"),
            "source": u.get("source"),
            "order_index": u.get("order"),
            "extraction_version": extraction_version,
        }

        try:
            requests.post(
                REST_BASE + "/tender_documents",
                headers={
                    **HEADERS,
                    "Prefer": "resolution=ignore-duplicates"
                },
                json=payload,
                timeout=30,
            )
        except Exception:
            # Never fail tender parsing because of document URLs
            pass


# ---------------- download ----------------
def download_pdf_public_url(url: str) -> str:
    resp = requests.get(url, stream=True, timeout=(8, 120))
    resp.raise_for_status()
    fd, tmp_path = tempfile.mkstemp(prefix="pdf_", suffix=".pdf")
    os.close(fd)
    with open(tmp_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)
    return tmp_path


# ---------------- supabase helpers ----------------
def fetch_pending_rows(limit: int = PAGE_SIZE, last_id: int = 0):
    params = {
        "select": "id,pdf_public_url,simple_extraction,updated_at",
        "order": "id.asc",
        "limit": str(limit),
        "id": f"gt.{last_id}",
        "simple_extraction": "is.null",
    }

    r = requests.get(TENDERS_ENDPOINT, headers=HEADERS, params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def fetch_total_pending_count():
    params = {
        "select": "id",
        "simple_extraction": "is.null",
        "limit": "1"
    }
    r = requests.get(TENDERS_ENDPOINT, headers={**HEADERS, "Prefer": "count=exact"}, params=params, timeout=30)
    r.raise_for_status()
    return int(r.headers.get("Content-Range", "0/0").split("/")[-1])


def fetch_tender_row(row_id: int):
    url = TENDERS_ENDPOINT
    params = {"select": "*", "id": f"eq.{row_id}"}
    r = requests.get(url, headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    arr = r.json()
    if not arr:
        return None
    return arr[0]


def patch_tender_row(row_id: int, payload: dict):
    url = TENDERS_ENDPOINT
    params = {"id": f"eq.{row_id}"}
    try:
        r = requests.patch(url, headers=HEADERS, params=params, json=payload, timeout=30)
        r.raise_for_status()
        return True
    except requests.HTTPError:
        try:
            text = r.text
        except Exception:
            text = "<no response body>"
        print(f"[PATCH_FAIL] id={row_id} status={getattr(r,'status_code',None)} body={text[:1000]}")
        return False
    except Exception as e:
        print(f"[PATCH_ERR] id={row_id} err={e}")
        return False


def iso_now_utc():
    return datetime.now(timezone.utc).isoformat()


def map_reverse_auction_to_json_bool(val: str):
    if val is None:
        return None
    v = str(val).strip().lower()
    if v in ("yes", "yes | complete"):
        return True
    if v == "no":
        return False
    return None


# ---------------- main ----------------
def main():
    last_id = 0

    total_pending = fetch_total_pending_count()
    if total_pending == 0:
        print("Nothing to process.")
        return
    processed = 0


    while True:
        rows = fetch_pending_rows(limit=PAGE_SIZE, last_id=last_id)
        if not rows:
            break

        max_id_in_batch = last_id

        for row in rows:
            row_id = row.get("id")

            if row_id and row_id > max_id_in_batch:
                max_id_in_batch = row_id

            if row.get("simple_extraction") is not None:
                continue

            pdf_url = row.get("pdf_public_url")
            if not row_id:
                continue

            # record the attempted time once per row and reuse it for all patches
            attempt_time = iso_now_utc()

            if not pdf_url:
                # mark as failed with attempt_time and simple_extraction='error'
                patch_tender_row(row_id, {"updated_at": attempt_time, SIMPLE_EXTRACTION_COL: "error"})
                continue

            tmp = None
            try:
                tmp = download_pdf_public_url(pdf_url)
            except Exception as e:
                patch_tender_row(row_id, {"updated_at": attempt_time, SIMPLE_EXTRACTION_COL: "error"})
                continue

            try:
                legacy = extract_selected_fields_from_pdf(tmp)
                extra = parse_pdf(tmp)   # NEW

                # Merge – extractor values take precedence if present
                extracted = {**legacy, **{k:v for k,v in extra.items() if v not in (None,"",[],{})}}

                # --- NEW: extract additional document URLs ---
                try:
                    doc_urls = extract_urls_from_pdf(tmp)
                    insert_tender_documents(
                        tender_id=row_id,
                        urls=doc_urls,
                        extraction_version="doc_urls_v1"
                    )
                except Exception:
                    # absolutely no impact on tender extraction
                    pass


                # full payload using fixed mapping (organization_name spelled with 'z')
                full_payload = {
                    "ministry": extracted.get("ministry_state_name") or "N/A",
                    "organization_name": extracted.get("organisation_name") or "N/A",
                    "reverse_auction_enabled": map_reverse_auction_to_json_bool(extracted.get("bid_to_ra_enabled")),
                    "bid_type": extracted.get("type_of_bid") or "N/A",
                    "emd_amount": extracted.get("emd_amount"),   # int or None
                    "page_count": extracted.get("pages_count"),

                    "item": extracted.get("item"),
                    "documents_required": extracted.get("documents_required"),
                    "arbitration_clause": extracted.get("arbitration_clause"),
                    "mediation_clause": extracted.get("mediation_clause"),
                    "show_documents_to_all": extracted.get("show_documents_to_all"),
                    "evaluation_method": extracted.get("evaluation_method"),
                    "past_performance_percentage": (
                        float(extracted["past_performance_percentage"])
                        if isinstance(extracted.get("past_performance_percentage"), (int, float))
                        else None
                    ),
                    "pincode": extracted.get("pin_code"),
                    "organization_address": extracted.get("district"),

                    # always write the attempted time into updated_at
                    "updated_at": attempt_time,
                    # mark success; if patch fails we'll overwrite this with error below
                    SIMPLE_EXTRACTION_COL: "success",
                }

                payload_to_send = full_payload

                # Never overwrite real DB data with blanks
                payload_to_send = {k:v for k,v in payload_to_send.items() if v not in (None,"",[],{})}
                ok = patch_tender_row(row_id, payload_to_send)
                if ok:
                    processed += 1
                    if processed % LOG_EVERY == 0 or processed == total_pending:
                        log_progress(processed, total_pending)
                else:
                    patch_tender_row(row_id, {"updated_at": attempt_time, SIMPLE_EXTRACTION_COL: "error"})


            except Exception as e:
                patch_tender_row(row_id, {"updated_at": attempt_time, SIMPLE_EXTRACTION_COL: "error"})

            finally:
                if tmp:
                    try:
                        os.remove(tmp)
                    except Exception:
                        pass

        last_id = max_id_in_batch
        time.sleep(0.25)


    if processed % LOG_EVERY != 0:
        log_progress(processed, total_pending)

if __name__ == "__main__":
    main()