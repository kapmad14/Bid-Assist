# pdf_url_extractor.py
"""
Pure helper for extracting URLs from a PDF.

- NO database access
- NO stdout / logging
- NO Supabase
- Safe to use in batch and user flows
"""

import re
import os
from typing import List, Dict, Optional
from urllib.parse import urlparse

from pypdf import PdfReader


URL_REGEX = re.compile(
    r"http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|"
    r"(?:%[0-9a-fA-F][0-9a-fA-F]))+"
)


def _filename_from_url(url: str) -> Optional[str]:
    try:
        name = os.path.basename(urlparse(url).path)
        return name if name else None
    except Exception:
        return None


def extract_urls_from_pdf(pdf_path: str) -> List[Dict]:
    """
    Extract document URLs from a PDF file.

    Returns a list of dicts:
    [
      {
        "url": "...",
        "filename": "...",
        "source": "annotation" | "regex",
        "order": 1
      }
    ]

    Best-effort:
    - Never raises
    - Returns [] if nothing found
    """

    results: List[Dict] = []
    seen_urls = set()
    order_counter = 1

    try:
        reader = PdfReader(pdf_path)
    except Exception:
        return []

    # ---------- Method 1: PDF link annotations (best signal) ----------
    for page in reader.pages:
        try:
            if "/Annots" not in page:
                continue

            for annot in page["/Annots"]:
                try:
                    obj = annot.get_object()
                    if "/A" in obj and "/URI" in obj["/A"]:
                        url = obj["/A"]["/URI"]
                        if not isinstance(url, str):
                            continue
                        if url in seen_urls:
                            continue

                        seen_urls.add(url)
                        results.append({
                            "url": url,
                            "filename": _filename_from_url(url),
                            "source": "annotation",
                            "order": order_counter
                        })
                        order_counter += 1
                except Exception:
                    continue
        except Exception:
            continue

    # ---------- Method 2: Regex search in extracted text ----------
    for page in reader.pages:
        try:
            text = page.extract_text()
            if not text:
                continue

            for url in URL_REGEX.findall(text):
                if url in seen_urls:
                    continue

                seen_urls.add(url)
                results.append({
                    "url": url,
                    "filename": _filename_from_url(url),
                    "source": "regex",
                    "order": order_counter
                })
                order_counter += 1
        except Exception:
            continue

    return results
