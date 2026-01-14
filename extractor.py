import os
import re
import json
import warnings
from pypdf import PdfReader
from item_category_extractor import get_item_category
import csv
import requests


warnings.filterwarnings("ignore", category=DeprecationWarning)

PDF_DIR = "tender-pdfs"

BID_REGEX = re.compile(r"(GEM/\d{4}/B/\d+)")

LABEL_ITEM = re.compile(
    r"Item\s*Category[^A-Za-z0-9]+(.+?)(?=Searched|Minimum Average Annual Turnover|OEM Average Turnover|Years of Past Experience Required|MSE Exemption|Startup Exemption|Document required from seller|Bid Number)",
    re.S | re.I,
)

LABEL_DOCS = re.compile(
    r"Document\s*required\s*from\s*seller[^A-Za-z0-9]+(.+?)(?=Do you want to show documents|Bid to RA|Evaluation Method|Arbitration Clause)",
    re.S | re.I,
)

LABEL_ARBITRATION = re.compile(
    r"Evaluation\s*Method.*?Arbitration\s*Clause\s*(Yes|No)", re.I | re.S
)

LABEL_MEDIATION = re.compile(
    r"Arbitration\s*Clause.*?Mediation\s*Clause\s*(Yes|No)", re.I | re.S
)

LABEL_SHOW_DOCS = re.compile(
    r"Do\s*you\s*want\s*to\s*show\s*documents\s*uploaded\s*by\s*bidders\s*to\s*all\s*bidders\s*participated\s*in\s*bid\??[^A-Za-z0-9]+(Yes|No)",
    re.I,
)

LABEL_PAST_PERF = re.compile(
    r"Past\s*Performance.*?(\d{1,3})\s*%(?!.*\d)",
    re.I | re.S
)



LABEL_EVAL_METHOD = re.compile(
    r"Evaluation\s*Method[^A-Za-z]+(Total value wise evaluation|Item wise evaluation|QCBS)",
    re.I,
)

PIN_CSV_URL = "https://drive.google.com/uc?export=download&id=15qbbFvxK1JHE2ZMSSDdxVoFJ7L5K5xLa"

PIN_AT_START = re.compile(r"^\s*(\d{6})\s*,")
PIN_AT_END   = re.compile(r"(?:-|–|\s)(\d{6})$")
PIN_REGEX    = re.compile(r"\b(\d{6})\b")

STAR_TRAIL_LOCATION = re.compile(r"\*{10,}\s*([A-Z][A-Z ]{2,})", re.I)
STOP_ROW = re.compile(r"Buyer\s*Added\s*Bid|Additional\s*Requirement|Disclaimer", re.I)


def ascii_mirror(text):
    return re.sub(r"[^\x00-\x7F]+", " ", text)

def clean_text(text):
    text = re.sub(r"[\x00-\x1F\x7F]", " ", text)
    text = re.sub(r"[^\x00-\x7F]+", " ", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()

def extract_bid_number(text):
    m = BID_REGEX.search(text)
    return m.group(1) if m else None

def extract_item_category(pdf_path):
    return get_item_category(pdf_path)

def extract_documents(text):
    m = LABEL_DOCS.search(text)
    if not m:
        return []
    raw = clean_text(m.group(1))
    raw = re.sub(r"\b\d+\s+\d+\s+", "", raw)
    raw = re.sub(r"\*In case.*", "", raw, flags=re.I)

    docs = []
    for p in raw.split(","):
        p = p.strip()
        if len(p) > 3:
            docs.append(p)
    return docs

def extract_bool(pattern, text):
    m = pattern.search(text)
    if not m:
        return None
    return m.group(1).lower() == "yes"

def extract_past_perf(text):
    # Find patterns like "7दश%न", "Bदश%न", "5दश%न"
    for m in re.finditer(r".दश%न", text):
        # take only the next 80 chars
        window = text[m.end(): m.end() + 80]

        # split lines
        lines = window.splitlines()

        # look only in the NEXT non-empty line
        for ln in lines:
            ln = ln.strip()
            if not ln:
                continue

            num = re.search(r"(\d{1,3})\s*%", ln)
            if num:
                val = int(num.group(1))
                if 1 <= val <= 100:
                    return val
            break   # never go beyond the first content line

    return None

def extract_eval_method(text):
    m = LABEL_EVAL_METHOD.search(text)
    return m.group(1).strip() if m else None

def load_pin_map():
    resp = requests.get(PIN_CSV_URL, timeout=30)
    resp.raise_for_status()

    pin_map = {}
    reader = csv.DictReader(resp.text.splitlines())
    for row in reader:
        pin = row.get("pincode", "").strip()
        if pin.isdigit():
            pin_map[pin] = row.get("district", "").strip().upper()
    return pin_map

def normalize_addr(s):
    return re.sub(r"\s+", " ", s).strip()


def extract_address_block(text):
    rows, buf = [], []
    started = False

    for raw in text.splitlines():
        line = normalize_addr(raw)

        if started and re.fullmatch(r"\d{1,5}", line):
            break

        if STOP_ROW.search(line):
            break

        m = STAR_TRAIL_LOCATION.search(line)
        if m:
            if not any(PIN_REGEX.search(x) for x in buf):
                started = True
                if buf:
                    rows.append("\n".join(buf))
                    buf = []
                buf.append("**********" + m.group(1).strip())
            continue

        if PIN_AT_START.match(line) or PIN_AT_END.search(line):
            started = True
            buf = [x for x in buf if not STAR_TRAIL_LOCATION.search(x)]
            if buf:
                rows.append("\n".join(buf))
                buf = []
            buf.append(line)

    if buf:
        rows.append("\n".join(buf))

    return rows[0] if rows else ""


def resolve_pin_and_district(block, pin_map):
    m = PIN_REGEX.search(block)
    if m:
        pin = m.group(1)
        return pin, pin_map.get(pin, "")

    m = STAR_TRAIL_LOCATION.search(block)
    if m:
        candidate = m.group(1).strip().upper()
        if re.fullmatch(r"(NORTH|SOUTH|EAST|WEST)(\s+AND.*)?", candidate):
            return "", ""
        return "", candidate

    return "", ""

_PIN_MAP = None

def get_pin_map():
    global _PIN_MAP
    if _PIN_MAP is None:
        _PIN_MAP = load_pin_map()
    return _PIN_MAP


def parse_pdf(path):
    reader = PdfReader(path)
    text = ""
    for p in reader.pages:
        t = p.extract_text()
        if t:
            text += "\n" + t

    text_raw = text                     # keep original with Hindi corruption
    text_ascii = clean_text(ascii_mirror(text))

    addr_block = extract_address_block(text_raw)
    if addr_block:
        pin_code, district = resolve_pin_and_district(addr_block, get_pin_map())
    else:
        pin_code, district = "", ""


    return {
        "file": os.path.basename(path),
        "bid_number": extract_bid_number(text_ascii),
        "item": extract_item_category(path),
        "documents_required": extract_documents(text_ascii),
        "arbitration_clause": extract_bool(LABEL_ARBITRATION, text_ascii),
        "mediation_clause": extract_bool(LABEL_MEDIATION, text_ascii),
        "show_documents_to_all": extract_bool(LABEL_SHOW_DOCS, text_ascii),
        "past_performance_percentage": extract_past_perf(text_raw),
        "evaluation_method": extract_eval_method(text_ascii),
        "pin_code": pin_code,
        "district": district,
    }