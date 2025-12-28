import os, json, traceback
import pdfplumber

from extract_fields import extract_field
from pdf_blocks import extract_blocks
from embed_router import warmup_models
from boq_parser import parse_boq_from_lines
from item_category_llm import extract_item_category

PDF_DIR = "tender-pdfs"
OUT_FILE = "output.json"
LOG_FILE = "run.log"

def log(msg):
    with open(LOG_FILE, "a") as f:
        f.write(msg + "\n")
    print(msg, flush=True)

def main():
    warmup_models()
    results = []

    pdf_files = [f for f in sorted(os.listdir(PDF_DIR)) if f.lower().endswith(".pdf")][:20]

    for idx, file in enumerate(pdf_files, start=1):
        if not file.lower().endswith(".pdf"):
            continue

        log(f"[{idx}] Processing {file}")

        try:
            path = os.path.join(PDF_DIR, file)

            # ---------- ITEM CATEGORY ----------
            item_category = extract_item_category(path)
            log(f"   item category extracted: {item_category}")

            # ---------- BOQ EXTRACTION ----------
            with pdfplumber.open(path) as pdf:
                lines = []
                for p in pdf.pages:
                    lines += [l.strip() for l in (p.extract_text() or "").split("\n") if len(l.strip()) > 3]

            boq = parse_boq_from_lines(lines)
            log(f"   BOQ items found: {len(boq)}")

            data = {
                "file": file,
                "item_category": item_category,
                "boq": boq
            }

            results.append(data)

            # checkpoint save
            with open(OUT_FILE, "w", encoding="utf-8") as f:
                json.dump(results, f, indent=2, ensure_ascii=False)

            log(f"   ✔ saved {file}")

        except Exception as e:
            log(f"   ❌ ERROR in {file}: {e}")
            log(traceback.format_exc())

    log("DONE")

if __name__ == "__main__":
    main()
