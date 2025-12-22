import os
from datetime import datetime

from pdf_utils import load_pdf_pages_text
from extract_documents_required import extract_documents_required
from tender_schema_v1 import TenderSchemaV1


PDF_DIR = "./tender-pdfs"


def test_documents_required_on_pdfs():
    for fname in os.listdir(PDF_DIR):
        if not fname.lower().endswith(".pdf"):
            continue

        path = os.path.join(PDF_DIR, fname)
        pages = load_pdf_pages_text(path)

        docs = extract_documents_required(pages)

        data = {
            "bid_number": "GEM/2025/B/9999999",
            "bid_end_datetime": datetime.utcnow(),
            "item_category": "DUMMY",
            "item_category_source": "pdf_header",
            "total_quantity": 1,
            "documents_required": docs,
            "documents_required_source": "pdf_header",
        }

        TenderSchemaV1.model_validate(data)

        print(f"✅ {fname}: {docs}")


if __name__ == "__main__":
    test_documents_required_on_pdfs()
