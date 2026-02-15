#!/usr/bin/env python3
"""
Weekly Failed Retry Updater for gem_results table (Supabase)

Features:
- Picks only rows where extraction_status = 'failed'
- Retries scraping once per week
- If success → marks extraction_status = 'success'
- If still failing → keeps extraction_status = 'failed'
"""

import os, json, re, time
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from tqdm import tqdm

# ---------- CONFIG ---------- #

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVICE_ROLE_KEY = os.getenv("SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    raise RuntimeError("Set SUPABASE_URL and SERVICE_ROLE_KEY in .env")

REST = SUPABASE_URL.rstrip("/") + "/rest/v1"
BATCH_SIZE = 20
MAX_BATCHES = 500   # weekly retries → smaller cap

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


# ---------- TABLE EXTRACTION ---------- #

def find_technical_table(soup):
    header = soup.find(string=lambda x: x and "TECHNICAL EVALUATION" in x.upper())
    if not header:
        return None
    return header.find_parent().find_next("table")

def count_failed_rows():
    url = (
        f"{REST}/gem_results"
        f"?extraction_status=eq.failed"
        f"&retry_count=lt.10"
        f"&select=id"
    )

    count_headers = HEADERS.copy()
    count_headers["Prefer"] = "count=planned"

    r = requests.get(url, headers=count_headers)
    r.raise_for_status()

    total = int(r.headers.get("Content-Range", "0/0").split("/")[-1])
    return total

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


def find_financial_table(soup):
    header = soup.find(string=lambda x: x and "FINANCIAL EVALUATION" in x.upper())
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

        seller = re.sub(r"\s*\(.*?\)", "", cols[1] or "")
        item = re.sub(r"^Item Categories\s*:\s*", "", cols[2] or "", flags=re.I)

        price_clean = re.sub(r"[^\d]", "", cols[3] or "")
        price = int(price_clean) if price_clean else None

        rows.append((rank, seller.strip(), item.strip(), price))

    return rows


# ---------- SCRAPE ONE URL ---------- #

def scrape_bid(url):
    r = requests.get(url, headers=SCRAPE_HEADERS, timeout=30)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "lxml")

    tech_participated, tech_qualified = extract_technical_counts(soup)
    rows = extract_l123_rows(soup)

    out = {
        "tech_participated": tech_participated,
        "tech_qualified": tech_qualified,
        "l1_seller": None, "l1_item": None, "l1_price": None,
        "l2_seller": None, "l2_item": None, "l2_price": None,
        "l3_seller": None, "l3_item": None, "l3_price": None,
    }

    for rank, seller, item, price in rows:
        key = rank.lower()
        out[f"{key}_seller"] = seller
        out[f"{key}_item"] = item
        out[f"{key}_price"] = price

    return out


# ---------- SUPABASE HELPERS ---------- #

def fetch_failed_batch(last_id):
    url = (
        f"{REST}/gem_results"
        f"?extraction_status=eq.failed"
        f"&retry_count=lt.10"
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

    if status == "success":
        payload["extraction_error"] = None

    url = f"{REST}/gem_results?id=eq.{row_id}"
    r = requests.patch(url, headers=HEADERS, data=json.dumps(payload))

    if not r.ok:
        print("Update failed:", r.text)


# ---------- MAIN LOOP ---------- #

def main():
    last_id = 0
    processed = 0
    recovered = 0
    still_failed = 0

    print("\n🔁 Weekly Failed Retry Updater Starting...\n")

    total_failed = count_failed_rows()
    print(f"Total retry-eligible failed rows: {total_failed}\n")

    with tqdm(total=total_failed, desc="Retrying failed rows") as pbar:


        for _ in range(MAX_BATCHES):

            batch = fetch_failed_batch(last_id)

            if not batch:
                print("\n✅ No more retry-eligible failed rows left.")
                break

            for row in batch:
                row_id = row["id"]
                bid_url = row.get("bid_hover_url")

                try:
                    if not bid_url:
                        raise ValueError("bid_hover_url is NULL")

                    scraped = scrape_bid(bid_url)

                    if scraped["l1_seller"] is None:
                        raise ValueError("Still no L1 results available")

                    # ✅ Success → reset retry_count
                    update_row(
                        row_id,
                        {**scraped, "retry_count": 0},
                        "success"
                    )
                    recovered += 1

                except Exception as e:
                    still_failed += 1

                    # ✅ Failure → increment retry_count
                    update_row(
                        row_id,
                        {
                            "extraction_error": f"Weekly retry failed: {e}",
                            "retry_count": row.get("retry_count", 0) + 1
                        },
                        "failed"
                    )



                last_id = row_id
                processed += 1
                pbar.update(1)

            time.sleep(2)

    print("\n✅ Weekly Retry Complete")
    print(f"Processed     : {processed}")
    print(f"Recovered ✅  : {recovered}")
    print(f"Still Failed ❌: {still_failed}")


if __name__ == "__main__":
    main()
