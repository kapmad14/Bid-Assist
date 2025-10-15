# streamlit_prototype.py
import streamlit as st
import pandas as pd
import re
from difflib import SequenceMatcher
import PyPDF2

st.set_page_config(page_title="GeM Triage Prototype", layout="centered")
st.title("GeM Triage — Prototype")
st.markdown("Upload a GeM tender PDF (or use the sample file) and see a 1-page 'Can we quote?' card.")

uploaded = st.file_uploader("Upload tender PDF", type=["pdf"])
use_sample = st.checkbox("Use sample tender PDF (use sample_tender.pdf in project folder)")

if uploaded is None and not use_sample:
    st.info("Upload a tender PDF or select 'Use sample tender PDF' to test the prototype.")

def extract_text_from_pdf_filelike(f):
    reader = PyPDF2.PdfReader(f)
    text = []
    for p in reader.pages:
        text.append(p.extract_text() or "")
    return "\n".join(text)

def fuzzy_score(a,b):
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()

if uploaded or use_sample:
    if uploaded:
        raw = extract_text_from_pdf_filelike(uploaded)
    else:
        try:
            with open("sample_tender.pdf", "rb") as f:
                raw = extract_text_from_pdf_filelike(f)
        except FileNotFoundError:
            st.error("sample_tender.pdf not found in project folder. Upload a PDF or add sample_tender.pdf.")
            st.stop()

    # Basic field extraction
    def extract_field(patterns, text):
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE | re.DOTALL)
            if m:
                try:
                    return m.group(1).strip()
                except IndexError:
                    return m.group(0).strip()
        return None

    bid_number = extract_field([r"Bid Number.*?:\s*([A-Z0-9/.\-]+)", r"Bid No.*?:\s*([A-Z0-9/.\-]+)"], raw) or "Unknown"
    bid_end = extract_field([r"Bid End Date/Time.*?([0-9]{2}-[0-9]{2}-[0-9]{4}\s*[0-9:]{5,8})",
                             r"Bid End.*?([0-9]{2}-[0-9]{2}-[0-9]{4}\s*[0-9:]{5,8})"], raw) or "Unknown"
    item_category = extract_field([r"Item Category.*?([A-Za-z0-9 \(\)\/\-]+)", r"Item.*Category.*?:\s*([A-Za-z0-9 \(\)\/\-]+)"], raw) or ""
    # try to capture a product description block
    prod_desc = extract_field([r"PRODUCT INFORMATION(.*?)SPECIFICATION", r"Product Description(.*?)(?:KIT CONTENTS|PACKAGING|SPECIFICATION)"], raw) or ""
    if not prod_desc:
        # fallback: use first 800 chars of the document to give some context
        prod_desc = raw[:800]

    tender_text = " ".join([item_category, prod_desc])

    st.subheader("Quick Tender Card — parsed fields")
    st.write({
        "Bid number": bid_number,
        "Bid end": bid_end,
        "Item category (parsed)": item_category
    })

    st.markdown("### Top SKU matches (dummy catalogue)")
    try:
        sku_df = pd.read_csv("dummy_skus.csv")
    except FileNotFoundError:
        st.error("dummy_skus.csv not found in project folder. Create it and retry.")
        st.stop()

    matches = []
    for _, r in sku_df.iterrows():
        score = fuzzy_score(tender_text, r["title"])
        exact = False
        cat_words = re.findall(r"[A-Za-z0-9]{3,}", item_category)
        if cat_words and any(w.lower() in r["title"].lower() for w in cat_words[:3]):
            exact = True
        matches.append({
            "sku_id": r["sku_id"],
            "title": r["title"],
            "exact_match": exact,
            "fuzzy_score": round(score, 3),
            "price_min": r.get("price_band_min", ""),
            "price_max": r.get("price_band_max", "")
        })
    matches_df = pd.DataFrame(matches).sort_values(["exact_match", "fuzzy_score"], ascending=[False, False]).reset_index(drop=True)
    st.dataframe(matches_df)

    if not matches_df.empty:
        top = matches_df.iloc[0]
        if top["exact_match"] or top["fuzzy_score"] >= 0.65:
            decision = "Likely YES — matching SKU(s) found. Review certifications and price."
        else:
            decision = "Probably NO — no close SKU match found; investigate further."
        st.markdown("## Can we quote?")
        st.markdown(f"**Decision:** {decision}")
        st.markdown(f"**Top match score:** {top['fuzzy_score']} — SKU: {top['sku_id']} - {top['title']}")
    else:
        st.warning("No SKUs available to match. Add rows to dummy_skus.csv and retry.")
