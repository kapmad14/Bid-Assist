# extract_document_urls.py  (EPHEMERAL VERSION)

import PyPDF2
import re
import os
import sys
import json
import argparse
from urllib.parse import urlparse
from dotenv import load_dotenv
from supabase import create_client, Client

import warnings
warnings.filterwarnings("ignore")


# Load .env only if present — no hardcoded local path
load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print(json.dumps({"success": False, "error": "Missing Supabase credentials"}))
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def extract_urls_from_pdf(pdf_path: str) -> list:
    """Extract all URLs from a PDF file"""
    urls = []

    try:
        with open(pdf_path, "rb") as file:
            reader = PyPDF2.PdfReader(file)

            # Method 1 — hyperlink annotations
            for page in reader.pages:
                try:
                    if "/Annots" in page:
                        for annot in page["/Annots"]:
                            obj = annot.get_object()
                            if "/A" in obj and "/URI" in obj["/A"]:
                                urls.append(obj["/A"]["/URI"])
                except:
                    pass

            # Method 2 — regex text extraction
            for page in reader.pages:
                try:
                    text = page.extract_text()
                    if text:
                        found = re.findall(
                            r"http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+",
                            text,
                        )
                        urls.extend(found)
                except:
                    pass

        return list(set(urls))
    except Exception:
        return []


def extract_tender_document_urls(tender_id: int) -> dict:
    """Extract document URLs from tender PDF — NO DB WRITES"""
    logs = [f"Starting extraction for tender {tender_id}"]

    # 1) Fetch tender info (read-only)
    result = supabase.table("tenders").select("*").eq("id", tender_id).execute()

    if not result.data:
        return {"success": False, "error": "Tender not found", "logs": logs}

    tender = result.data[0]

    if not tender.get("pdf_storage_path"):
        return {"success": False, "error": "PDF not found in tender", "logs": logs}

    # 2) Download PDF to /tmp (isolated, self-cleaning)
    logs.append("Downloading PDF...")
    pdf_path = f"/tmp/tender_{tender_id}.pdf"

    try:
        file_bytes = supabase.storage.from_("gem-pdfs").download(tender["pdf_storage_path"])
        with open(pdf_path, "wb") as f:
            f.write(file_bytes)
    except Exception as e:
        return {"success": False, "error": f"PDF download failed: {str(e)}", "logs": logs}

    # 3) Extract links
    logs.append("Extracting URLs from PDF...")
    urls = extract_urls_from_pdf(pdf_path)
    logs.append(f"Found {len(urls)} link(s) inside PDF")

    if os.path.exists(pdf_path):
        os.remove(pdf_path)

    if len(urls) == 0:
        logs.append("No documents detected")
        return {"success": True, "documents": [], "logs": logs}

    # 4) Format response (top 10 only)
    docs = []
    for idx, url in enumerate(urls[:10], 1):
        name = os.path.basename(urlparse(url).path) or f"document_{idx}.pdf"
        docs.append({"order": idx, "filename": name, "url": url})
        logs.append(f"✓ {name}")

    logs.append("Extraction complete — ephemeral return only")

    return {"success": True, "documents": docs, "logs": logs}


# ---------- ENTRYPOINT ----------
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--tender-id", required=True)
    args = parser.parse_args()

    try:
        tender_id = int(args.tender_id)
    except:
        print(json.dumps({"success": False, "error": "Invalid tender ID"}))
        sys.exit(1)

    output = extract_tender_document_urls(tender_id)
    print(json.dumps(output))
