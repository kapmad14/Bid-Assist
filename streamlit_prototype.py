# streamlit_prototype.py
import streamlit as st
import pandas as pd
import re
import io
import pdfplumber
from difflib import SequenceMatcher

# try to import rapidfuzz for better fuzzy matching
try:
    from rapidfuzz.fuzz import token_sort_ratio
    HAS_RAPIDFUZZ = True
except Exception:
    HAS_RAPIDFUZZ = False

st.set_page_config(page_title="GeM Triage — BOQ prototype", layout="wide")
st.title("GeM Triage — BOQ extraction & per-line matching")

st.markdown(
    "Upload a GeM tender PDF (or use the sample file). "
    "This version extracts BOQ/tables and attempts to match each BOQ line to SKUs."
)

uploaded = st.file_uploader("Upload a GeM tender PDF", type=["pdf"])
use_sample = st.checkbox("Use sample_tender.pdf from repo (if present)")

if uploaded is None and not use_sample:
    st.info("Upload a tender PDF or check 'Use sample_tender.pdf' to test.")
    st.stop()

# helper: fuzzy scoring
def fuzzy_score(a: str, b: str) -> float:
    if not a: return 0.0
    if HAS_RAPIDFUZZ:
        # token_sort_ratio returns 0-100
        return token_sort_ratio(a, b) / 100.0
    else:
        return SequenceMatcher(None, a.lower(), b.lower()).ratio()

# helper: read pdf bytes into text + tables using pdfplumber
def extract_boq_and_text(file_stream) -> dict:
    """
    Returns {
      "tables": [ DataFrame, ... ],
      "all_text": "..."
    }
    """
    tables = []
    all_text = []
    with pdfplumber.open(file_stream) as pdf:
        for p in pdf.pages:
            text = p.extract_text() or ""
            all_text.append(text)
            # extract tables on the page
            page_tables = p.extract_tables()  # list of lists
            for t in page_tables:
                # convert to DataFrame attempting to normalize header row
                try:
                    df = pd.DataFrame(t[1:], columns=t[0])
                except Exception:
                    df = pd.DataFrame(t)
                tables.append(df)
    return {"tables": tables, "all_text": "\n".join(all_text)}

# Try to load SKU catalogue
try:
    sku_df = pd.read_csv("dummy_skus.csv")
except FileNotFoundError:
    st.error("dummy_skus.csv not found in repo. Add your SKU CSV and retry.")
    st.stop()

# pick source PDF
if uploaded:
    pdf_bytes = uploaded.read()
else:
    try:
        with open("sample_tender.pdf", "rb") as f:
            pdf_bytes = f.read()
    except FileNotFoundError:
        st.error("sample_tender.pdf not found. Upload a PDF or add the sample file.")
        st.stop()

# extract
extracted = extract_boq_and_text(io.BytesIO(pdf_bytes))
tables = extracted["tables"]
all_text = extracted["all_text"]

st.sidebar.markdown("**Extraction summary**")
st.sidebar.write(f"Pages parsed: {len(all_text.splitlines()) and 'unknown (text extracted)'}")
st.sidebar.write(f"Tables found: {len(tables)}")
st.sidebar.write("Fuzzy engine: " + ("rapidfuzz" if HAS_RAPIDFUZZ else "difflib"))

# display extracted tables if any
if tables:
    st.subheader("Detected tables (BOQ candidates)")
    # show each table and let user pick which is the BOQ
    for i, df in enumerate(tables):
        st.markdown(f"**Table #{i+1}** (preview)")
        st.dataframe(df.head(10))
    # let user choose table index to use as BOQ
    table_index = st.number_input("Select table index to use as BOQ (1..n)", min_value=1, max_value=len(tables), value=1)
    boq_df = tables[table_index - 1].copy()
else:
    st.subheader("No tables detected — using text heuristics to extract BOQ-like lines")
    st.text("Fallback: scanning text for lines that look like 'description | qty | unit | rate'")
    # simple heuristic: split text into lines, pick lines containing numbers
    lines = [ln.strip() for ln in all_text.splitlines() if ln.strip()]
    candidate_lines = [ln for ln in lines if re.search(r"\b\d{1,5}\b", ln)]
    # show top candidates
    st.write("Candidate lines (first 40):")
    st.write(candidate_lines[:40])
    # create a simple BOQ df with description and quantity extracted via regex
    rows = []
    for ln in candidate_lines[:200]:
        # extract numeric quantity (first integer-looking token)
        m = re.search(r"([0-9,]{1,10})\s*(?:Nos?|Pieces|Pack|Pcs|Qty|Quantity|Sets?)", ln, re.IGNORECASE)
        if not m:
            m = re.search(r"\b([0-9,]{1,10})\b", ln)
        qty = int(m.group(1).replace(",", "")) if m else None
        rows.append({"description": ln[:200], "quantity": qty})
    boq_df = pd.DataFrame(rows)

