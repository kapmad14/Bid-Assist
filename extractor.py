import os
import re
import json
import warnings
from pypdf import PdfReader
from item_category_extractor import get_item_category


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

def parse_pdf(path):
    reader = PdfReader(path)
    text = ""
    for p in reader.pages[:3]:
        t = p.extract_text()
        if t:
            text += "\n" + t

    text_raw = text                     # keep original with Hindi corruption
    text_ascii = clean_text(ascii_mirror(text))

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
    }