#!/usr/bin/env python3
"""
Batch updater for gem_results table (Supabase)

Features:
- Processes rows in batches of 20 using keyset pagination (id > last_id)
- Only picks rows where extraction_status = 'pending'
- Uses your existing scraper logic
- Writes:
  - tech_participated
  - tech_qualified
  - L1/L2/L3 seller, item, price
- Marks extraction_status = 'success' or 'error'
"""

import os, json, re, time
import requests
from pathlib import Path
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from tqdm import tqdm

# ---------- CONFIG ---------- #

# Load .env only if present (local runs)
load_dotenv(override=False)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVICE_ROLE_KEY = os.getenv("SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    raise RuntimeError("Set SUPABASE_URL and SERVICE_ROLE_KEY in .env")

REST = SUPABASE_URL.rstrip("/") + "/rest/v1"
BATCH_SIZE = 20
MAX_BATCHES = 8000


HEADERS = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

SCRAPE_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept-Language": "en-US,en;q=0.9"
}

# ---------- UTIL ---------- #

def clean(text):
    return re.sub(r"\s+", " ", text.strip()) if text else None

# ---------- TECHNICAL EVAL ---------- #

def find_technical_table(soup):
    header = soup.find(string=lambda x: x and "TECHNICAL EVALUATION" in x.upper())
    if not header:
        return None
    return header.find_parent().find_next("table")

def extract_technical_counts(soup):
    table = find_technical_table(soup)
    if not table:
        return None, None

    participated = 0
    qualified = 0

    for tr in table.find_all("tr")[1:]:
        tds = tr.find_all("td")
        if not tds:
            continue

        participated += 1

        status = clean(tds[-1].get_text(" "))
        if status and status.lower() == "qualified":
            qualified += 1

    return participated, qualified

# ---------- FINANCIAL EVAL ---------- #

def find_financial_table(soup):
    header = soup.find(string=lambda x: x and "FINANCIAL EVALUATION" in x.upper())
    if not header:
        return None
    return header.find_parent().find_next("table")

def find_evaluation_table(soup):
    header = soup.find(
        string=lambda x: x
        and "EVALUATION" in x.upper()
        and "TECHNICAL" not in x.upper()
        and "FINANCIAL" not in x.upper()
    )
    if not header:
        return None

    return header.find_parent().find_next("table")


def extract_l123_rows(soup):
    table = find_financial_table(soup)
    if not table:
        return []

    rows = []

    for tr in table.find_all("tr")[1:]:
        cols = [clean(td.get_text(" ")) for td in tr.find_all("td")]
        if len(cols) != 5:
            continue

        rank = cols[4]
        if rank not in ("L1", "L2", "L3"):
            continue

        seller = re.sub(r"\s*\(.*?\)", "", cols[1])
        seller = re.sub(r"\bUnder\s+PMA\b", "", seller, flags=re.I).strip()

        item = re.sub(r"^Item Categories\s*:\s*", "", cols[2], flags=re.I).strip()

        price_raw = re.sub(r"[^\d.]", "", cols[3])
        price = price_raw.split(".")[0] if price_raw else None

        rows.append((rank, seller, item, price))

    return rows

def extract_from_evaluation_table(soup):
    table = find_evaluation_table(soup)
    if not table:
        return None, None, []

    participated = 0
    qualified = 0
    rows = []

    # Inspect header row to understand column positions dynamically
    header_cells = [clean(th.get_text(" ")) for th in table.find_all("th")]

    # Try to locate columns by name rather than position
    try:
        rank_idx = next(i for i, h in enumerate(header_cells) if h and "RANK" in h.upper())
        seller_idx = next(i for i, h in enumerate(header_cells) if h and "SELLER" in h.upper())
        item_idx = next(i for i, h in enumerate(header_cells) if h and "ITEM" in h.upper())
        price_idx = next(i for i, h in enumerate(header_cells) if h and "PRICE" in h.upper())
        status_idx = next(i for i, h in enumerate(header_cells) if h and "STATUS" in h.upper())
    except StopIteration:
        # fallback to your original positions if headers are weird
        rank_idx, seller_idx, item_idx, price_idx, status_idx = 4, 1, 2, 3, -1

    for tr in table.find_all("tr")[1:]:
        cols = [clean(td.get_text(" ")) for td in tr.find_all("td")]
        if not cols:
            continue

        participated += 1

        # qualification count
        status = clean(cols[status_idx]) if status_idx < len(cols) else None
        if status and status.lower() == "qualified":
            qualified += 1

        # rank must exist and be L1/L2/L3
        if rank_idx >= len(cols):
            continue

        rank = cols[rank_idx]
        if rank not in ("L1", "L2", "L3"):
            continue

        seller = cols[seller_idx] if seller_idx < len(cols) else None
        item = cols[item_idx] if item_idx < len(cols) else None
        price_raw = cols[price_idx] if price_idx < len(cols) else None

        seller = re.sub(r"\s*\(.*?\)", "", seller or "")
        seller = re.sub(r"\bUnder\s+PMA\b", "", seller, flags=re.I).strip()

        item = re.sub(r"^Item Categories\s*:\s*", "", item or "", flags=re.I).strip()

        price_clean = re.sub(r"[^\d.]", "", price_raw or "")
        price = price_clean.split(".")[0] if price_clean else None

        rows.append((rank, seller, item, price))

    return participated, qualified, rows


