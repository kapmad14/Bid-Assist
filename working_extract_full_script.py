#!/usr/bin/env python3
"""
batch_extract_to_db.py

- Reads SUPABASE_URL, SERVICE_ROLE_KEY, DATABASE_URL from .env
- Lists top 50 PDFs in Supabase storage folder 'bids/2025-12-06'
- Downloads each PDF (temp file), extracts fields using bundled extractor,
  and upserts results into Postgres table "pdf_test".
- Cleans up temp files after processing.
- Sequential processing (safer for rate-limits).
"""

import os
import io
import sys
import json
import time
import tempfile
import hashlib
from datetime import datetime
from typing import List, Optional, Tuple
from urllib.parse import quote

import requests
import psycopg2
from psycopg2.extras import Json
from dotenv import load_dotenv

# --- Load env ---
load_dotenv()  # reads .env from cwd by default

SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVICE_ROLE_KEY = os.getenv("SERVICE_ROLE_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")

if not SUPABASE_URL or not SERVICE_ROLE_KEY or not DATABASE_URL:
    print("Missing one of SUPABASE_URL, SERVICE_ROLE_KEY or DATABASE_URL in .env", file=sys.stderr)
    sys.exit(2)

# --- Constants ---
BUCKET = "gem-pdfs"  # adjust if your bucket name is different; change here if needed
PREFIX = "bids/2025-12-06/"
LIMIT = 50
# Supabase storage endpoints
LIST_ENDPOINT = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/list/{BUCKET}"
DOWNLOAD_ENDPOINT_BASE = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/{BUCKET}"  # /{object}

# --- HTTP session with auth ---
session = requests.Session()
session.headers.update({
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "apikey": SERVICE_ROLE_KEY,
})

# -------------------------------------
# Below: the extractor code you asked to keep (older past_performance logic + robust ePBG, docs, category)
# This is essentially the 'revised' extractor we agreed worked for you.
# -------------------------------------

import re
from pypdf import PdfReader

# Regex helpers
DEVANAGARI_RE = re.compile(r'[\u0900-\u097F]+')
NON_ASCII_RE = re.compile(r'[^\x00-\x7F]+')
CONTROL_RE = re.compile(r'[\x00-\x1F\u007F]+')
MULTI_WHITESPACE_RE = re.compile(r'\s+')
ALLOWED_FINAL_RE = re.compile(r'[^A-Za-z0-9\s\-\.,:/\(\)%&\|]+')

def normalize_whitespace(s: str) -> str:
    return MULTI_WHITESPACE_RE.sub(" ", s).strip()

def strip_devanagari_and_non_ascii(s: str) -> str:
    if not s:
        return ""
    s = s.replace("\r", " ").replace("\n", " ")
    s = DEVANAGARI_RE.sub(" ", s)
    s = NON_ASCII_RE.sub(" ", s)
    s = CONTROL_RE.sub(" ", s)
    s = normalize_whitespace(s)
    return s

def sanitize_final_field(s: str) -> str:
    if not s:
        return ""
    s = s.replace("\r", " ").replace("\n", " ")
    s = CONTROL_RE.sub(" ", s)
    s = ALLOWED_FINAL_RE.sub(" ", s)
    s = normalize_whitespace(s)
    # Trim stray punctuation at both ends but keep percent signs
    s = re.sub(r'^[^\w%]+', '', s)
    s = re.sub(r'[^\w%]+$', '', s)
    s = s.strip()
    return s

def _normalize_nbsp(s: str) -> str:
    return s.replace('\u00A0', ' ').replace('\u2007', ' ').replace('\u202F', ' ')

def load_pdf_pages(path: str) -> List[str]:
    reader = PdfReader(path)
    pages = []
    for p in reader.pages:
        try:
            txt = p.extract_text() or ""
        except Exception:
            txt = ""
        pages.append(txt)
    return pages

