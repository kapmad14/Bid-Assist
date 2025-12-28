import pdfplumber
import re

def extract_blocks(pdf_path):
    blocks = []

    with pdfplumber.open(pdf_path) as pdf:
        for page_no, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            raw_blocks = re.split(r"\n{2,}", text)

            for b in raw_blocks:
                b = re.sub(r"\s+", " ", b).strip()
                if len(b) > 30:
                    blocks.append({
                        "page": page_no,
                        "text": b
                    })

    return blocks
