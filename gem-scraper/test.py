#!/usr/bin/env python3
"""
Pilot – Extract full card metadata from page-1 & page-2 (Awarded GeM Results)

Filtering logic is kept EXACTLY as earlier.
"""

import json, re, time
from playwright.sync_api import sync_playwright
from daily_gem_pdf_scraper import navigate_next, wait_for_page_change, find_bid_block_container
from urllib.parse import urljoin
from datetime import datetime
from datetime import datetime, timedelta
import argparse
import os

ROOT = "https://bidplus.gem.gov.in"
RESULTS_URL = ROOT + "/all-bids"


DEFAULT_TARGET_DATE = (datetime.now() - timedelta(days=1)).strftime("%d-%m-%Y")
RESULTS_DIR = "gem-scraper/results"
os.makedirs(RESULTS_DIR, exist_ok=True)
OUTFILE = None


# ---------------- existing helpers ---------------- #

def click_filter(page, label_text):
    lbl = page.locator(f"label:has-text('{label_text}')")
    if lbl.count() == 0:
        raise RuntimeError(f"Filter not found: {label_text}")
    lbl.first.click()
    time.sleep(1.5)

def apply_filters(page):
    page.locator("text=Filters").first.click()
    time.sleep(1)
    click_filter(page, "Bid/RA Status")
    time.sleep(3)
    click_filter(page, "Bid /RA Awarded")
    time.sleep(3)

def normalize_datetime(dt_raw):
    if not dt_raw:
        return None

    for fmt in ("%d-%m-%Y %I:%M %p", "%d-%m-%Y %H:%M"):
        try:
            return datetime.strptime(dt_raw.strip(), fmt).isoformat()
        except:
            continue
    return None


# ---------------- parsing helpers (lifted) ---------------- #

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
        r"{label}:\s*([0-9]{{2}}/[0-9]{{2}}/[0-9]{{4}}\s+[0-9]{{1,2}}:[0-9]{{2}}\s*[AP]M)",
        r"{label}:\s*([0-9]{{1,2}}-[0-9]{{1,2}}-[0-9]{{4}}\s+[0-9]{{2}}:[0-9]{{2}})",
        r"{label}:\s*([0-9]{{2}}/[0-9]{{2}}/[0-9]{{4}}\s+[0-9]{{2}}:[0-9]{{2}})",
    ]

    for p in patterns:
        try:
            regex = re.compile(p.format(label=re.escape(label)), re.I)
        except Exception as e:
            print("Regex compile failed:", p, e)
            continue

        m = regex.search(text)
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
                quantity = None

        if "department name and address" in line.lower():
            j = i + 1
            parts = []
            while j < len(lines) and not lines[j].lower().startswith("start date"):
                parts.append(lines[j])
                j += 1

            if len(parts) >= 1:
                ministry = parts[0]

            if len(parts) >= 2:
                department = parts[1]

            if len(parts) >= 3:
                # join all remaining lines to preserve full organisation name
                organisation = " ".join(parts[2:])

    return item, quantity, ministry, department, organisation


# ---------------- card extraction ---------------- #

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


    bid_hover_url = None
    ra_hover_url  = None

    if card.locator("a:has-text('View Bid Results')").count():
        href = card.locator("a:has-text('View Bid Results')").first.get_attribute("href")
        bid_hover_url = ROOT + href if href.startswith("/") else href

    if card.locator("a:has-text('View RA Results')").count():
        href = card.locator("a:has-text('View RA Results')").first.get_attribute("href")
        ra_hover_url = ROOT + href if href.startswith("/") else href

    item, quantity, ministry, department, organisation = parse_extra_fields(raw_text)

    stage = re.search(r"Status:\s*(.*?)\n", raw_text)
    bid_ra_status = re.search(r"Bid/RA Status:\s*(.*?)\n", raw_text)
    tech_status = re.search(r"Technical Status:\s*(.*?)\n", raw_text)

    start_raw = parse_start_datetime(raw_text)
    end_raw   = parse_end_datetime(raw_text)

    has_ra = True if ra_number else False

    return {
        "bid_number": bid_number,
        "bid_detail_url": bid_detail_url,
        "bid_hover_url": bid_hover_url,
        "has_reverse_auction": has_ra,
        "ra_number": ra_number,
        "ra_detail_url": ra_detail_url,
        "ra_hover_url": ra_hover_url,
        "item": item,
        "quantity": quantity,
        "ministry": ministry,
        "department": department,
        "organisation_address": organisation,

        "start_datetime_raw": start_raw,
        "end_datetime_raw": end_raw,
        "start_datetime": normalize_datetime(start_raw),
        "end_datetime": normalize_datetime(end_raw),

        "stage": stage.group(1).strip() if stage else None,
        "bid_ra_status": bid_ra_status.group(1).strip() if bid_ra_status else None,
        "technical_status": tech_status.group(1).strip() if tech_status else None,
        "raw_card_text": raw_text
    }


# ---------------- main ---------------- #

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="End Date to scrape in DD-MM-YYYY format (default: yesterday)")
    args = parser.parse_args()

    target_date = args.date or DEFAULT_TARGET_DATE
    OUTFILE = os.path.join(RESULTS_DIR, f"gem_results_{target_date}.json")

    print(f"Scraping tenders with End Date = {target_date}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=200)
        page = browser.new_page()
        page.goto(RESULTS_URL)
        page.wait_for_selector("a.bid_no_hover")

        apply_filters(page)

        results = []

        for page_no in (1,2):
            links = page.locator("a.bid_no_hover")
            seen_cards = set()

            for i in range(links.count()):
                link = links.nth(i)
                card = find_bid_block_container(link)

                # --- PATCH: dedupe by card container ---
                try:
                    key = card.inner_text().strip()[:120]
                except Exception:
                    continue

                if key in seen_cards:
                    continue
                seen_cards.add(key)

                rec = extract_card(card)
                if not rec or not rec.get("end_datetime_raw"):
                    continue

                if rec["end_datetime_raw"].startswith(target_date):
                    results.append(rec)


            if page_no == 1:
                prev = page.url
                navigate_next(page, None, 1)
                wait_for_page_change(page, prev, None)

        with open(OUTFILE, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)

        print(f"Saved {len(results)} records → {OUTFILE}")
        browser.close()


if __name__ == "__main__":
    main()
