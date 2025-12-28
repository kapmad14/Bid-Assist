import requests, json, re
from PyPDF2 import PdfReader

def extract_text_from_pdf(pdf_path, max_pages=2):
    reader = PdfReader(pdf_path)
    pages = min(max_pages, len(reader.pages))
    return "\n".join(reader.pages[i].extract_text() or "" for i in range(pages))

def clean_category(raw_text):
    if not raw_text:
        return None

    cleaned = raw_text.strip()

    patterns = [
        r'^The value of ["\']?Item Category["\']? (?:label )?is:\s*',
        r'^The value is:\s*',
        r'^Item Category[:/\s]*',
        r'GeMARPTS\s*$',
        r'^["\']|["\']$'
    ]

    for p in patterns:
        cleaned = re.sub(p, '', cleaned, flags=re.I)

    cleaned = ' '.join(cleaned.split())
    return cleaned.strip()

def extract_item_category(pdf_path):
    text = extract_text_from_pdf(pdf_path)

    if not text:
        return None

    schema = {
        "type": "object",
        "properties": {
            "category": {"type": "string"}
        },
        "required": ["category"]
    }

    prompt = f"""
Extract the exact value written next to the label "Item Category" in this tender document.

Document:
{text}

Return only the category value.
"""

    try:
        r = requests.post(
            "http://127.0.0.1:11434/api/chat",
            json={
                "model": "llama3.1:latest",
                "messages": [
                    {"role": "system", "content": "Extract only the field value."},
                    {"role": "user", "content": prompt}
                ],
                "format": schema,
                "stream": False,
                "options": {"temperature": 0}
            },
            timeout=40
        )

        raw = r.json()["message"]["content"]
        parsed = json.loads(raw)
        return clean_category(parsed.get("category"))

    except Exception:
        return None