# ---------- SCRAPE ONE URL ---------- #

def scrape_bid_or_ra(url):
    r = requests.get(url, headers=SCRAPE_HEADERS, timeout=30)
    r.raise_for_status()
    html = r.text

    soup = BeautifulSoup(html, "lxml")

    # Try normal tables first
    tech_participated, tech_qualified = extract_technical_counts(soup)
    rows = extract_l123_rows(soup)

    # ---- NEW: if both tables are missing, try "Evaluation" ----
    if tech_participated is None and not rows:
        eval_participated, eval_qualified, rows = extract_from_evaluation_table(soup)
        tech_participated = eval_participated
        tech_qualified = eval_qualified


    # Normalize into dict
    out = {
        "tech_participated": tech_participated,
        "tech_qualified": tech_qualified,
        "l1_seller": None, "l1_item": None, "l1_price": None,
        "l2_seller": None, "l2_item": None, "l2_price": None,
        "l3_seller": None, "l3_item": None, "l3_price": None,
    }

    for rank, seller, item, price in rows:
        key = rank.lower()  # l1, l2, l3
        out[f"{key}_seller"] = seller
        out[f"{key}_item"] = item
        out[f"{key}_price"] = price

    return out

# ---------- SUPABASE HELPERS ---------- #

def fetch_pending_batch(last_id):
    url = (
        f"{REST}/gem_results"
        f"?extraction_status=eq.pending"
        f"&id=gt.{last_id}"
        f"&order=id.asc"
        f"&limit={BATCH_SIZE}"
    )

    r = requests.get(url, headers=HEADERS)
    r.raise_for_status()
    return r.json()

def update_row(row_id, payload, status):
    payload = payload.copy()
    payload["extraction_status"] = status

    # IMPORTANT: clear previous errors on success
    if status == "success":
        payload["extraction_error"] = None

    url = f"{REST}/gem_results?id=eq.{row_id}"

    r = requests.patch(url, headers=HEADERS, data=json.dumps(payload))
    if not r.ok:
        print("Update failed:", r.text)

def render_progress(done, total, errors, bar_width=40):
    pct = done / total if total else 0
    filled = int(bar_width * pct)
    bar = "█" * filled + "-" * (bar_width - filled)

    # Note the newline at the END of this line 👇
    print(
        f"[{bar}] {done}/{total} ({pct*100:5.1f}%)  |  Errors: {errors}/{done}"
    )

# ---------- MAIN LOOP ---------- #

def main():
    print("🚀 GeM batch updater started")

    last_id = 0
    error_count = 0

    # ---------- CORRECT TOTAL COUNT ----------
    count_url = (
        f"{REST}/gem_results"
        f"?extraction_status=eq.pending"
        f"&select=id"
    )

    count_headers = HEADERS.copy()
    count_headers["Prefer"] = "count=exact"

    r = requests.get(count_url, headers=count_headers)
    r.raise_for_status()

    total_pending = int(r.headers.get("Content-Range", "0/0").split("/")[-1])

    print(f"\nTotal pending rows: {total_pending}\n")

    processed = 0

    with tqdm(total=total_pending, desc="Processing GeM results") as pbar:

        for _ in range(MAX_BATCHES):
            batch = fetch_pending_batch(last_id)
            if not batch:
                print("\n🎯 No more pending rows. Done.")
                break

            for row in batch:
                row_id = row["id"]
                bid_url = row["bid_hover_url"]
                ra_url = row.get("ra_hover_url")

                try:
                    if row.get("has_reverse_auction"):
                        tech_scrape = scrape_bid_or_ra(bid_url)

                        if not ra_url:
                            raise ValueError(
                                "has_reverse_auction is true but ra_hover_url is null"
                            )

                        fin_scrape = scrape_bid_or_ra(ra_url)

                        scraped = tech_scrape.copy()
                        for k, v in fin_scrape.items():
                            if k.startswith(("l1_", "l2_", "l3_")):
                                scraped[k] = v

                    else:
                        scraped = scrape_bid_or_ra(bid_url)

                    if scraped["l1_seller"] is None:
                        raise ValueError(
                            "No L1 details extracted — likely layout change or missing table"
                        )

                    update_row(row_id, scraped, "success")

                except Exception as e:
                    error_count += 1
                    print(f"\n❌ Error on id={row_id}: {e}")
                    update_row(
                        row_id,
                        {"extraction_error": str(e)},
                        "failed"
                    )

                last_id = row_id
                processed += 1
                pbar.update(1)

            time.sleep(1.5)

    print(f"\nProcessed total rows: {processed}")
    print(f"Final errors: {error_count}")


if __name__ == "__main__":
    main()
