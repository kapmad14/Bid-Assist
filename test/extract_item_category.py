from typing import List, Optional, Tuple, Dict
from text_cleaning import clean_line, strip_leading_junk

import re

# -------------------------
# Precedence (LOCKED)
# -------------------------
PRECEDENCE = [
    "pdf_header",
    "boq_title",
    "boq_item",
    "spec_heading",
]

# -------------------------
# Anchors
# -------------------------
ITEM_CATEGORY_ANCHORS = [
    "Item Category",
]

BOQ_TITLE_ANCHORS = [
    "BOQ",
    "Schedule of Requirement",
]

SPEC_HEADING_HINTS = [
    "Specification",
    "Technical Specification",
]

ITEM_CATEGORY_STOP_ANCHORS = [
    # qualification / exemption
    "MSE Exemption",
    "Startup Exemption",
    "Years of Past Experience",
    "Minimum Years of Experience",

    # financial criteria
    "Minimum Average Annual Turnover",
    "Bidder Turnover",
    "OEM Annual Turnover",
    "Average Annual Turnover",
    "OEM Average Turnover",

    # bid mechanics
    "Bid to RA",
    "RA Qualification",
    "Type of Bid",
    "Evaluation Method",
    "Inspection Required",

    # legal
    "Arbitration Clause",
    "Mediation Clause",

    # document section
    "Document required from seller",

    # misc
    "Total value wise evaluation",
    "Total Quantity",
    "Bid Number",
    "Bid End Date",

    #Others
    "GeMARPTS",
    "Searched Strings used",
    "Searched Result generated",
    "Relevant Categories selected",
]

CATEGORY_HINTS = [
    r"Item Category\s*[:\-]?\s*(.+)",
    r"Category\s*[:\-]?\s*(.+)",
]

# -------------------------
# Helpers
# -------------------------

def _strip_boq_quantity(text: str) -> str:
    """
    Strip quantity/unit patterns typically present in BOQ titles/items.
    Example:
      'ELISA Test Kits (V2) ( 4800 Test )' -> 'ELISA Test Kits (V2)'
    """
    # remove trailing quantity parentheses
    text = re.sub(r"\(\s*\d+[^)]*\)\s*$", "", text).strip()
    return text


# -------------------------
# Candidate Extractors
# -------------------------

def _extract_from_pdf_header(pages: List[str]) -> Optional[str]:
    """
    Extract Item Category from Bid Details block (Page 1).
    """
    page_text = pages[0] if pages else ""
    lines = [l.strip() for l in page_text.splitlines() if l.strip()]

    capture = False
    buffer = []

    for raw in lines:
        line = clean_line(raw)

        if not capture and any(a in line for a in ITEM_CATEGORY_ANCHORS):
            capture = True

            # same-line value
            if ":" in line:
                after = line.split(":", 1)[1].strip()
                if after:
                    buffer.append(after)
            continue

        if capture:
            if any(stop in line for stop in ITEM_CATEGORY_STOP_ANCHORS):
                break
            buffer.append(line)


    if not buffer:
        return None

    raw = " ".join(buffer)
    cleaned = strip_leading_junk(clean_line(raw))

    for stop in ITEM_CATEGORY_STOP_ANCHORS:
        if stop in cleaned:
            cleaned = cleaned.split(stop, 1)[0].strip()
            break

    return cleaned or None



def _extract_from_boq_title(pages: List[str]) -> Optional[str]:
    """
    Extract Item Category from BOQ title / schedule heading.
    """
    for page in pages:
        for raw in page.splitlines():
            line = clean_line(raw)

            if any(a in line for a in BOQ_TITLE_ANCHORS):
                # next meaningful line usually carries title
                continue

            # heuristic: title-like line with product wording
            if re.search(r"\b(V\d+)\b", line):
                cleaned = _strip_boq_quantity(strip_leading_junk(line))
                if cleaned:
                    return cleaned

    return None


def _extract_from_boq_item(pages: List[str]) -> Optional[str]:
    """
    Extract from first BOQ line item description.
    """
    for page in pages:
        for raw in page.splitlines():
            line = clean_line(raw)

            # typical BOQ item line: starts with number or bullet
            if re.match(r"^\d+\s+", line):
                cleaned = _strip_boq_quantity(strip_leading_junk(line))
                if cleaned:
                    return cleaned

    return None


def _extract_from_spec_heading(pages: List[str]) -> Optional[str]:
    """
    Extract from product heading above specifications.
    """
    for page in pages:
        lines = [ clean_line(l) for l in page.splitlines() if l.strip() ]

        for idx, line in enumerate(lines):
            if any(h in line for h in SPEC_HEADING_HINTS):
                # look slightly above the spec section
                for back in range(max(0, idx-3), idx):
                    candidate = strip_leading_junk(lines[back])
                    if candidate:
                        return candidate
    return None


# -------------------------
# Public API
# -------------------------

def extract_item_category(pages_text: List[str]) -> Tuple[Optional[str], Optional[str]]:
    """
    Returns:
      (item_category, item_category_source)
    """

    candidates = {
        "pdf_header": _extract_from_pdf_header(pages_text),
        "boq_title": _extract_from_boq_title(pages_text),
        "boq_item": _extract_from_boq_item(pages_text),
        "spec_heading": _extract_from_spec_heading(pages_text),
    }

    for source in PRECEDENCE:
        value = candidates.get(source)
        if value:
            return value, source

    return None, None
