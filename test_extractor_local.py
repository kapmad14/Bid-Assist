import os
import json
from extractor import parse_pdf

PDF_DIR = "tender-pdfs"
OUT_FILE = "extractor_test_output.json"

results = []

for fn in sorted(os.listdir(PDF_DIR)):
    if not fn.lower().endswith(".pdf"):
        continue

    full = os.path.join(PDF_DIR, fn)
    try:
        data = parse_pdf(full)
        data["file"] = fn
        results.append(data)
        print(f"[OK] {fn}")
    except Exception as e:
        print(f"[ERR] {fn}: {e}")

with open(OUT_FILE, "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print(f"\nSaved results to {OUT_FILE}")
