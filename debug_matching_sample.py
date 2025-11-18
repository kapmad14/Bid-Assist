# debug_matching_sample.py
import os
from rapidfuzz import fuzz
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY_SERVICE")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY) in .env")

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

def normalize(s):
    if s is None:
        return ""
    return " ".join(str(s).lower().strip().split())

def fetch_sample_tenders(limit=20):
    resp = supabase.table("tenders").select("id, item_category_parsed").range(0, limit-1).execute()
    data = getattr(resp, "data", None) or (resp.get("data") if isinstance(resp, dict) else None)
    return data or []

def fetch_active_catalog(limit=100):
    resp = supabase.table("catalog_items").select("id, user_id, category").eq("status", "active").range(0, limit-1).execute()
    data = getattr(resp, "data", None) or (resp.get("data") if isinstance(resp, dict) else None)
    return data or []

def main():
    tenders = fetch_sample_tenders(limit=50)
    cats = fetch_active_catalog(limit=200)

    if not tenders:
        print("No tenders found in sample.")
        return
    if not cats:
        print("No active catalog items found.")
        return

    print(f"Loaded {len(tenders)} tenders and {len(cats)} active catalog items for sample.")

    # For each tender, compute top 5 matching catalog items by token_sort_ratio
    for t in tenders:
        tid = t.get("id")
        ttext = normalize(t.get("item_category_parsed"))
        if not ttext:
            continue
        scores = []
        for c in cats:
            ctext = normalize(c.get("category"))
            if not ctext:
                continue
            sc = fuzz.token_sort_ratio(ttext, ctext)
            scores.append((sc, c.get("id"), c.get("user_id"), ctext))
        top = sorted(scores, key=lambda x: x[0], reverse=True)[:5]
        print("TENDER:", tid, "->", ttext)
        for sc, cid, uid, ctext in top:
            print(f"  score={sc:3} catalog_id={cid} user={uid} text='{ctext}'")
        print("-" * 80)

if __name__ == "__main__":
    main()
