import re
from io import BytesIO
from pypdf import PdfReader
from typing import Optional

MAX_PAGES = 2

HINDI_STOPS = [
    r"उ\s*ह\s*ं",
    r"उ\*ह\s*ं",
    r"वष\*",
]

HINDI_STOP_REGEX = re.compile("|".join(HINDI_STOPS), re.I)

ITEM_CATEGORY_REGEX = re.compile(
    r"Item\s*Category[^A-Za-z0-9]+(.{5,500})",
    re.I | re.S
)

def sanitize_category(raw: str) -> str:
    raw = re.split(r"GeMARPTS", raw, flags=re.I)[0]
    raw = re.sub(r"[\x00-\x1F\x7F]", " ", raw)
    raw = re.split(r"[^\x00-\x7F]{3,}", raw)[0]
    raw = re.sub(r"\s+", " ", raw).strip(" :-\t\r\n")
    return raw.upper()


def get_item_category(pdf_path: str) -> Optional[str]:
    try:
        reader = PdfReader(pdf_path)
    except Exception:
        return None

    pages = min(len(reader.pages), MAX_PAGES)

    text = ""
    for i in range(pages):
        try:
            text += reader.pages[i].extract_text() or ""
        except Exception:
            pass

    m = ITEM_CATEGORY_REGEX.search(text)
    if not m:
        return None

    raw = re.sub(r"\s+", " ", m.group(1))

    full_text = text.replace("\n", " ")
    if raw.strip().endswith((",", "/", "-", " and", " &")):
        pos = full_text.lower().find(raw.lower())
        if pos != -1:
            raw = full_text[pos:pos + 900]

    raw = re.split(
        r"(Minimum|OEM|Years of|MSE|Startup|Document|required|Bid Number|Contract Period|Evaluation Method|Consignee|Buyer|Past Experience|Estimated Bid)",
        raw,
        flags=re.I
    )[0]

    raw = HINDI_STOP_REGEX.split(raw)[0]

    return sanitize_category(raw)