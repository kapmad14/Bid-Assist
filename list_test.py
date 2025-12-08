#!/usr/bin/env python3
import os, json, requests
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET_NAME", os.environ.get("SUPABASE_BUCKET","gem-pdfs"))
print("PREFIX_JSON:", os.environ.get("PER_BID_JSON_PREFIX","daily_json_files/"))
print("PREFIX_PDF:", os.environ.get("PDFS_PREFIX","bids/"))
headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"}
def list_prefix(prefix):
    url = f"{SUPABASE_URL}/storage/v1/object/list/{SUPABASE_BUCKET}"
    r = requests.post(url, headers=headers, json={"prefix": prefix, "limit": 100, "offset": 0}, timeout=30)
    print("status", r.status_code)
    try:
        js = r.json()
        if isinstance(js, list):
            print("returned:", len(js))
            names = [(i.get("name") if isinstance(i, dict) else i) for i in js[:20]]
            print("sample:", names)
        else:
            print("shape:", type(js))
            print(json.dumps(js)[:800])
    except Exception as e:
        print("json parse failed:", e, (r.text or "")[:800])

list_prefix(os.environ.get("PER_BID_JSON_PREFIX","daily_json_files/"))
list_prefix(os.environ.get("PDFS_PREFIX","bids/"))