# find_multiline_after_anchor used by category/doc capture
def find_multiline_after_anchor(text: str, anchor_variants: List[str], stop_markers: List[str], max_chars: int = 2000) -> Optional[str]:
    for anchor in anchor_variants:
        m = re.search(re.escape(anchor), text, re.IGNORECASE)
        if m:
            start = m.end()
            end_idx = None
            for stop in stop_markers:
                sm = re.search(stop, text[start:], re.IGNORECASE)
                if sm:
                    cand = start + sm.start()
                    if end_idx is None or cand < end_idx:
                        end_idx = cand
            if end_idx is None:
                end_idx = min(start + max_chars, len(text))
            return text[start:end_idx].strip()
    return None

# Old-style past performance extractor (anchor-first then global fallback)
def extract_percent_near(text: str, keyword_variants: List[str]) -> Optional[str]:
    if not text:
        return None
    for kv in keyword_variants:
        m = re.search(re.escape(kv) + r'.{0,60}?(\d{1,3}(?:\.\d+)?\s*%)', text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
        m2 = re.search(r'(\d{1,3}(?:\.\d+)?\s*%)', text, re.IGNORECASE)
        if m2:
            return m2.group(1).strip()
    return None

# Strict labelled core for ePBG
def _extract_labelled_percent_core(text: str, label_variants: List[str], max_chars_after: int = 400) -> Optional[str]:
    if not text:
        return None
    norm_text = _normalize_nbsp(text)

    for lv in label_variants:
        for m in re.finditer(re.escape(lv), norm_text, re.IGNORECASE):
            start = max(0, m.start() - 30)
            end = min(len(norm_text), m.end() + max_chars_after)
            window = norm_text[start:end]

            pct_matches = [(mo.group(1), mo.start()) for mo in re.finditer(r'([+-]?\d{1,4}(?:\.\d+)?\s*(?:%|％))', window)]
            if pct_matches:
                label_pos = m.end() - start
                best_val, best_pos = min(pct_matches, key=lambda x: abs(x[1] - label_pos))
                val = re.sub(r'\s+', '', best_val).replace('％', '%')
                try:
                    f = float(re.sub(r'[%％]', '', val))
                    if abs(f - round(f)) < 1e-9:
                        return f"{int(round(f))}%"
                    else:
                        return f"{f:.2f}%"
                except Exception:
                    return val

            collapsed_window = re.sub(r'(?<=\d)[\s\u00A0\u2007\u202F\r\n]+(?=\d)', '', window)
            pct_matches2 = [(mo.group(1), mo.start()) for mo in re.finditer(r'([+-]?\d{1,4}(?:\.\d+)?\s*(?:%|％))', collapsed_window)]
            if pct_matches2:
                label_pos = m.end() - start
                best_val, best_pos = min(pct_matches2, key=lambda x: abs(x[1] - label_pos))
                val = re.sub(r'\s+', '', best_val).replace('％', '%')
                try:
                    f = float(re.sub(r'[%％]', '', val))
                    if abs(f - round(f)) < 1e-9:
                        return f"{int(round(f))}%"
                    else:
                        return f"{f:.2f}%"
                except Exception:
                    return val

            nums = [(mo.group(1), mo.start()) for mo in re.finditer(r'([0-9]{1,4}(?:\.\d+)?)', collapsed_window)]
            if nums:
                label_pos = m.end() - start
                candidates = []
                for s_num, pos in nums:
                    try:
                        f = float(s_num)
                    except:
                        continue
                    dist = abs(pos - label_pos)
                    candidates.append((s_num, f, pos, dist))
                if not candidates:
                    continue
                ge10 = [c for c in candidates if c[1] >= 10]
                chosen = None
                if ge10:
                    chosen = min(ge10, key=lambda x: x[3])
                else:
                    chosen = min(candidates, key=lambda x: x[3])
                s_num, fval, pos, dist = chosen
                if abs(fval - round(fval)) < 1e-9:
                    return f"{int(round(fval))}%"
                else:
                    return f"{fval:.2f}%"
    return None

def extract_epbg_labelled(text: str) -> Optional[str]:
    return _extract_labelled_percent_core(text, ["ePBG Percentage", "ePBG Percentage(%)", "ePBG Percentage (%)", "ePBG Percentage(%) :", "ePBG Percentage(%)"])

# Category and documents logic (kept from revised version)
def trim_category_garbage(cat: str) -> str:
    if not cat:
        return ""
    cat = CONTROL_RE.sub(" ", cat)
    cat = MULTI_WHITESPACE_RE.sub(" ", cat)
    cat = re.sub(r'[\)\%\s]{2,}$', '', cat)
    cat = re.sub(r'[\(\)\[\]\{\}\%\#\*\?]{3,}', ' ', cat)
    cat = normalize_whitespace(cat)
    cat = ALLOWED_FINAL_RE.sub(" ", cat)
    cat = normalize_whitespace(cat)
    if len(cat) > 2000:
        cat = cat[:2000].rsplit(" ", 1)[0]

    toks = cat.split()
    last_good = -1
    for i, t in enumerate(toks):
        if re.search(r'[A-Za-z]', t):
            last_good = i
        else:
            if len(t) >= 2 and not re.match(r'^[\W_]+$', t):
                last_good = i
    if last_good >= 0:
        toks = toks[: last_good + 1]
    cat = " ".join(toks).strip()
    cat = normalize_whitespace(cat)

    cat = re.sub(r'%{2,}', '%', cat)
    cat = re.sub(r'\s+%\s+', '% ', cat)
    cat = re.sub(r'[\)\]\}]{2,}', ')', cat)
    cat = re.sub(r'[\(\[\{]{2,}', '(', cat)
    cat = re.sub(r'(?<!\d)\s*%\s*(?!\d)', ' ', cat)
    cat = re.sub(r'(\(\s*\d+\s*\)\s*){2,}$', '', cat)

    cat = sanitize_final_field(cat)
    return cat

def _is_explanatory_sentence(s: str) -> bool:
    s_low = s.lower()
    explanatory_keywords = [
        'must', 'should', 'uploaded', 'upload', 'prove', 'evidence', 'supporting documents',
        'evaluation', 'will be displayed', 'do you want', 'clarification', 'representation', 'eligibility',
    ]
    if len(s) > 120:
        return True
    for kw in explanatory_keywords:
        if kw in s_low:
            return True
    if s.count(',') >= 3:
        return True
    return False

def capture_documents_list(full_text: str) -> Tuple[List[str], Optional[str]]:
    anchors = [
        "Document required (Requested in ATC)",
        "Document required from seller",
        "Document required",
        "Document required (Requested in ATC) from seller",
        "Document required from seller (Requested in ATC)",
    ]
    stop_markers = [
        "Minimum number", "Minimum number of", "Minimum Average", "Bid Details",
        "Bid End Date", "Bid Opening", "Bid Offer", "Total Quantity", "Primary product category"
    ]

    captured = None
    for anchor in anchors:
        m = re.search(re.escape(anchor), full_text, re.IGNORECASE)
        if m:
            start = m.end()
            end_idx = None
            for stop in stop_markers:
                sm = re.search(stop, full_text[start:], re.IGNORECASE)
                if sm:
                    cand = start + sm.start()
                    if end_idx is None or cand < end_idx:
                        end_idx = cand
            if end_idx is None:
                end_idx = min(start + 3000, len(full_text))
            captured = full_text[start:end_idx].strip()
            break

    if not captured:
        m = re.search(r"Experience Criteria", full_text, re.IGNORECASE)
        if m:
            start = m.start()
            captured = full_text[start:start + 2000]

    if not captured:
        return [], None

    captured = _normalize_nbsp(captured)
    captured = captured.replace('\r', ' ').replace('\n', ' ')
    captured = normalize_whitespace(captured)

    explanatory_note = None
    sentences = re.split(r'(?<=[\.\?\n])\s+|(?=In case)', captured)
    remaining = captured

    for s in sentences:
        s_clean = strip_devanagari_and_non_ascii(s).strip()
        if not s_clean:
            continue
        if _is_explanatory_sentence(s_clean):
            explanatory_note = sanitize_final_field(s_clean)
            remaining = remaining.replace(s, " ")
            break

    tokens = [t.strip() for t in re.split(r'[\u2022•;•\-–—\n]+', remaining) if t.strip()]
    tokens_out = []
    seen = set()

    def looks_like_doc_title(tok: str) -> bool:
        t = strip_devanagari_and_non_ascii(tok)
        t = sanitize_final_field(t)
        if not t or len(t) < 3:
            return False
        if _is_explanatory_sentence(t):
            return False
        if len(t) > 150:
            return False
        words = t.split()
        if len(words) > 18:
            return False
        allow_kws = ['certificate', 'experience', 'turnover', 'authorization', 'oem', 'additional', 'past performance', 'bidder', 'document', 'certificate']
        low = t.lower()
        if any(kw in low for kw in allow_kws):
            return True
        if re.search(r'[A-Za-z]', t) and len(t) <= 100:
            return True
        return False

    for tok in tokens:
        t0 = strip_devanagari_and_non_ascii(tok)
        t0 = normalize_whitespace(t0)
        t0 = sanitize_final_field(t0)
        if not t0:
            continue
        if t0.lower() in seen:
            continue
        if looks_like_doc_title(t0):
            tokens_out.append(t0)
            seen.add(t0.lower())

    if not tokens_out and explanatory_note:
        pieces = [p.strip() for p in re.split(r'[,\u2022;]+', explanatory_note) if p.strip()]
        for p in pieces:
            t0 = sanitize_final_field(strip_devanagari_and_non_ascii(p))
            if not t0:
                continue
            if t0.lower() in seen:
                continue
            if looks_like_doc_title(t0):
                tokens_out.append(t0)
                seen.add(t0.lower())
            if len(tokens_out) >= 20:
                break

    if not tokens_out:
        comma_pieces = [p.strip() for p in re.split(r',', remaining) if p.strip()]
        for piece in comma_pieces:
            t0 = sanitize_final_field(strip_devanagari_and_non_ascii(piece))
            if not t0:
                continue
            if t0.lower() in seen:
                continue
            if looks_like_doc_title(t0):
                tokens_out.append(t0)
                seen.add(t0.lower())
            if len(tokens_out) >= 20:
                break

    return tokens_out, explanatory_note

def find_label_value_singleline(text: str, label_variants: List[str]) -> Optional[str]:
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

def extract_numeric_amount(text: str, label_variants: List[str]) -> Optional[int]:
    for lv in label_variants:
        m = re.search(re.escape(lv) + r'.{0,100}?([\d,]+)', text, re.IGNORECASE)
        if m:
            num = m.group(1)
            num = num.replace(",", "")
            try:
                return int(num)
            except Exception:
                continue
    m2 = re.search(r'EMD\s*Amount[:\s]*([\d,]+)', text, re.IGNORECASE)
    if m2:
        try:
            return int(m2.group(1).replace(",", ""))
        except Exception:
            return None
    return None

def detect_yes_no_near(text: str, markers: List[str]) -> Optional[str]:
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

def extract_fields_from_pdf(pdf_path: str) -> dict:
    pages = load_pdf_pages(pdf_path)
    full_text = "\n\n".join(pages)
    ascii_text = strip_devanagari_and_non_ascii(full_text)

    # pages count
    try:
        reader = PdfReader(pdf_path)
        pages_count = len(reader.pages)
    except Exception:
        pages_count = len(pages)

    # ministry/state name
    ministry = find_label_value_singleline(full_text, ["Ministry/State Name", "Ministry /State Name", "Ministry / State Name", "Ministry Name", "Ministry"])
    if not ministry:
        ministry = find_label_value_singleline(ascii_text, ["Ministry/State Name", "Ministry Of Defence", "Ministry"])
    ministry = strip_devanagari_and_non_ascii(ministry or "")
    ministry = sanitize_final_field(ministry)
    ministry = ministry if ministry else None

    # organisation name
    org = find_label_value_singleline(full_text, ["Organisation Name", "Organisation / Name", "Organisation", "Organisation Name /", "Office Name", "Organisation Name /Office Name"])
    if not org:
        org = find_label_value_singleline(ascii_text, ["Organisation Name", "Indian Army", "Organisation", "Office Name"])
    org = strip_devanagari_and_non_ascii(org or "")
    org = sanitize_final_field(org)
    org = org if org else None

    # category
    cat = find_multiline_after_anchor(full_text,
                                     ["Item Category", "Item Category /", "Item Category:", "Primary product category", "Primary product category"],
                                     ["Minimum Average", "Minimum Average Annual", "Total Quantity", "Bid Details", "Documents", "Document required"],
                                     max_chars=2200)
    if not cat:
        cat = find_multiline_after_anchor(ascii_text,
                                         ["Item Category", "Primary product category"],
                                         ["Minimum Average", "Total Quantity", "Bid Details"], max_chars=2200)
    if not cat:
        m = re.search(r"(MCB[\s\S]{0,800})", full_text, re.IGNORECASE)
        cat = m.group(1) if m else ""
    cat = strip_devanagari_and_non_ascii(cat or "")
    cat = trim_category_garbage(cat)
    cat = cat if cat else None

    # MSE and Startup exemptions (Yes/No)
    mse = detect_yes_no_near(full_text, ["MSE", "MSE Exemption", "MSE Exemption for Turnover", "/ MSE", "MSE ("])
    if not mse:
        mse = detect_yes_no_near(ascii_text, ["MSE", "MSE Exemption"])
    startup = detect_yes_no_near(full_text, ["Startup", "Startup Exemption", "Startup Exemption for Turnover"])
    if not startup:
        startup = detect_yes_no_near(ascii_text, ["Startup", "Startup Exemption"])
    mse = "Yes" if mse and re.search(r"yes", mse, re.IGNORECASE) else "No"
    startup = "Yes" if startup and re.search(r"yes", startup, re.IGNORECASE) else "No"

    # documents
    documents, documents_explanatory_note = capture_documents_list(full_text)

    # past_performance: old anchor-first + global-percent fallback
    past_perf = extract_percent_near(full_text, ["Past Performance", "Past performance"])
    if not past_perf:
        past_perf = extract_percent_near(ascii_text, ["Past Performance", "Past performance"])
    past_perf = strip_devanagari_and_non_ascii(past_perf or "")
    past_perf = sanitize_final_field(past_perf) if past_perf else None

    # bid_to_ra_enabled
    bid_to_ra = detect_yes_no_near(full_text, ["Bid to RA enabled", "Bid to RA", "Bid to RA enabled?"])
    if not bid_to_ra:
        bid_to_ra = detect_yes_no_near(ascii_text, ["Bid to RA enabled", "Bid to RA"])
    bid_to_ra = "Yes" if bid_to_ra and re.search(r"yes", bid_to_ra, re.IGNORECASE) else "No"

    # type_of_bid
    type_of_bid = None
    mtype = re.search(r'(Single Packet Bid|Two Packet Bid|Two - Packet Bid|Single - Packet Bid|Two Packet)', full_text, re.IGNORECASE)
    if not mtype:
        mtype = re.search(r'(Single Packet|Two Packet|Two - Packet|Single - Packet)', ascii_text, re.IGNORECASE)
    if mtype:
        found = mtype.group(1)
        if 'two' in found.lower():
            type_of_bid = "Two Packet Bid"
        elif 'single' in found.lower():
            type_of_bid = "Single Packet Bid"
        else:
            type_of_bid = found.strip()

    # EMD Amount
    emd = extract_numeric_amount(full_text, ["EMD Amount", "EMD Amount:", "EMD Amount (", "EMD Amount (Rs)", "EMD Amount (Rs.)"])
    if emd is None:
        emd = extract_numeric_amount(ascii_text, ["EMD Amount", "EMD Amount:"])

    # ePBG Percentage
    epbg = extract_epbg_labelled(full_text)
    if not epbg:
        epbg = extract_epbg_labelled(ascii_text)
    if epbg:
        epbg = strip_devanagari_and_non_ascii(epbg)
        epbg = sanitize_final_field(epbg)

    # MII Purchase Preference and MSE Purchase Preference
    mii_pref = detect_yes_no_near(full_text, ["MII Purchase Preference", "MII Purchase Preference:" , "MII Purchase"])
    if not mii_pref:
        mii_pref = detect_yes_no_near(ascii_text, ["MII Purchase Preference", "MII Purchase"])
    if mii_pref:
        mii_pref = "Yes" if re.search(r"yes", mii_pref, re.IGNORECASE) else "No"
    else:
        mii_pref = None

    mse_pp = detect_yes_no_near(full_text, ["MSE Purchase Preference", "MSE Purchase Preference:", "Purchase Preference (MSE)"])
    if not mse_pp:
        mse_pp = detect_yes_no_near(ascii_text, ["MSE Purchase Preference", "MSE Purchase"])
    if mse_pp:
        mse_pp = "Yes" if re.search(r"yes", mse_pp, re.IGNORECASE) else "No"
    else:
        mse_pp = None

    result = {
        "ministry_state_name": ministry,
        "organisation_name": org,
        "category": cat,
        "mse_exemption": mse,
        "startup_exemption": startup,
        "documents_required": documents,
        "documents_explanatory_note": documents_explanatory_note,
        "past_performance": past_perf,
        "bid_to_ra_enabled": bid_to_ra,
        "type_of_bid": type_of_bid,
        "emd_amount": emd,
        "epbg_percentage": epbg,
        "mii_purchase_preference": mii_pref,
        "mse_purchase_preference": mse_pp,
        "pages_count": pages_count
    }
    return result

# -------------------------------------
# DB helpers and main pipeline
# -------------------------------------

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS pdf_test (
  pdf_path TEXT PRIMARY KEY,
  pdf_name TEXT,
  ministry_state_name TEXT,
  organisation_name TEXT,
  category TEXT,
  mse_exemption TEXT,
  startup_exemption TEXT,
  documents_required JSONB,
  documents_explanatory_note TEXT,
  past_performance TEXT,
  bid_to_ra_enabled TEXT,
  type_of_bid TEXT,
  emd_amount INTEGER,
  epbg_percentage TEXT,
  mii_purchase_preference TEXT,
  mse_purchase_preference TEXT,
  pages_count INTEGER,
  raw_json JSONB,
  extracted_at TIMESTAMPTZ DEFAULT now()
);
"""

UPSERT_SQL = """
INSERT INTO pdf_test (
  pdf_path, pdf_name,
  ministry_state_name, organisation_name, category,
  mse_exemption, startup_exemption,
  documents_required, documents_explanatory_note,
  past_performance, bid_to_ra_enabled, type_of_bid,
  emd_amount, epbg_percentage,
  mii_purchase_preference, mse_purchase_preference,
  pages_count, raw_json
)
VALUES (
  %(pdf_path)s, %(pdf_name)s,
  %(ministry_state_name)s, %(organisation_name)s, %(category)s,
  %(mse_exemption)s, %(startup_exemption)s,
  %(documents_required)s, %(documents_explanatory_note)s,
  %(past_performance)s, %(bid_to_ra_enabled)s, %(type_of_bid)s,
  %(emd_amount)s, %(epbg_percentage)s,
  %(mii_purchase_preference)s, %(mse_purchase_preference)s,
  %(pages_count)s, %(raw_json)s
)
ON CONFLICT (pdf_path) DO UPDATE SET
  pdf_name = EXCLUDED.pdf_name,
  ministry_state_name = EXCLUDED.ministry_state_name,
  organisation_name = EXCLUDED.organisation_name,
  category = EXCLUDED.category,
  mse_exemption = EXCLUDED.mse_exemption,
  startup_exemption = EXCLUDED.startup_exemption,
  documents_required = EXCLUDED.documents_required,
  documents_explanatory_note = EXCLUDED.documents_explanatory_note,
  past_performance = EXCLUDED.past_performance,
  bid_to_ra_enabled = EXCLUDED.bid_to_ra_enabled,
  type_of_bid = EXCLUDED.type_of_bid,
  emd_amount = EXCLUDED.emd_amount,
  epbg_percentage = EXCLUDED.epbg_percentage,
  mii_purchase_preference = EXCLUDED.mii_purchase_preference,
  mse_purchase_preference = EXCLUDED.mse_purchase_preference,
  pages_count = EXCLUDED.pages_count,
  raw_json = EXCLUDED.raw_json,
  extracted_at = now();
"""

def pg_connect():
    return psycopg2.connect(DATABASE_URL)

def ensure_table(conn):
    with conn.cursor() as cur:
        cur.execute(CREATE_TABLE_SQL)
        conn.commit()

def upsert_result(conn, pdf_path: str, pdf_name: str, extracted: dict):
    # prepare row data mapping dedicated columns (documents_required is JSONB)
    row = {
        "pdf_path": pdf_path,
        "pdf_name": pdf_name,
        "ministry_state_name": extracted.get("ministry_state_name"),
        "organisation_name": extracted.get("organisation_name"),
        "category": extracted.get("category"),
        "mse_exemption": extracted.get("mse_exemption"),
        "startup_exemption": extracted.get("startup_exemption"),
        "documents_required": Json(extracted.get("documents_required") or []),
        "documents_explanatory_note": extracted.get("documents_explanatory_note"),
        "past_performance": extracted.get("past_performance"),
        "bid_to_ra_enabled": extracted.get("bid_to_ra_enabled"),
        "type_of_bid": extracted.get("type_of_bid"),
        "emd_amount": extracted.get("emd_amount"),
        "epbg_percentage": extracted.get("epbg_percentage"),
        "mii_purchase_preference": extracted.get("mii_purchase_preference"),
        "mse_purchase_preference": extracted.get("mse_purchase_preference"),
        "pages_count": extracted.get("pages_count"),
        "raw_json": Json(extracted)
    }
    with conn.cursor() as cur:
        cur.execute(UPSERT_SQL, row)
        conn.commit()

# -------------------------------------
# Supabase storage helpers
# -------------------------------------

def list_objects(prefix: str, limit: int = 1000) -> List[dict]:
    """
    List objects under prefix using Supabase Storage REST API.
    Returns objects list (each item has at least 'name', optionally 'updated_at').
    """
    body = {"prefix": prefix, "limit": 1500}
    resp = session.post(LIST_ENDPOINT, json=body, timeout=30)
    resp.raise_for_status()
    objs = resp.json() or []
    # Filter only objects that look like files and contain a name
    objs = [o for o in objs if o.get("name")]
    return objs


def download_object_to_temp(name: str, max_retries: int = 3, debug: bool = False) -> str:
    """
    Robust download helper:
    - Try prefixed path (PREFIX + name) first, then name as-is.
    - Percent-encode path preserving '/'.
    - Try authenticated endpoint then public endpoint for each candidate.
    - Use connect/read timeouts and exponential backoff.
    - Returns a temp file path (caller must delete it).
    """
    # Build ordered candidates: prefer PREFixed (most likely to succeed fast)
    candidates = []
    if name.startswith(PREFIX):
        candidates.append(name)
    else:
        candidates.append(PREFIX + name)   # try with prefix first
        candidates.append(name)            # then try as returned

    # dedupe while preserving order
    seen = set()
    candidates = [c for c in candidates if not (c in seen or seen.add(c))]

    # Request timeout tuple: (connect_timeout, read_timeout)
    TIMEOUT = (8, 60)  # tuneable

    last_exc = None
    try:
        for obj_path in candidates:
            encoded = quote(obj_path, safe='/')
            auth_url = f"{DOWNLOAD_ENDPOINT_BASE}/{encoded}"
            public_url_direct = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/{BUCKET}/{encoded}"
            url_candidates = [auth_url, public_url_direct]

            if debug:
                print(f"[debug] Trying object path candidate: '{obj_path}'")
                for u in url_candidates:
                    print(f"[debug]  -> will try URL: {u}")

            for url in url_candidates:
                attempt = 0
                while attempt <= max_retries:
                    try:
                        # tighter timeouts; stream True for chunked write
                        r = session.get(url, timeout=TIMEOUT, stream=True)
                        # treat 400/403/404 as permanent for this url -> break to next url
                        if r.status_code in (400, 403, 404):
                            r.raise_for_status()
                        r.raise_for_status()

                        suffix = os.path.splitext(obj_path)[1] or ".pdf"
                        fd, tmp_path = tempfile.mkstemp(prefix="pdf_", suffix=suffix)
                        os.close(fd)
                        with open(tmp_path, "wb") as f:
                            for chunk in r.iter_content(chunk_size=8192):
                                if chunk:
                                    f.write(chunk)
                        if debug:
                            print(f"[debug] Download succeeded from: {url} -> {tmp_path}")
                        return tmp_path

                    except requests.HTTPError as he:
                        last_exc = he
                        # Permanent client errors for this url: break and try next candidate url
                        if he.response is not None and he.response.status_code in (400, 403, 404):
                            if debug:
                                print(f"[debug] HTTP {he.response.status_code} from {url} (skip to next candidate)")
                            break
                        attempt += 1
                        sleep_for = 0.8 * (2 ** (attempt - 1))
                        if debug:
                            print(f"[debug] HTTPError from {url}, retry {attempt}/{max_retries}, sleeping {sleep_for}s: {he}")
                        time.sleep(sleep_for)
                    except requests.RequestException as rexc:
                        last_exc = rexc
                        attempt += 1
                        sleep_for = 0.8 * (2 ** (attempt - 1))
                        if debug:
                            print(f"[debug] RequestException from {url}, retry {attempt}/{max_retries}, sleeping {sleep_for}s: {rexc}")
                        time.sleep(sleep_for)
        # none of the candidates worked
    except KeyboardInterrupt:
        # If user cancelled, try to surface a friendly message and let caller handle cleanup
        raise KeyboardInterrupt("Download interrupted by user")
    raise last_exc or Exception(f"Failed to download {name} (tried candidates: {candidates})")



# -------------------------------------
# Main pipeline
# -------------------------------------
def main():
    # 1) list objects
    objs = list_objects(PREFIX)
    if not objs:
        print(f"No objects found under prefix {PREFIX}", file=sys.stderr)
        return

    # Try to sort by 'updated_at' if present, else by name
    def sort_key(o):
        dt = o.get("updated_at") or o.get("last_modified") or ""
        return dt
    # if updated_at exists (ISO), sort desc; else fallback to name ascending
    if any(o.get("updated_at") for o in objs):
        objs_sorted = sorted(objs, key=lambda o: o.get("updated_at") or "", reverse=True)
    else:
        objs_sorted = sorted(objs, key=lambda o: o.get("name") or "")
    to_process = objs_sorted[:LIMIT]

    # 2) DB connection and ensure table
    conn = pg_connect()
    ensure_table(conn)

    # 3) iterate sequentially
    count = 0
    for o in to_process:
        name = o.get("name")
        if not name:
            continue
        pdf_path = name  # full path like "bids/2025-12-06/GeM_061225_B_6813211.pdf"
        pdf_name = os.path.basename(name)
        try:
            tmp = download_object_to_temp(name)
        except Exception as e:
            # We silently skip downloads per your "no logs" preference, but still raise so user can see failure
            print(f"Error downloading {name}: {e}", file=sys.stderr)
            continue

        try:
            extracted = extract_fields_from_pdf(tmp)
            # upsert into DB
            upsert_result(conn, pdf_path, pdf_name, extracted)
            count += 1
        except Exception as e:
            print(f"Error processing {name}: {e}", file=sys.stderr)
        finally:
            try:
                os.remove(tmp)
            except Exception:
                pass

    conn.close()
    print(f"Processed {count} PDFs and upserted results into pdf_test")

if __name__ == "__main__":
    main()
