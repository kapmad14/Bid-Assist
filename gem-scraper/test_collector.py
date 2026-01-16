#!/usr/bin/env python3
"""
Pilot – Extract first 25 Awarded GeM Results (no date filter)

This version ignores dates completely to validate UI automation.
"""

import json, re, time
from playwright.sync_api import sync_playwright
from daily_gem_pdf_scraper import navigate_next, wait_for_page_change
from daily_gem_pdf_scraper import find_bid_block_container

ROOT = "https://bidplus.gem.gov.in"
RESULTS_URL = ROOT + "/all-bids"

MAX_RECORDS = 25
OUTFILE = "gem_results_pilot_first25.json"


def click_filter(page, label_text):
    lbl = page.locator(f"label:has-text('{label_text}')")
    if lbl.count() == 0:
        raise RuntimeError(f"Filter not found: {label_text}")
    lbl.first.click()
    time.sleep(1.5)


def apply_filters(page):
    # open filters
    page.locator("text=Filters").first.click()
    time.sleep(1)

    # click Bid/RA Status – this was working earlier
    click_filter(page, "Bid/RA Status")

    # GeM needs time to inject nested filters
    time.sleep(3)

    # now click Bid / RA Awarded (same logic)
    click_filter(page, "Bid /RA Awarded")

    # allow results list to refresh
    time.sleep(3)



def extract_table(page):
    rows = page.locator("table tbody tr")
    data = []
    for i in range(rows.count()):
        tds = rows.nth(i).locator("td")
        data.append([tds.nth(j).inner_text().strip() for j in range(tds.count())])
    return data


def expand(page, label):
    loc = page.locator(f"text='{label}'")
    if loc.count():
        loc.first.click()
        time.sleep(1)

def extract_eval_table(page):
    rows = page.locator("table tbody tr")
    data = []
    for i in range(rows.count()):
        tds = rows.nth(i).locator("td")
        data.append([tds.nth(j).inner_text().strip() for j in range(tds.count())])
    return data


def get_active_panel(page):
    # The result detail page is injected inside this wrapper
    panel = page.locator("div.tab-content div.active")
    if panel.count() == 0:
        raise RuntimeError("Active results panel not found")
    return panel.first

def extract_kv_blocks(page):
    data = {}

    blocks = page.locator("div.card-body div.row")
    for i in range(blocks.count()):
        row = blocks.nth(i)
        txt = row.inner_text().strip()

        for line in txt.split("\n"):
            if ":" in line:
                k, v = line.split(":", 1)
                data[k.strip()] = v.strip()

    return data

def get_result_url(card):
    btn = card.locator("a:has-text('View Bid Results')")
    href = btn.get_attribute("href")
    if not href:
        raise RuntimeError("Result link not found")
    if href.startswith("/"):
        href = "https://bidplus.gem.gov.in" + href
    return href

def extract_bid_ra_links(card):
    data = {}

    # Bid No
    bid_match = re.search(r"GEM/\d{4}/B/\d+", card.inner_text())
    if bid_match:
        data["bid_number"] = bid_match.group()

    bid_btn = card.locator("a:has-text('View Bid Results')")
    if bid_btn.count():
        href = bid_btn.get_attribute("href")
        if href:
            data["bid_result_url"] = ROOT + href if href.startswith("/") else href

    # RA
    ra_match = re.search(r"GEM/\d{4}/R/\d+", card.inner_text())
    if ra_match:
        data["ra_number"] = ra_match.group()

        ra_btn = card.locator("a:has-text('View RA Results')")
        if ra_btn.count():
            href = ra_btn.get_attribute("href")
            if href:
                data["ra_result_url"] = ROOT + href if href.startswith("/") else href

    return data


def expand_section(page, title):
    link = page.locator(f"a:has-text('{title}')")
    if link.count() == 0:
        print(f"[WARN] Expand link not found: {title}")
        return False

    link.first.scroll_into_view_if_needed()
    link.first.click()
    page.wait_for_load_state("networkidle")
    time.sleep(2)
    return True

def get_bid_result_href(card):
    a = card.locator("a:has-text('View Bid Results')")
    href = a.get_attribute("href")
    if not href:
        raise RuntimeError("Bid result href not found")
    if href.startswith("/"):
        href = ROOT + href
    return href


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=250)
        context = browser.new_context()
        page = context.new_page()

        page.goto(RESULTS_URL)

        page.wait_for_selector("a.bid_no_hover")

        apply_filters(page)
        time.sleep(3)

        results = []
        seen = set()

        links = page.locator("a.bid_no_hover")
        count = links.count()

        for i in range(count):
            link = links.nth(i)
            card = find_bid_block_container(link)

            key = card.inner_text().split("\n")[0].strip()
            if key in seen:
                continue
            seen.add(key)

            record = extract_bid_ra_links(card)
            results.append(record)

            if len(results) >= 10:
                break

        print("\n======= FIRST 10 RESULT LINKS =======\n")
        print(json.dumps(results, indent=2))
        print("\n====================================\n")

        with open(OUTFILE, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)

        print(f"\n✅ Saved {len(results)} records → {OUTFILE}")


        browser.close()


if __name__ == "__main__":
    main()
