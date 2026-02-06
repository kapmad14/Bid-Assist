#!/usr/bin/env python3
"""
FINAL v6 — GeM BestPrice PBP Scraper + Supabase Push

✅ Scrape all pages until last page reached (no page-count detection)
✅ Filter Create Date = Today OR Yesterday (IST)
✅ Row-wise upsert into Supabase table gem_pbp_notices
✅ Unique key = pbp_number
✅ Clean output: single updating status line
✅ No tqdm / no verbose logs
"""

import os
import re
import time
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright
from supabase import create_client


# ---------------- CONFIG ---------------- #

load_dotenv()

BESTPRICE_URL = "https://bestprice.gem.gov.in/?tab=Product%20PBP%20Notice"
PAGE_LOAD_TIMEOUT = 30000
MAX_PAGES_SAFETY = 250

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/114.0 Safari/537.36"
)


# ---------------- DATE WINDOW ---------------- #

def allowed_days():
    ist_now = datetime.now(tz=ZoneInfo("Asia/Kolkata"))
    today = ist_now.strftime("%d-%m-%Y")
    yesterday = (ist_now.date() - timedelta(days=1)).strftime("%d-%m-%Y")
    return {today, yesterday}


# ---------------- EXTRACTION HELPERS ---------------- #

def extract_single(raw_text: str, label: str):
    m = re.search(rf"{label}:\s*(.+)", raw_text)
    return m.group(1).strip() if m else None


def extract_multiline_raw(raw_text: str, label: str, stop_labels: list):
    stop_pattern = "|".join(stop_labels)
    m = re.search(
        rf"{label}:\s*(.*?)\s*(?:{stop_pattern}:|$)",
        raw_text,
        re.DOTALL
    )
    return m.group(1).strip() if m else None


def split_department_address(block: str):
    if not block:
        return None, None

    lines = [l.strip() for l in block.splitlines() if l.strip()]
    if not lines:
        return None, None

    department = lines[0]
    address = " ".join(lines[1:]) if len(lines) > 1 else None
    return department, address


def extract_notice(card):
    raw_text = card.inner_text().strip()

    pbp_number = card.locator("div.bid_no b.ng-binding").inner_text().strip()

    dept_block = extract_multiline_raw(
        raw_text,
        "Department Name And Address",
        stop_labels=["Create Date", "End Date"]
    )
    department, address = split_department_address(dept_block)

    qty = extract_single(raw_text, "Quantity Required")
    qty_int = int(qty.replace(",", "")) if qty and qty.replace(",", "").isdigit() else None

    return {
        "pbp_number": pbp_number,
        "item": extract_single(raw_text, r"Item\(s\)"),
        "quantity_required": qty_int,
        "ministry": extract_single(raw_text, "Ministry"),
        "organization": extract_single(raw_text, "Organization"),
        "department": department,
        "address": address,
        "create_date": extract_single(raw_text, "Create Date"),
        "end_date": extract_single(raw_text, "End Date"),
        "raw_text": raw_text,
    }


# ---------------- FULL Stable Pagination ---------------- #

def navigate_next(page, current_page_number: int) -> bool:
    """Navigate forward until last page reached."""

    target_page_num = current_page_number + 1

    # Numeric page click
    try:
        anchors = page.locator("a")
        for i in range(anchors.count()):
            a = anchors.nth(i)
            txt = (a.inner_text() or "").strip()
            if txt == str(target_page_num):
                a.click()
                return True
    except Exception:
        pass

    # Next button fallback
    try:
        next_btn = page.locator("a:has-text('Next')")
        if next_btn.count() > 0:
            next_btn.first.click()
            return True
    except Exception:
        pass

    return False


def wait_for_page_change(page, first_before_text: str) -> bool:
    """Wait until first notice changes."""

    waited = 0
    interval = 400

    while waited < PAGE_LOAD_TIMEOUT:

        time.sleep(interval / 1000)

        try:
            first_now = (
                page.locator("div[public-push_button_notice-show]")
                .first.locator("b.ng-binding")
                .inner_text()
                .strip()
            )
        except Exception:
            first_now = None

        if first_now and first_now != first_before_text:
            return True

        waited += interval

    return False


# ---------------- STATUS LINE ---------------- #

def status_line(page, cards, pushed):
    msg = f"Page {page:>3} | Cards: {cards:>2} | Sent: {pushed}"
    sys.stdout.write("\r" + msg)
    sys.stdout.flush()


# ---------------- MAIN PIPELINE ---------------- #

def run():

    valid_days = allowed_days()
    pushed_count = 0
    page_number = 1

    with sync_playwright() as p:

        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=USER_AGENT,
            timezone_id="Asia/Kolkata",
            locale="en-IN",
        )

        page = context.new_page()
        page.goto(BESTPRICE_URL, timeout=PAGE_LOAD_TIMEOUT)
        page.wait_for_selector("div[public-push_button_notice-show]")

        while page_number <= MAX_PAGES_SAFETY:

            cards = page.locator("div[public-push_button_notice-show]")
            card_count = cards.count()

            if card_count == 0:
                break

            # Display status only every 5 pages (and page 1)
            if page_number == 1 or page_number % 5 == 0:
                status_line(page_number, card_count, pushed_count)

            # Process cards
            for i in range(card_count):

                notice = extract_notice(cards.nth(i))

                if not notice["create_date"]:
                    continue

                create_day = notice["create_date"].split()[0]
                if create_day not in valid_days:
                    continue

                try:
                    supabase.table("gem_pbp_notices").upsert(
                        notice,
                        on_conflict="pbp_number"
                    ).execute()
                    pushed_count += 1
                except Exception:
                    continue

            # Navigation
            first_before = (
                cards.first.locator("b.ng-binding")
                .inner_text()
                .strip()
            )

            ok = navigate_next(page, page_number)
            if not ok:
                break

            if not wait_for_page_change(page, first_before):
                break

            page_number += 1
            time.sleep(0.5)

        status_line(page_number, card_count, pushed_count)
        print()

        browser.close()

    print(f"\n✅ Finished. Total attempted pushes: {pushed_count}")


if __name__ == "__main__":
    run()
