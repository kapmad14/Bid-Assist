import json
import os
import re
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urljoin

import requests
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

# ---------------- CONFIG ---------------- #

ROOT_URL = "https://bidplus.gem.gov.in"
ALL_BIDS_URL = ROOT_URL + "/all-bids"
PAGE_LOAD_TIMEOUT = 30_000
MAX_PAGES = 5000  # hard safety cap

# Supabase config via env vars
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
# default bucket = gem-pdfs (your requirement)
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET_NAME", "gem-pdfs")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/114.0 Safari/537.36"
)

# Local metadata folder (inside gem-scraper)
DAILY_DATA_DIR = os.path.join(os.path.dirname(__file__), "daily_data")

# ---------------------------------------- #


def get_target_date() -> datetime.date:
    """Use 'yesterday' as the target Start Date."""
    today = datetime.now().date()
    return today - timedelta(days=1)


def set_sort_latest_start(page):
    """Click 'Sort by' → 'Bid Start Date: Latest First'."""
    sort_btn = page.locator("button:has-text('Sort by')")
    if sort_btn.count() == 0:
        sort_btn = page.locator("text=Sort by")
    sort_btn.first.click()

    option = page.locator("text='Bid Start Date: Latest First'")
    option.first.click()

    page.wait_for_timeout(2000)


def find_bid_block_container(link_locator):
    """
    Starting from the <a class='bid_no_hover'> link (the Bid No),
    walk up ancestors until the text looks like a full card.
    """
    container = link_locator
    last_good = link_locator

    for _ in range(8):  # walk up max 8 levels
        parent = container.locator("xpath=ancestor::*[1]")
        if parent.count() == 0:
            break

        try:
            text = parent.inner_text().strip()
        except PlaywrightTimeoutError:
            break

        last_good = parent
        upper = text.upper()

        if "ITEMS:" in upper or "START DATE" in upper or "QUANTITY:" in upper:
            return parent

        container = parent

    return last_good  # best we could find


def parse_start_datetime(raw_text: str) -> Optional[datetime]:
    """
    Extract the Start Date datetime from the card text.

    Expects pattern like:
      Start Date: 01-12-2025 11:29 AM
    """
    text = " ".join(raw_text.split())
    m = re.search(
        r"Start Date:\s*([0-9]{2}-[0-9]{2}-[0-9]{4}\s+[0-9]{1,2}:[0-9]{2}\s+[AP]M)",
        text,
        re.IGNORECASE,
    )
    if not m:
        return None

    dt_str = m.group(1)
    try:
        return datetime.strptime(dt_str, "%d-%m-%Y %I:%M %p")
    except ValueError:
        return None


def parse_extra_fields(raw_text: str) -> dict:
    """Parse item, quantity, department from the card text (optional metadata)."""
    lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
    joined = " ".join(lines)

    # Items
    m_items = re.search(r"Items:\s*(.+?)(?:\s+Quantity:|$)", joined, re.IGNORECASE)
    item = m_items.group(1).strip(" .") if m_items else None

    # Quantity
    m_qty = re.search(r"Quantity:\s*([0-9]+)", joined, re.IGNORECASE)
    quantity = int(m_qty.group(1)) if m_qty else None

    # Department
    m_dept = re.search(
        r"Department Name And Address:\s*(.+?)\s*Start Date:",
        joined,
        re.IGNORECASE,
    )
    department = m_dept.group(1).strip() if m_dept else None

    return {
        "item": item,
        "quantity": quantity,
        "department": department,
    }


def scrape_page_for_target_date(page, page_number: int, target_date: datetime.date):
    """
    Scrape this page and:
      - keep RA-free bids with Start Date *date part* == target_date
      - stop when we hit bids older than target_date.
    Returns: (matches_on_this_page, passed_target_date_flag)
    """
    matches = []
    passed_target_date = False

    bid_links = page.locator("a.bid_no_hover")
    count = bid_links.count()
    print(f"Page {page_number}: {count} bid/RA links")

    for i in range(count):
        link = bid_links.nth(i)
        bid_number = link.inner_text().strip()

        # Only consider genuine Bid numbers
        if "/B/" not in bid_number:
            continue

        href = link.get_attribute("href") or ""
        detail_url = urljoin(ROOT_URL, href)

        container = find_bid_block_container(link)

        try:
            raw_text = container.inner_text().strip()
        except PlaywrightTimeoutError:
            raw_text = link.inner_text().strip()

        # Skip if this card mentions RA NO anywhere
        if "RA NO" in raw_text.upper():
            continue

        start_dt = parse_start_datetime(raw_text)
        if start_dt is None:
            continue

        sd = start_dt.date()

        if sd == target_date:
            extra = parse_extra_fields(raw_text)
            matches.append(
                {
                    "page": page_number,
                    "bid_number": bid_number,
                    "detail_url": detail_url,
                    "start_datetime": start_dt.isoformat(),
                    "raw_text": raw_text,
                    **extra,
                }
            )
        elif sd < target_date:
            # sorted 'Latest First' => we've gone past the target date
            passed_target_date = True
            break

        # if sd > target_date: newer; just continue

    print(f"Page {page_number}: kept {len(matches)} bids with Start Date = {target_date}")
    return matches, passed_target_date


