#!/usr/bin/env python3
"""
parse_existing_pdfs.py

Find tenders with pdf_path set but no entries in boq_lines and parse PDFs,
insert BOQ lines into `boq_lines` and compute SKU matches into `matches`.
"""

import os, re, sqlite3, time, hashlib
from pathlib import Path
from datetime import datetime
from urllib.parse import urljoin

import pdfplumber
import pandas as pd
try:
    from rapidfuzz.fuzz import token_sort_ratio
    HAS_RAPIDFUZZ = True
except Exception:
    HAS_RAPIDFUZZ = False

DB = "data/tenders.db"
SKU_CSV = "dummy_skus.csv"

def sha256_bytes(b: bytes) -> str:
    import hashlib
    m = hashlib.sha256()
    m.update(b)
    return m.hexdigest()

def fuzzy_score(a,b):
    if not a or not b:
        return 0.0
    if HAS_RAPIDFUZZ:
        return token_sort_ratio(a,b)/100.0
    else:
        from difflib import SequenceMatcher
        return SequenceMatcher(None, a.lower(), b.lower()).ratio()

def load_skus(csv_path):
    if not os.path.exists(csv_path):
        print("SKU CSV not found:", csv_path)
        return pd.DataFrame(columns=["sku_id","title"])
    df = pd.read_csv(csv_path, dtype=str).fillna("")
    if "sku_id" not in df.columns:
        # create a synthetic sku_id if missing
        df["sku_id"] = df.index.astype(str)
    if "title" not in df.columns:
        # fallback to a 'title' column if missing
        df["title"] = df.iloc[:,0].astype(str)
    return df

def extract_boq_rows_from_pdf(pdf_path):
    rows = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            idx = 1
            for page in pdf.pages:
                tables = page.extract_tables()
                # prefer table extraction first
                if tables:
                    for t in tables:
                        if not t: continue
                        # attempt to treat first row as header if many cols
                        header = t[0] if len(t) > 1 else None
                        for r in (t[1:] if header else t):
                            # form description by joining text cells
                            desc = " | ".join([str(x).strip() for x in (r or []) if x and str(x).strip()])
                            qty = None
                            # try to find a numeric token in row
                            for cell in (r or []):
                                if not cell: continue
                                m = re.search(r"([0-9,]{1,10})\b", str(cell))
                                if m:
                                    try:
                                        qty = int(m.group(1).replace(",",""))
                                        break
                                    except:
                                        qty = None
                            if desc:
                                rows.append({"line_no": idx, "description": desc[:600], "quantity": qty})
                                idx += 1
                # fallback to text heuristics
                text = page.extract_text() or ""
                for ln in text.splitlines():
                    ln = ln.strip()
                    if len(ln) < 8: continue
                    if re.search(r"\b[0-9,]{2,}\b", ln):
                        m = re.search(r"([0-9,]{1,10})\s*(?:Nos?|Pieces|Pack|Pcs|Qty|Quantity|Sets?)", ln, re.IGNORECASE)
                        if not m:
                            m = re.search(r"\b([0-9,]{2,10})\b", ln)
                        qty = int(m.group(1).replace(",","")) if m else None
                        rows.append({"line_no": idx, "description": ln[:600], "quantity": qty})
                        idx += 1
    except Exception as e:
        print("Error parsing PDF:", pdf_path, e)
    return rows

def main(limit=200):
    sku_df = load_skus(SKU_CSV)
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    # find gem_bid_id for which pdf_path exists but no boq_lines recorded
    cur.execute("""
        SELECT t.gem_bid_id, t.pdf_path FROM tenders t
        LEFT JOIN boq_lines b ON t.gem_bid_id = b.gem_bid_id
        WHERE t.pdf_path IS NOT NULL AND t.pdf_path<>'' AND b.id IS NULL
        LIMIT ?
    """, (limit,))
    rows = cur.fetchall()
    print("Candidates to parse:", len(rows))
    count_inserted = 0

    for gem_id, pdf_path in rows:
        print("Parsing:", gem_id, pdf_path)
        if not pdf_path or not os.path.exists(pdf_path):
            print("  pdf missing on disk, skipping")
            continue
        lines = extract_boq_rows_from_pdf(pdf_path)
        if not lines:
            print("  no lines extracted")
            # still insert a marker row? skipping for now
            continue

        for ln in lines:
            cur.execute("""
                INSERT INTO boq_lines (gem_bid_id, line_no, description, quantity, pdf_path, parsed_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (gem_id, ln["line_no"], ln["description"], ln["quantity"], pdf_path, datetime.utcnow().isoformat()))
            ln_id = cur.lastrowid
            # compute top matches
            top = 3
            text = ln["description"]
            # iterate SKUs
            for _, sku in sku_df.iterrows():
                sku_id = sku.get("sku_id","")
                sku_title = sku.get("title","")
                score = fuzzy_score(text, sku_title) if False else fuzzy_score(text, sku_title)
                # insert only if score > threshold (e.g. 0.35) OR keep top N later
                if score >= 0.35:
                    cur.execute("""
                        INSERT INTO matches (boq_line_id, sku_id, sku_title, score, exact_match, matched_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (ln_id, sku_id, sku_title, round(score,3), 0, datetime.utcnow().isoformat()))
            count_inserted += 1
            conn.commit()
        print(f"  done: inserted {len(lines)} lines for {gem_id}")
    conn.close()
    print("Finished. lines inserted:", count_inserted)

if __name__ == "__main__":
    main(limit=500)
