#!/usr/bin/env python3
import os
import requests
from urllib.parse import urlparse

URLS = [
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_6990964.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7034227.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036730.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7035668.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036705.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036453.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036755.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7035690.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7004056.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7035272.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7014955.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7027033.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036726.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036266.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7035743.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7034065.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7019293.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7034893.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036431.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7016467.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036625.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036594.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036702.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036724.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036694.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036678.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036685.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7016141.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_6912920.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7034612.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7004285.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7035016.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_6987896.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036665.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036505.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036683.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7033271.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036532.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7029893.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7034539.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036318.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_6848678.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036374.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7015254.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7033859.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7029782.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7033219.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036673.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036295.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036716.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036516.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7020878.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036554.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7014969.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7034465.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036521.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7034136.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_6975860.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7022916.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7036674.pdf",
    "https://mczecifjqmhbgjkxqsna.supabase.co/storage/v1/object/public/gem-pdfs/bids/2025-12-23/GeM_231225_B_7026735.pdf",
]

OUTPUT_DIR = "tender-pdfs"
TIMEOUT = (10, 120)

os.makedirs(OUTPUT_DIR, exist_ok=True)

def safe_filename(url):
    return os.path.basename(urlparse(url).path)

for idx, url in enumerate(URLS, start=1):
    try:
        resp = requests.get(url, stream=True, timeout=TIMEOUT)
        resp.raise_for_status()

        fname = safe_filename(url)
        path = os.path.join(OUTPUT_DIR, fname)

        with open(path, "wb") as f:
            for chunk in resp.iter_content(8192):
                if chunk:
                    f.write(chunk)

        print(f"[{idx}/{len(URLS)}] OK  -> {fname}")

    except Exception as e:
        print(f"[{idx}/{len(URLS)}] FAIL -> {url} :: {e}")
