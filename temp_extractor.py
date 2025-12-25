import os
import re
import json
import warnings
from pypdf import PdfReader
from typing import Optional

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

RE_GARBAGE = re.compile(r"(\*|\.)\s*(\*|\.)\s*(/|\\).*")
RE_MULTI_PERC = re.compile(r"(%\s*){2,}.*$")
RE_TRAIL_SLASH = re.compile(r"\s+[/\\].*$")
RE_TRAIL_DOTS = re.compile(r"(\.\s*){2,}$")
RE_TRAIL_NUMS = re.compile(r"\s+\d+(\s+\d+)+$")
RE_MULTI_STAR = re.compile(r"\s*(\*\s*){2,}.*$")

def ascii_mirror(text):
    return re.sub(r"[^\x00-\x7F]+", " ", text)

def clean_text(text):
    text = re.sub(r"[\x00-\x1F\x7F]", " ", text)
    text = re.sub(r"[^\x00-\x7F]+", " ", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()

def normalize_item(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None

    raw = clean_text(raw)
    raw = raw.replace("\n", " ").replace("\r", " ")
    raw = re.sub(r"\s{2,}", " ", raw)

    # remove GeM structural garbage
    raw = re.sub(r"\)\s*\)\s*%.*$", "", raw)
    raw = re.sub(r"\s+/Contract Period.*$", "", raw, flags=re.I)
    raw = re.sub(r"\bMSE Relaxation.*$", "", raw, flags=re.I)
    raw = re.sub(r"\bStartup Relaxation.*$", "", raw, flags=re.I)
    raw = re.sub(r"\bBid to RA enabled.*$", "", raw, flags=re.I)
    raw = re.sub(r"\bType of Bid.*$", "", raw, flags=re.I)

    # remove PDF garbage patterns
    raw = re.sub(r"(\*|\.)\s*(\*|\.)\s*(/|\\).*", "", raw)
    raw = re.sub(r"(%\s*){2,}.*$", "", raw)
    raw = re.sub(r"\s+[/\\].*$", "", raw)
    raw = re.sub(r"\s*(\*\s*){2,}.*$", "", raw)
    raw = re.sub(r"(\.\s*){2,}$", "", raw)
    raw = re.sub(r"\s+\d+(\s+\d+)+$", "", raw)

    # remove leading conjunction junk
    raw = re.sub(r"^(and|or)\s+", "", raw, flags=re.I)

    raw = raw.strip()
    if not raw:
        return None

    # Multiple package detection
    if re.search(r"\bPackage\s*No\.\s*\d+", raw, re.I) and "," in raw:
        return "Multiple Packages"

    # Custom / service bids
    if raw.lower().startswith("custom bid for services"):
        raw = raw.split("/", 1)[0].strip()

    if re.search(r"\bService\s*-", raw):
        raw = raw.split("/", 1)[0].strip()

    # collapse PAC / BOQ dumps
    parts = [p.strip() for p in raw.split(",") if len(p.strip()) > 3]
    if len(parts) >= 3:
        raw = parts[0].strip()

    raw = raw.strip()
    if not raw:
        return None

    # FINAL structural garbage filter — must be LAST
    if (
        re.fullmatch(r"[A-Za-z ]{3,25}", raw)
        and len(raw.split()) <= 2
        and not re.search(r"\d|[A-Z]{2,}|\b(of|for|with)\b", raw, re.I)
    ):
        return None

    return raw




def extract_bid_number(text):
    m = BID_REGEX.search(text)
    return m.group(1) if m else None

def extract_item_category(text):
    m = LABEL_ITEM.search(text)
    if not m:
        return None

    raw = clean_text(m.group(1))
    raw = re.sub(r"\s+GeMARPTS.*$", "", raw, flags=re.I)

    return normalize_item(raw)


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
        "item": extract_item_category(text_ascii),
        #"documents_required": extract_documents(text_ascii),
        #"arbitration_clause": extract_bool(LABEL_ARBITRATION, text_ascii),
        #"mediation_clause": extract_bool(LABEL_MEDIATION, text_ascii),
        #"show_documents_to_all": extract_bool(LABEL_SHOW_DOCS, text_ascii),
        #"past_performance_min_percent": extract_past_perf(text_raw),
        #"evaluation_method": extract_eval_method(text_ascii),
    }

def main():
    results = []
    for fn in sorted(os.listdir(PDF_DIR)):
        if fn.lower().endswith(".pdf"):
            full = os.path.join(PDF_DIR, fn)
            results.append(parse_pdf(full))

    with open("temp_extracted_tenders.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    print("Saved temp_extracted_tenders.json")

if __name__ == "__main__":
    main()
