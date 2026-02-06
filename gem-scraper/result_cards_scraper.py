#!/usr/bin/env python3
"""
GeM Awarded Bids Scraper – Manual Filter Mode (Stable)

- User applies filters & sort manually
- Script waits for confirmation
- Correct DOM + bid-level deduplication
- Pagination logic UNCHANGED
- No page cap (full scrape)
- Resume-safe via checkpoint
"""

import json, re, time, os
from playwright.sync_api import sync_playwright
from daily_gem_pdf_scraper import navigate_next, wait_for_page_change, find_bid_block_container
from urllib.parse import urljoin
from datetime import datetime


# ---------------- CONFIG ----------------
ROOT = "https://bidplus.gem.gov.in"
RESULTS_URL = ROOT + "/all-bids"

RESULTS_DIR = "gem-scraper/results"
os.makedirs(RESULTS_DIR, exist_ok=True)


SCRAPE_DATE = datetime.now().strftime("%d-%m-%Y")

DATA_FILE = os.path.join(
    RESULTS_DIR,
    f"results_{SCRAPE_DATE}.jsonl"
)

CHECKPOINT_FILE = os.path.join(
    RESULTS_DIR,
    f"results_{SCRAPE_DATE}.chk"
)
# ---------------------------------------


# ---------------- helpers ----------------

def click_filter(page, label_text):
    lbl = page.locator(f"label:has-text('{label_text}')")
    if lbl.count() == 0:
        raise RuntimeError(f"Filter not found: {label_text}")
    lbl.first.click()

def apply_filters(page):
    page.locator("text=Filters").first.click()
    click_filter(page, "Bid/RA Status")
    click_filter(page, "Bid /RA Awarded")

def wait_for_manual_confirmation():
    print("\n🔴 MANUAL ACTION REQUIRED 🔴")
    print("Apply filters & sort in the browser:")
    print("  ✔ Bid/RA Status → Bid /RA Awarded")
    print("  ✔ Bid End Date range (as required)")
    print("  ✔ Sort → Bid End Date : Oldest First")
    input("\nPress ENTER once filters & sorting are applied...")

def normalize_datetime(dt_raw):
    if not dt_raw:
        return None
    for fmt in ("%d-%m-%Y %I:%M %p", "%d-%m-%Y %H:%M"):
        try:
            return datetime.strptime(dt_raw.strip(), fmt).isoformat()
        except:
            continue
    return None


# ---------------- parsing helpers ----------------

def parse_start_datetime(text):
    return parse_datetime_label(text, "Start Date")

def parse_end_datetime(text):
    return parse_datetime_label(text, "End Date")

def parse_datetime_label(raw_text, label):
    if not raw_text:
        return None
    text = " ".join(raw_text.split())

    patterns = [
        r"{label}:\s*([0-9]{{1,2}}-[0-9]{{1,2}}-[0-9]{{4}}\s+[0-9]{{1,2}}:[0-9]{{2}}\s+[AP]M)",
        r"{label}:\s*([0-9]{{1,2}}-[0-9]{{1,2}}-[0-9]{{4}}\s+[0-9]{{2}}:[0-9]{{2}})",
    ]

    for p in patterns:
        m = re.search(p.format(label=re.escape(label)), text, re.I)
        if m:
            return m.group(1)
    return None


def parse_extra_fields(raw_text):
    lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
    item = quantity = ministry = department = organisation = None

    for i, line in enumerate(lines):
        if line.lower().startswith("items:"):
            item = line.split(":",1)[1].strip()

        if line.lower().startswith("quantity:"):
            try:
                quantity = int(line.split(":",1)[1].replace(",","").strip())
            except:
                pass

        if "department name and address" in line.lower():
            parts = []
            j = i + 1
            while j < len(lines) and not lines[j].lower().startswith("start date"):
                parts.append(lines[j])
                j += 1

            if parts: ministry = parts[0]
            if len(parts) > 1: department = parts[1]
            if len(parts) > 2: organisation = " ".join(parts[2:])

    return item, quantity, ministry, department, organisation


# ---------------- card extraction ----------------

