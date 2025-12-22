from typing import List, Dict
from text_cleaning import clean_line, strip_leading_junk
import re


DOCUMENTS_ANCHORS = [
    "Document required from seller",
]

STOP_ANCHORS = [
    "Do you want to show documents uploaded",
    "Do you want to show document",
    "Bid to RA",
    "Type of Bid",
    "Bid Number",
    "बोली",
]

DISCLAIMER_MARKERS = [
    "*In case any bidder",
    "In case any bidder",
    "the supporting documents to prove",
]

HEADER_CLEAN_PATTERNS = [
    r"^Document required from seller\s*",
    r"^Document required from seller/\s*",
]

DOC_HEADER_RE = re.compile(
    r"(Documents Required|Document Required|Documents to be submitted)",
    re.IGNORECASE,
)

# Bullet / numbering styles
DOC_ITEM_RE = re.compile(
    r"^\s*(?:\d+[\).\]]|\-|\•|\*)\s*(.+)"
)

DOC_RE = re.compile(r"Document[s]?\s*Required", re.IGNORECASE)


def extract_documents_required(pages_text: List[str]) -> List[str]:
    capture = False
    buffer_lines: List[str] = []

    for page_text in pages_text[:2]:
        lines = [l.strip() for l in page_text.splitlines() if l.strip()]

        for raw_line in lines:
            line = clean_line(raw_line)

            # start capture
            if not capture and any(a in line for a in DOCUMENTS_ANCHORS):
                capture = True
                if ":" in line:
                    after = line.split(":", 1)[1].strip()
                    if after:
                        buffer_lines.append(after)
                continue

            # stop capture
            if capture and any(stop in line for stop in STOP_ANCHORS):
                capture = False
                break

            if capture:
                buffer_lines.append(line)

        if not capture and buffer_lines:
            break

    if not buffer_lines:
        return []

    raw = " ".join(buffer_lines)

    # truncate at disclaimer
    for marker in DISCLAIMER_MARKERS:
        if marker in raw:
            raw = raw.split(marker, 1)[0]
            break

    # split documents
    parts = []

    for p in re.split(r",\s*", raw):
        cleaned = strip_leading_junk(p.strip())
        if cleaned:
            parts.append(cleaned)


    # 🔧 clean header leakage from first item only
    if parts:
        first = parts[0]
        for pat in HEADER_CLEAN_PATTERNS:
            first = re.sub(pat, "", first, flags=re.IGNORECASE)
        parts[0] = first.strip()


    return parts
