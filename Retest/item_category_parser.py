import re, pdfplumber

def extract_item_category(pdf_path):
    with pdfplumber.open(pdf_path) as pdf:
        text = ""
        for p in pdf.pages[:3]:
            text += (p.extract_text() or "") + "\n"

    patterns = [
        r"वस्तु\s*श्रेणी\s*/\s*Item\s*Category\s*\n(.+)",
        r"Item\s*Category\s*\n(.+)",
        r"Primary\s+product\s+category\s*\n(.+)"
    ]

    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            return m.group(1).strip()

    return None
