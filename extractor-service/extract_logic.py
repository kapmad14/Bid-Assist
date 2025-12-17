import PyPDF2
import re
import os
from urllib.parse import urlparse

def extract_urls_from_pdf(pdf_path: str) -> list:
    """Extract all URLs inside a PDF file"""
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

            # Method 2 — scan text for URLs
            for page in reader.pages:
                try:
                    text = page.extract_text()
                    if text:
                        found = re.findall(r"https?://[^\s]+", text)
                        urls.extend(found)
                except:
                    pass

        return list(set(urls))

    except:
        return []


def extract_tender_document_urls(tender_id: int, supabase):
    """Main extraction workflow — NO DB writes"""
    logs = [f"Starting extraction for tender {tender_id}"]

    # 1. Fetch tender row
    result = supabase.table("tenders").select("*").eq("id", tender_id).execute()
    if not result.data:
        return {"success": False, "error": "Tender not found", "logs": logs}

    tender = result.data[0]
    pdf_storage_path = tender.get("pdf_storage_path")

    if not pdf_storage_path:
        return {"success": False, "error": "PDF not found in tender", "logs": logs}

    # 2. Download PDF
    logs.append("Downloading PDF...")
    pdf_path = f"/tmp/tender_{tender_id}.pdf"

    try:
        file_bytes = supabase.storage.from_("gem-pdfs").download(pdf_storage_path)
        with open(pdf_path, "wb") as f:
            f.write(file_bytes)
    except Exception as e:
        return {"success": False, "error": f"PDF download failed: {str(e)}", "logs": logs}

    # 3. Extract URLs
    logs.append("Extracting URLs from PDF...")
    urls = extract_urls_from_pdf(pdf_path)
    logs.append(f"Found {len(urls)} links")

    # Remove temp file
    if os.path.exists(pdf_path):
        os.remove(pdf_path)

    # 4. Format extracted links
    docs = []
    for idx, url in enumerate(urls[:10], 1):
        filename = os.path.basename(urlparse(url).path) or f"document_{idx}.pdf"
        docs.append({
            "order": idx,
            "filename": filename,
            "url": url
        })
        logs.append(f"✓ {filename}")

    logs.append("Extraction complete")

    return {"success": True, "documents": docs, "logs": logs}
