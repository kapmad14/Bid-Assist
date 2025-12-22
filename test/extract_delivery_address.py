from typing import List, Optional, Dict
import re
import json
import requests

from text_cleaning import clean_line


# =============================
# Anchors
# =============================

CONSIGNEE_ANCHORS = [
    "Consignee",
    "Consignees",
    "Reporting Officer",
]

STOP_ANCHORS = [
    "Bid Number",
    "Bid End Date",
    "Technical Specification",
    "Document required from seller",
    "Eligibility Criteria",
    "Terms and Conditions",
]


# =============================
# Validation Rules
# =============================

JUNK_PATTERNS = [
    r"\broom\b",
    r"\bblock\b",
    r"\bfloor\b",
    r"\bofficer\b",
    r"\breporting\b",
    r"\bquantity\b",
    r"\btest\b",
    r"\btests\b",
    r"\bbid\b",
    r"\brequirement\b",
    r"\bcategory\b",
    r"\bconsignee\b",
    r"\baddress\b",
    r"\ballowed\b",
    r"\bvalues\b",
]

DELIVERY_PATTERNS = [
    r"Delivery Address\s*[:\-]?\s*(.+)",
    r"Place of Delivery\s*[:\-]?\s*(.+)",
]

ADDRESS_RE = re.compile(
    r"(Delivery Address|Place of Delivery)\s*[:\-]?\s*(.+)",
    re.IGNORECASE,
)

PIN_RE = re.compile(r"\b\d{6}\b")


def _looks_like_junk(text: str) -> bool:
    low = text.lower().strip()

    if len(low) < 4:
        return True

    for pat in JUNK_PATTERNS:
        if re.search(pat, low):
            return True

    # all caps short strings → headers
    if text.isupper() and len(text.split()) <= 3:
        return True

    return False


# =============================
# LLaMA Config
# =============================

LLAMA_ENDPOINT = "http://127.0.0.1:11434/api/generate"
LLAMA_MODEL = "llama3.1"


# =============================
# Helpers
# =============================

def _extract_consignee_block(pages: List[str]) -> Optional[str]:
    capture = False
    buffer: List[str] = []

    for page in pages:
        for raw in page.splitlines():
            line = clean_line(raw)
            if not line:
                continue

            low = line.lower()

            if not capture and any(a.lower() in low for a in CONSIGNEE_ANCHORS):
                capture = True
                continue

            if capture and any(s.lower() in low for s in STOP_ANCHORS):
                return " ".join(buffer)

            if capture:
                buffer.append(line)

        if buffer:
            return " ".join(buffer)

    return None


def _llama_extract_location(text: str) -> Optional[str]:
    prompt = f"""
You are extracting delivery location from Indian government tender documents.

From the text below, extract ONLY the city / district / town name.
Do NOT return:
- person names
- roles
- room numbers
- block / floor
- generic words

If no valid location exists, return null.

Respond ONLY as JSON:
{{ "location": "<value or null>" }}

Text:
{text}
"""

    try:
        resp = requests.post(
            LLAMA_ENDPOINT,
            json={
                "model": LLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
            },
            timeout=15,
        )
        resp.raise_for_status()

        raw = resp.json().get("response", "").strip()
        data = json.loads(raw)

        loc = data.get("location")
        if isinstance(loc, str) and not _looks_like_junk(loc):
            return loc.strip()

    except Exception:
        return None

    return None


# =============================
# Public API
# =============================

def extract_delivery_location(pages: List[str]) -> Optional[Dict[str, str]]:
    """
    Returns:
      {
        "location": "Hyderabad",
        "source": "llama" | "consignee_table"
      }
    """

    block = _extract_consignee_block(pages)
    if not block:
        return None

    # -------------------------
    # 1️⃣ PRIMARY: LLaMA
    # -------------------------
    llama_loc = _llama_extract_location(block)
    if llama_loc:
        return {
            "location": llama_loc,
            "source": "llama",
        }

    # -------------------------
    # 2️⃣ PIN-based fallback
    # -------------------------
    pin = PIN_RE.search(block)
    if pin:
        tail = block[pin.end():]
        parts = tail.split(",")
        for part in parts:
            part = part.strip()
            if not _looks_like_junk(part):
                return {
                    "location": part,
                    "source": "consignee_table",
                }

    return {
        "location": "India",
        "source": "default",
    }