# normalize BOQ dataframe columns: try to identify description & quantity columns
desc_col = None
qty_col = None
lower_cols = [str(c).lower() for c in boq_df.columns]
for i, c in enumerate(boq_df.columns):
    lc = str(c).lower()
    if any(k in lc for k in ["description", "item", "particular", "details", "name"]):
        desc_col = c
    if any(k in lc for k in ["qty", "quantity", "qnty", "nos", "no."]):
        qty_col = c

# fallback guesses
if desc_col is None:
    # try first text-like col
    for c in boq_df.columns:
        if boq_df[c].dtype == object:
            desc_col = c
            break
if qty_col is None:
    # try numeric columns
    for c in boq_df.columns:
        if pd.api.types.is_numeric_dtype(boq_df[c]):
            qty_col = c
            break
    # or fallback to None (some rows may hold qty in-line)
    
# create canonical BOQ rows with 'description' and 'quantity'
canonical_rows = []
for _, r in boq_df.iterrows():
    desc = str(r[desc_col]) if desc_col else str(r.iloc[0])
    q = None
    if qty_col:
        try:
            q = int(r[qty_col]) if not pd.isna(r[qty_col]) else None
        except Exception:
            q = None
    # try inline qty extraction if q is None
    if q is None:
        m = re.search(r"([0-9,]{1,10})\s*(?:Nos?|Pieces|Pack|Pcs|Qty|Quantity|Sets?)", desc, re.IGNORECASE)
        if not m:
            m = re.search(r"\b([0-9,]{1,10})\b", desc)
        if m:
            try:
                q = int(m.group(1).replace(",", ""))
            except:
                q = None
    canonical_rows.append({"description": desc, "quantity": q})

boq_clean = pd.DataFrame(canonical_rows)

st.subheader("Canonical BOQ lines (preview)")
st.dataframe(boq_clean.head(50))

# matching: for each BOQ line, compute best SKU matches
def match_line_to_skus(line_text, sku_df, top_k=5):
    scores = []
    for _, sku in sku_df.iterrows():
        title = str(sku["title"])
        # exact attribute check: if all significant words from SKU in line_text
        sig_words = re.findall(r"\b[A-Za-z0-9]{3,}\b", title)
        exact = False
        if sig_words and all(w.lower() in line_text.lower() for w in sig_words[:3]):
            exact = True
        score = fuzzy_score(line_text, title)
        scores.append({
            "sku_id": sku.get("sku_id", ""),
            "title": title,
            "exact": exact,
            "score": round(score, 3),
            "price_min": sku.get("price_band_min", ""),
            "price_max": sku.get("price_band_max", "")
        })
    # sort
    scores_sorted = sorted(scores, key=lambda x: (not x["exact"], -x["score"]))
    return scores_sorted[:top_k]

# apply matching and show results
st.subheader("Per-line matching results")
results = []
for idx, r in boq_clean.iterrows():
    desc = r["description"]
    qty = r["quantity"]
    matches = match_line_to_skus(desc, sku_df, top_k=5)
    top = matches[0] if matches else None
    decision = "Unknown"
    if top:
        if top["exact"] or top["score"] >= 0.7:
            decision = "Likely YES"
        elif top["score"] >= 0.45:
            decision = "Maybe (fuzzy)"
        else:
            decision = "No good match"
    results.append({
        "line_index": idx + 1,
        "description": desc,
        "quantity": qty,
        "top_sku": top["sku_id"] if top else "",
        "top_title": top["title"] if top else "",
        "top_score": top["score"] if top else 0.0,
        "decision": decision
    })

results_df = pd.DataFrame(results)
st.dataframe(results_df[["line_index","description","quantity","top_sku","top_score","decision"]])

# aggregate summary
st.markdown("### Aggregate suggestion")
if not results_df.empty:
    num_yes = results_df["decision"].str.contains("Likely YES").sum()
    num_maybe = results_df["decision"].str.contains("Maybe").sum()
    num_no = results_df["decision"].str.contains("No good match").sum()
    st.write(f"Lines likely match SKUs: {num_yes}  |  Maybe matches: {num_maybe}  |  No match: {num_no}")
    # simple rule: if >=1 Likely YES and majority not 'No good match', suggest YES
    if num_yes >= 1 and (num_no <= (len(results_df)/2)):
        st.success("Overall: CAN PROCEED TO QUOTE (preliminary). Review certs & pricing.")
    else:
        st.warning("Overall: INVESTIGATE — insufficient confident SKU matches.")
else:
    st.info("No BOQ lines found to evaluate.")
