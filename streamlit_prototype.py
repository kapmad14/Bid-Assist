# streamlit_prototype.py
# === Combined: Streamlit app + Supabase invite token capture/validation ===

import streamlit as st
import pandas as pd
import re
import io
import pdfplumber
from difflib import SequenceMatcher
from streamlit.components.v1 import html
import requests
import urllib.parse
import time

# IMPORTANT: set page config BEFORE any other Streamlit UI calls
st.set_page_config(page_title="GeM Triage — BOQ prototype", layout="wide")

# Safe rerun helper — tries Streamlit's rerun, otherwise forces a full page reload
def safe_rerun():
    try:
        if hasattr(st, "experimental_rerun"):
            st.experimental_rerun()
            return
        if hasattr(st, "rerun"):
            try:
                st.rerun()
                return
            except Exception:
                pass
    except Exception:
        pass
    try:
        html("<script>window.top.location.reload();</script>", height=0)
    except Exception:
        pass

# try to import rapidfuzz for better fuzzy matching
try:
    from rapidfuzz.fuzz import token_sort_ratio
    HAS_RAPIDFUZZ = True
except Exception:
    HAS_RAPIDFUZZ = False

# ------------------ Supabase / invite token capture & validation helper ------------------
SUPABASE_URL = "https://mczecifjqmhbgjkxqsna.supabase.co"  # <- your Supabase URL
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jemVjaWZqcW1oYmdqa3hxc25hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5MTAyMzksImV4cCI6MjA3NzQ4NjIzOX0.SVAGJIKBUqjwgnWrWOv4RtvCbYCgKYfEbWZwBwQqJxA"  # <- your anon key

# Convert hash fragment (#access_token=...) into query params so Streamlit can read them
html("""
<script>
  try {
    if (window.location.hash && window.location.hash.length > 1) {
      const q = window.location.hash.replace('#','?');
      const newUrl = window.location.origin + window.location.pathname + q;
      try {
        if (window.top && window.top !== window.self) {
          window.top.location.replace(newUrl);
        } else {
          window.location.replace(newUrl);
        }
      } catch(parentsafe) {
        try { window.parent.location.replace(newUrl); } catch(e) { window.location.replace(newUrl); }
      }
    }
  } catch(e) { console.log("hash->query conversion failed", e); }
</script>
""", height=0)

# Read query params (works whether token arrived as ? or was converted from #)
params = st.query_params
_access_token = params.get("access_token", [None])[0] if isinstance(params.get("access_token", None), list) else params.get("access_token")
_refresh_token = params.get("refresh_token", [None])[0] if isinstance(params.get("refresh_token", None), list) else params.get("refresh_token")
_expires_at = params.get("expires_at", [None])[0] if isinstance(params.get("expires_at", None), list) else params.get("expires_at")
_token_type = params.get("token_type", [None])[0] if isinstance(params.get("token_type", None), list) else params.get("token_type")
_invite_link_type = params.get("type", [None])[0] if isinstance(params.get("type", None), list) else params.get("type")

# Visible debug toggle so you can inspect query params when needed
_show_raw = st.sidebar.checkbox("Show raw query params (debug)", value=False)
if _show_raw:
    st.sidebar.write("Raw query params:", params)

# ---- Token validation / storage ----
def validate_and_store_token(token, refresh_token=None, expires_at=None):
    try:
        headers = {
            "Authorization": f"Bearer {token}",
            "apikey": ANON_KEY
        }
        resp = requests.get(f"{SUPABASE_URL}/auth/v1/user",
                            headers=headers, timeout=10)
    except Exception as e:
        st.error(f"Token validation request failed: {e}")
        return False

    if resp.ok:
        user = resp.json()
        st.session_state['supabase_access_token'] = token
        if refresh_token:
            st.session_state['supabase_refresh_token'] = refresh_token
        if expires_at:
            st.session_state['supabase_expires_at'] = expires_at
        st.session_state['supabase_user'] = user
        st.session_state['supabase_token_type'] = _token_type
        st.session_state['invite_link_type'] = _invite_link_type
        return True
    else:
        st.error(f"Token validation failed: {resp.status_code} — {resp.text}")
        return False

# Robust token extractor used by manual loader
def extract_token_from_input(s: str) -> str:
    if not s or not s.strip():
        return ""
    s = s.strip()
    m = re.search(r"(?:access_token=)([^&\\s]+)", s)
    if m:
        token = m.group(1)
    else:
        token = s.split("&")[0]
    token = urllib.parse.unquote_plus(token)
    token = token.strip(' "\'')
    return token

# === DEBUG & MANUAL TOKEN LOADER ===
st.sidebar.markdown("**DEBUG**")
st.sidebar.write("query params:", st.query_params)
st.sidebar.write("session keys:", list(st.session_state.keys()))
st.sidebar.write("session (debug):", dict(st.session_state))

with st.expander("Manual token loader (paste URL or token)", expanded=True):
    raw_input = st.text_input("Paste invite URL or access_token here", value="")
    if st.button("Load token"):
        cleaned = extract_token_from_input(raw_input)
        if not cleaned:
            st.error("Couldn't find a token in input. Paste the full invite URL or token.")
        else:
            st.write("Using token (first 8 chars):", cleaned[:8] + "..." + cleaned[-8:])
            ok = validate_and_store_token(cleaned)
            if ok:
                st.success("Token validated & session stored. Check sidebar for Signed in user.")
                safe_rerun()
            else:
                st.error("Token validation failed. Try resending invite and paste a fresh token.")