def find_next_button(page):
    candidates = [
        "a[aria-label='Next']",
        "a.page-link[rel='next']",
        "a:has-text('Next')",
        "button:has-text('Next')",
    ]
    for sel in candidates:
        loc = page.locator(sel)
        if loc.count() == 0:
            continue
        btn = loc.first
        disabled = (btn.get_attribute("disabled") or "").lower()
        classes = (btn.get_attribute("class") or "").lower()
        if "disabled" in classes or disabled in ("true", "disabled"):
            continue
        return btn
    return None


def scrape_for_date(target_date: datetime.date):
    all_bids = []

    with sync_playwright() as p:
        # headless=True is better for Docker / non-GUI
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        print(f"Opening: {ALL_BIDS_URL}")
        page.goto(ALL_BIDS_URL, timeout=PAGE_LOAD_TIMEOUT)
        page.wait_for_selector("a.bid_no_hover", timeout=PAGE_LOAD_TIMEOUT)

        set_sort_latest_start(page)

        page_number = 1
        while page_number <= MAX_PAGES:
            print(f"\n--- Scraping page {page_number} ---")
            page_bids, passed_target_date = scrape_page_for_target_date(
                page, page_number, target_date
            )
            all_bids.extend(page_bids)

            if passed_target_date:
                print("Reached bids older than target date; stopping.")
                break

            next_btn = find_next_button(page)
            if not next_btn:
                print("No usable 'Next' button found or it's disabled. Stopping.")
                break

            print("Clicking 'Next'...")
            next_btn.click()
            try:
                page.wait_for_selector("a.bid_no_hover", timeout=PAGE_LOAD_TIMEOUT)
            except PlaywrightTimeoutError:
                print("Timed out waiting for next page. Stopping.")
                break

            page_number += 1

        browser.close()

    return all_bids


# ---------- PDF download + Supabase upload ---------- #


def ensure_supabase_env():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in env")


def download_pdf(detail_url: str) -> bytes:
    """
    Download the PDF bytes from the bid detail_url.
    Example: https://bidplus.gem.gov.in/showbidDocument/8655996
    """
    print(f"  Downloading PDF: {detail_url}")
    resp = requests.get(
        detail_url,
        headers={"User-Agent": USER_AGENT},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.content


def upload_pdf_to_supabase(pdf_bytes: bytes, object_name: str):
    """
    Upload a PDF to Supabase Storage using REST API.
    object_name is the full path within the bucket (e.g. 'bids/GeM_011225_B_6950285.pdf')
    """
    ensure_supabase_env()

    storage_url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{object_name}"

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/pdf",
        "x-upsert": "true",  # overwrite if exists
    }

    print(f"  Uploading to Supabase as '{object_name}'")
    resp = requests.post(storage_url, headers=headers, data=pdf_bytes)
    if not resp.ok:
        raise RuntimeError(
            f"Failed to upload to Supabase ({resp.status_code}): {resp.text}"
        )


def main():
    # ensure local metadata directory exists
    os.makedirs(DAILY_DATA_DIR, exist_ok=True)

    target_date = get_target_date()
    print(f"Target date (yesterday) = {target_date}")

    bids = scrape_for_date(target_date)
    print(f"\nTOTAL RA-free bids for {target_date}: {len(bids)}")

    # Serialize metadata JSON
    json_str = json.dumps(bids, ensure_ascii=False, indent=2)

    date_str = target_date.strftime("%Y-%m-%d")
    meta_filename = f"gem_bids_{date_str}_no_ra_meta.json"

    # Save metadata into ./daily_data/
    meta_path = os.path.join(DAILY_DATA_DIR, meta_filename)
    with open(meta_path, "w", encoding="utf-8") as f:
        f.write(json_str)
    print(f"Saved metadata locally as {meta_path}")

    # Download + upload PDFs
    ensure_supabase_env()

    # ddmmyy token (e.g. 01-12-2025 -> 011225)
    date_token = target_date.strftime("%d%m%y")

    for bid in bids:
        bid_no = bid["bid_number"]
        detail_url = bid["detail_url"]

        # e.g. "GEM/2025/B/6950285" -> "B_6950285"
        parts = bid_no.split("/")
        if len(parts) >= 2:
            suffix = "_".join(parts[-2:])
        else:
            suffix = bid_no.replace("/", "_")

        # GeM_011225_B_6950285.pdf
        filename = f"GeM_{date_token}_{suffix}.pdf"
        # final path in bucket: bids/GeM_011225_B_6950285.pdf
        object_name = f"bids/{filename}"

        try:
            pdf_bytes = download_pdf(detail_url)
            upload_pdf_to_supabase(pdf_bytes, object_name)
        except Exception as e:
            print(f"  ERROR for {bid_no}: {e}")

    print("\nAll done.")


if __name__ == "__main__":
    main()