def extract_card(card):
    raw_text = card.inner_text().strip()

    bid_match = re.search(r"GEM/\d{4}/B/\d+", raw_text)
    ra_match  = re.search(r"GEM/\d{4}/R/\d+", raw_text)

    bid_number = bid_match.group() if bid_match else None
    ra_number  = ra_match.group() if ra_match else None

    bid_detail_url = ra_detail_url = None

    for i in range(card.locator("a").count()):
        a = card.locator("a").nth(i)
        txt = (a.inner_text() or "").strip()
        href = a.get_attribute("href")
        if txt == bid_number and href:
            bid_detail_url = urljoin(ROOT, href)
        if ra_number and txt == ra_number and href:
            ra_detail_url = urljoin(ROOT, href)

    bid_hover_url = ra_hover_url = None

    if card.locator("a:has-text('View Bid Results')").count():
        href = card.locator("a:has-text('View Bid Results')").first.get_attribute("href")
        bid_hover_url = ROOT + href if href.startswith("/") else href

    if card.locator("a:has-text('View RA Results')").count():
        href = card.locator("a:has-text('View RA Results')").first.get_attribute("href")
        ra_hover_url = ROOT + href if href.startswith("/") else href

    item, quantity, ministry, department, organisation = parse_extra_fields(raw_text)

    return {
        "bid_number": bid_number,
        "bid_detail_url": bid_detail_url,
        "bid_hover_url": bid_hover_url,
        "has_reverse_auction": bool(ra_number),
        "ra_number": ra_number,
        "ra_detail_url": ra_detail_url,
        "ra_hover_url": ra_hover_url,
        "item": item,
        "quantity": quantity,
        "ministry": ministry,
        "department": department,
        "organisation_address": organisation,
        "start_datetime_raw": parse_start_datetime(raw_text),
        "end_datetime_raw": parse_end_datetime(raw_text),
        "start_datetime": normalize_datetime(parse_start_datetime(raw_text)),
        "end_datetime": normalize_datetime(parse_end_datetime(raw_text)),
        "raw_card_text": raw_text
    }


# ---------------- persistence ----------------

def append_records(records):
    with open(DATA_FILE, "a", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

def save_checkpoint(page_no):
    with open(CHECKPOINT_FILE, "w") as f:
        f.write(str(page_no))

def load_checkpoint():
    if os.path.exists(CHECKPOINT_FILE):
        return int(open(CHECKPOINT_FILE).read().strip())
    return 1


# ---------------- main ----------------

def main():
    start_page = load_checkpoint()
    print(f"Starting from page {start_page}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=200)
        page = browser.new_page()
        page.goto(RESULTS_URL)
        page.wait_for_selector("a.bid_no_hover", timeout=30000)

        apply_filters(page)
        wait_for_manual_confirmation()

        page.wait_for_selector("a.bid_no_hover", timeout=30000)

        page_no = start_page
        seen_bids_global = set()

        # fast-forward if resuming
        for i in range(1, start_page):
            navigate_next(page, None, i)
            wait_for_page_change(page, page.url, None)

        while True:
            print(f"Processing page {page_no}...")
            page_records = []

            seen_cards = set()
            links = page.locator("a.bid_no_hover")

            for i in range(links.count()):
                card = find_bid_block_container(links.nth(i))

                try:
                    card_key = card.inner_text().strip()[:120]
                except:
                    continue

                if card_key in seen_cards:
                    continue
                seen_cards.add(card_key)

                rec = extract_card(card)
                if not rec or not rec.get("bid_number"):
                    continue

                bn = rec["bid_number"]
                if bn in seen_bids_global:
                    continue
                seen_bids_global.add(bn)

                page_records.append(rec)

            append_records(page_records)
            save_checkpoint(page_no)

            print(f"Saved {len(page_records)} records from page {page_no}")

            # ✅ STOP CONDITION: No Next page
            if page.locator("a:has-text('Next')").count() == 0:
                print("\n✅ No more pages left. Scraping finished.")
                break

            prev = page.url
            navigate_next(page, None, page_no)
            wait_for_page_change(page, prev, None)

            # ✅ Extra safety: stop if URL didn't change
            if page.url == prev:
                print("\n✅ Page did not change. Ending scrape.")
                break

            page_no += 1



if __name__ == "__main__":
    main()