# === end debug/manual loader ===

# If we have an access token in the URL and it's not yet in session, validate & store it
if 'supabase_access_token' not in st.session_state and _access_token:
    validate_and_store_token(_access_token, refresh_token=_refresh_token, expires_at=_expires_at)

# ---- Email/password sign-in (robust version) ----
def sign_in_with_email_password(email: str, password: str) -> bool:
    """
    Robust sign-in: POST to /auth/v1/token?grant_type=password with form-encoded body
    and explicit Content-Type header. Show helpful errors if it fails.
    """
    if not email or not password:
        st.error("Provide email and password.")
        return False

    url = SUPABASE_URL.rstrip("/") + "/auth/v1/token?grant_type=password"
    headers = {
        "apikey": ANON_KEY,
        "Content-Type": "application/x-www-form-urlencoded"
    }
    # requests will encode dict if we pass data=payload, but we'll also build a safe encoded string
    payload = {
        "email": email,
        "password": password
    }

    try:
        resp = requests.post(url, headers=headers, data=payload, timeout=12)
    except Exception as e:
        st.error(f"Sign-in request failed: {e}")
        return False

    # Debug helper: show status & any server JSON for inspection
    try:
        server_json = resp.json()
    except Exception:
        server_json = {"raw": resp.text}

    if resp.ok:
        tokens = server_json
        access_token = tokens.get("access_token")
        refresh_token = tokens.get("refresh_token")
        expires_at = tokens.get("expires_at") or (int(time.time()) + int(tokens.get("expires_in", 3600)))
        if not access_token:
            st.error("Sign-in succeeded but no access_token returned. Server response: " + str(server_json))
            return False

        ok = validate_and_store_token(access_token, refresh_token=refresh_token, expires_at=expires_at)
        if ok:
            st.success("Signed in successfully.")
            safe_rerun()
            return True
        else:
            return False
    else:
        # Show the server response to help debugging
        st.error(f"Sign-in failed: HTTP {resp.status_code}")
        st.code(f"{server_json}")
        return False



# UI: simple email / password form using st.form
with st.expander("Sign in with email & password", expanded=False):
    with st.form("email_signin_form"):
        si_email = st.text_input("Email", value="dev+tester@example.com")
        si_password = st.text_input("Password", type="password", value="TempPass123!")
        submitted = st.form_submit_button("Sign in")
        if submitted:
            sign_in_with_email_password(si_email.strip(), si_password)

# Sign-out helper
def sign_out():
    keys = ['supabase_access_token','supabase_refresh_token','supabase_user',
            'supabase_expires_at','supabase_token_type','invite_link_type']
    for k in keys:
        if k in st.session_state:
            del st.session_state[k]
    safe_rerun()

# Helper to perform authorized GET to Supabase REST or PostgREST endpoints
def supabase_get(path, params=None):
    token = st.session_state.get('supabase_access_token')
    headers = {}
    if token:
        headers['Authorization'] = f"Bearer {token}"
    headers['apikey'] = ANON_KEY
    url = SUPABASE_URL.rstrip("/") + path
    return requests.get(url, headers=headers, params=params, timeout=10)

# ------------------ End Supabase helper ------------------

st.title("GeM Triage — BOQ extraction & per-line matching")

# Show signed-in user in the sidebar if present
if 'supabase_user' in st.session_state:
    usr = st.session_state['supabase_user']
    st.sidebar.markdown(f"**Signed in:** {usr.get('email')}")
    if st.sidebar.button("Sign out"):
        sign_out()
else:
    st.sidebar.markdown("**Not signed in**")
    st.sidebar.info("If you need to sign in via invite: resend invite in Supabase → click the invite link while Streamlit is running on this machine (localhost).")

# (rest of your app: PDF upload, extraction, SKU matching) ...
# try to load SKU catalogue
try:
    sku_df = pd.read_csv("dummy_skus.csv")
except FileNotFoundError:
    st.error("dummy_skus.csv not found in repo. Add your SKU CSV and retry.")
    st.stop()

if uploaded := st.file_uploader("Upload a GeM tender PDF", type=["pdf"]):
    use_sample = False
else:
    use_sample = st.checkbox("Use sample_tender.pdf from repo (if present)")

if not uploaded and not use_sample:
    st.info("Upload a tender PDF or check 'Use sample_tender.pdf' to test.")
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
def extract_boq_and_text(file_stream) -> dict:
    tables = []
    all_text = []
    with pdfplumber.open(file_stream) as pdf:
        for p in pdf.pages:
            text = p.extract_text() or ""
            all_text.append(text)
            page_tables = p.extract_tables()
            for t in page_tables:
                try:
                    df = pd.DataFrame(t[1:], columns=t[0])
                except Exception:
                    df = pd.DataFrame(t)
                tables.append(df)
    return {"tables": tables, "all_text": "\n".join(all_text)}

extracted = extract_boq_and_text(io.BytesIO(pdf_bytes))
tables = extracted["tables"]
all_text = extracted["all_text"]

st.sidebar.markdown("**Extraction summary**")
st.sidebar.write(f"Pages parsed: {len(all_text.splitlines()) and 'unknown (text extracted)'}")
st.sidebar.write(f"Tables found: {len(tables)}")
st.sidebar.write("Fuzzy engine: " + ("rapidfuzz" if HAS_RAPIDFUZZ else "difflib"))

# The rest of your BOQ processing / matching code (unchanged)...
# normalize and process BOQ -> boq_clean etc.
# (omitted here for brevity; keep your existing matching logic)
