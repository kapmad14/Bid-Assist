#!/usr/bin/env python3
"""
CPWD Scraper – Manual Takeover Mode (Popup 1 Only)

✅ User manually loads Tender Listing + selects Show=100
✅ Script scrapes Page 1–2
✅ Opens View Tender Details popup
✅ Extracts complete fields from popup
✅ Saves JSONL incrementally (crash-safe)

Output:
results/cpwd_results_<date>.jsonl
"""

import json
import os
from datetime import datetime
from playwright.sync_api import sync_playwright
import re
from datetime import datetime, timezone

# ---------------- CONFIG ----------------

RESULTS_DIR = os.path.join("gem-scraper", "results", "cpwd_results")
os.makedirs(RESULTS_DIR, exist_ok=True)

SCRAPED_ON = str(datetime.today().date())

OUT_FILE = os.path.join(
    RESULTS_DIR,
    f"cpwd_results_{SCRAPED_ON}.jsonl"
)

# ---------------- HELPERS ----------------


def append_record(record):
    """Write one tender record immediately (crash-safe)."""
    with open(OUT_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def extract_field(page, label):
    """
    Extract value next to an EXACT label cell.

    Fixes issues like:
    "email": "Email"
    """
    # ✅ Try exact match first
    loc = page.locator(
        f"xpath=//td[normalize-space()='{label}']/following-sibling::td[1]"
    )

    # ✅ If not found, try partial match
    if loc.count() == 0:
        loc = page.locator(
            f"xpath=//td[contains(normalize-space(),'{label}')]/following-sibling::td[1]"
        )
    return loc.first.inner_text().strip() if loc.count() else None



def extract_section_table(page, section_title):
    """
    Extract tables like:
    Mandatory Documents (3 cols)
    Eligibility Documents (3 cols)
    Covers (multiple cols)

    Covers gets special structured handling.
    """

    results = []

    try:
        heading = page.locator(f"text={section_title}").first
        table = heading.locator("xpath=following::table[1]")

        rows = table.locator("tr").all()[1:]  # skip header row

        # ✅ Special handling for Covers table
        if section_title.lower() == "covers":

            for r in rows:

                # ✅ Covers rows sometimes have td, sometimes th
                cols = r.locator("td").all()
                if len(cols) == 0:
                    cols = r.locator("th").all()

                # ✅ Still empty → skip
                if len(cols) < 4:
                    continue

                # ✅ Skip header garbage rows
                first_cell = cols[0].inner_text().strip()
                if not first_cell.isdigit():
                    continue

                results.append({
                    "cover_no": cols[0].inner_text().strip(),
                    "cover_name": cols[1].inner_text().strip(),
                    "opening_datetime": to_pg_utc(cols[2].inner_text().strip()),
                    "opened_datetime": to_pg_utc(cols[3].inner_text().strip()),
                })

            return results

        # ✅ Normal 3-column document tables
        for r in rows:
            cols = r.locator("td").all()
            if len(cols) >= 3:
                results.append({
                    "sr_no": cols[0].inner_text().strip(),
                    "document_name": cols[1].inner_text().strip(),
                    "document_type": cols[2].inner_text().strip()
                })

    except Exception as e:
        print("Table extract failed:", section_title, e)

    return results


def extract_authority_email(page):
    """
    Extract Authority Email correctly.

    CPWD popup has two "Email" occurrences:
    1. Receipt of Queries through -> Email (not actual email)
    2. Tender Inviting Authority Email -> real email address

    Rule:
    ✅ Pick the Email value that appears AFTER the Address field.
    """

    loc = page.locator(
        "xpath=//td[normalize-space()='Address']"
        "/following::td[normalize-space()='Email'][1]"
        "/following-sibling::td[1]"
    )

    if loc.count():
        val = loc.first.inner_text().strip()
        if val and "@" in val:
            return val

    return None

def clean_amount(val):
    """
    Convert:
    ₹ 5,68,152 ( Five Lakh...) → 568152
    """
    if not val:
        return None

    m = re.search(r"₹\s*([\d,]+)", val)
    if m:
        return int(m.group(1).replace(",", ""))

    return None

def clean_datetime(val):
    """
    Convert:
    '15/04/2026 18:37 After Technical...' → '15/04/2026 18:37'
    """
    if not val:
        return None

    # keep only first date + time pattern
    parts = val.strip().split()
    if len(parts) >= 2:
        return f"{parts[0]} {parts[1]}"

    return val.strip()


def to_pg_utc(val):
    """
    Convert CPWD datetime:

    '30/01/2026 16:59'
        → '2026-01-30 16:59:00+00'

    Returns None if invalid.
    """

    if not val:
        return None

    try:
        dt = datetime.strptime(val.strip(), "%d/%m/%Y %H:%M")

        # Force UTC timezone
        dt = dt.replace(tzinfo=timezone.utc)

        # Postgres timestamp format
        return dt.strftime("%Y-%m-%d %H:%M:%S+00")

    except:
        return val  # fallback

def navigate_next_cpwd(page):
    """
    CPWD pagination is unstable. This helper tries multiple selectors.
    Returns True if clicked, False if no next page found.
    """

    selectors = [
        "a:has-text('Next')",
        "a:has-text('NEXT')",
        "a:has-text('>')",
        "a:has-text('›')",
        "li:has-text('Next') a",
        "a[aria-label='Next']",
    ]

    for sel in selectors:
        loc = page.locator(sel)

        if loc.count() > 0:
            try:
                print(f"✅ Clicking Next using selector: {sel}")
                loc.first.scroll_into_view_if_needed()
                loc.first.click(force=True, timeout=5000)
                page.wait_for_timeout(3000)
                return True
            except Exception as e:
                print("❌ Next click failed:", sel, e)

    # ✅ Fallback: Click page number 2 directly
    page2 = page.locator("a:has-text('2')")
    if page2.count() > 0:
        try:
            print("✅ Clicking Page 2 directly")
            page2.first.click(force=True, timeout=5000)
            page.wait_for_timeout(3000)
            return True
        except Exception as e:
            print("❌ Page 2 click failed", e)

    print("🚫 No pagination button found.")
    return False

# ---------------- POPUP SCRAPER ----------------


def scrape_popup1(detail_page):
    """Scrape full Tender Details popup."""

    detail_page.wait_for_selector("text=Tender ID", timeout=15000)

    data = {
        # Core Tender Info
        "tender_id": extract_field(detail_page, "Tender ID"),
        "nit_no": extract_field(detail_page, "NIT/RFP NO"),
        "name_of_work": extract_field(detail_page, "Name of Work"),

        "tender_type": extract_field(detail_page, "Tender Type"),
        "procurement_type": extract_field(detail_page, "Procurement Type"),
        "bid_type": extract_field(detail_page, "Bid Type"),

        "estimated_cost": clean_amount(extract_field(detail_page, "Estimated Cost")),
        "time_allowed": extract_field(detail_page, "Time Allowed"),

        "type_of_work": extract_field(detail_page, "Type of Work"),
        "category_of_tendered": extract_field(detail_page, "Category of Tendered"),
        "competitive_bidding_type": extract_field(detail_page, "Competitive Bidding Type"),
        "no_of_stages": extract_field(detail_page, "No of Stages"),

        # Dates Section
        "publishing_datetime": to_pg_utc(
            clean_datetime(extract_field(detail_page, "Tender Publishing Date"))
        ),
        "prebid_deadline": to_pg_utc(
            clean_datetime(extract_field(detail_page, "Pre-Bid Queries"))
        ),
        "closing_datetime": to_pg_utc(
            clean_datetime(extract_field(detail_page, "Bid Submission Closing Date"))
        ),
        "bid_validity_days": extract_field(detail_page, "Bid Validity Period"),
        "bid_validity_expiry": to_pg_utc(
            clean_datetime(extract_field(detail_page, "Bid Validity Expiry Date"))
        ),
        "tender_notice_type": extract_field(detail_page, "Tender Notice Type"),

        # Authority Details
        "office_inviting_bids": extract_field(detail_page, "Office Inviting Bids"),
        "designation": extract_field(detail_page, "Designation"),
        "address": extract_field(detail_page, "Address"),
        "phone": extract_field(detail_page, "Contact Details"),
        "email": extract_authority_email(detail_page),

        # EMD Block
        "emd_amount": clean_amount(extract_field(detail_page, "EMD (INR)")),
        "emd_in_favour_of": extract_field(detail_page, "EMD In Favour Of"),
        "emd_mode": extract_field(detail_page, "Mode of Payment"),

        # Tables
        "mandatory_documents": extract_section_table(detail_page, "Mandatory Documents"),
        "eligibility_documents": extract_section_table(detail_page, "Eligibility Documents Details"),
        "covers": extract_section_table(detail_page, "Covers"),
    }

    return data

def get_first_real_tender_id(page):
    rows = page.locator("table tbody tr")

    for i in range(rows.count()):
        try:
            val = rows.nth(i).locator("td").nth(0).inner_text().strip()
            if val.isdigit():   # ✅ tender id row
                return val
        except:
            continue

    return None


# ---------------- MAIN ----------------


def main():
    global MAX_PAGES

    # ✅ Ask user first
    MAX_PAGES = int(input("\nEnter Max Pages to Scrape: "))

    tenders = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=150)
        page = browser.new_page()

        print("\n🔴 MANUAL STEP REQUIRED 🔴")
        print("1. Navigate to Tender Listing page")
        print("2. Set Show Records = 100")
        print("3. Ensure tender rows are visible\n")

        page.goto("https://etender.cpwd.gov.in/")

        input("✅ Press ENTER once ready on TenderDetailsHome (Show=100)...")

        print("✅ Waiting for table to stabilize...")
        page.wait_for_selector("table tbody tr td", timeout=60000)
        page.wait_for_timeout(3000)

        # ✅ Scrape Page 1 and Page 2
        for page_no in range(1, MAX_PAGES + 1):

            print(f"\n✅ Scraping Page {page_no}")

            rows = page.locator("table tbody tr")
            total = rows.count()
            print("Rows found:", total)

            # ---------------------------------------------------
            # ✅ Tender scraping loop (ONLY tenders here)
            # ---------------------------------------------------
            for i in range(total):

                row = rows.nth(i)
                cols = row.locator("td")

                # Skip incomplete rows
                if cols.count() < 10:
                    continue

                # Tender ID must be numeric
                tender_id = cols.nth(0).text_content(timeout=2000)
                if not tender_id:
                    continue

                tender_id = tender_id.strip()
                if not tender_id.isdigit():
                    continue

                # Ensure action link exists
                action_links = cols.nth(9).locator("a")
                if action_links.count() == 0:
                    continue

                nit_no = cols.nth(1).text_content(timeout=2000).strip()
                title = cols.nth(2).text_content(timeout=2000).strip()
                status = cols.nth(8).text_content(timeout=2000).strip()

                print("  → Tender:", tender_id)

                # ✅ Open popup
                detail_link = action_links.first

                try:
                    with page.expect_popup(timeout=10000) as popup_info:
                        detail_link.click(force=True, timeout=5000)

                    detail_page = popup_info.value

                    # ✅ Scrape popup details
                    details = scrape_popup1(detail_page)
                    detail_page.close()

                    # ✅ Cooldown between popups
                    page.wait_for_timeout(400)

                except Exception as e:
                    print("❌ Popup failed:", tender_id, e)
                    continue

                # ✅ Build record
                record = {
                    "source": "cpwd",
                    "scraped_on": SCRAPED_ON,
                    "listing": {
                        "tender_id": tender_id,
                        "nit_no": nit_no,
                        "title": title,
                        "status": status
                    },
                    "details": details
                }

                # ✅ Save immediately (crash-safe)
                append_record(record)
                tenders.append(record)

                print(f"✅ Saved tender {len(tenders)}")

            # ---------------------------------------------------
            # ✅ Pagination happens AFTER all tenders on page scraped
            # ---------------------------------------------------
            if page_no < MAX_PAGES:

                print(f"\n✅ Finished Page {page_no}. Moving to Page {page_no + 1}...")

                # ✅ Capture first REAL Tender ID before clicking Next
                first_before = get_first_real_tender_id(page)

                print("First Tender Before:", first_before)

                if not first_before:
                    print("❌ Could not detect tender ID before pagination. Stopping.")
                    break

                # ✅ Click Next safely (max 2 attempts)
                success = False

                for attempt in range(1, 3):

                    print(f"🔁 Pagination Attempt {attempt}/2")

                    clicked = navigate_next_cpwd(page)

                    if not clicked:
                        print("❌ Next button not found. Stopping pagination.")
                        break

                    # ✅ Wait for AJAX refresh
                    try:
                        page.wait_for_load_state("networkidle", timeout=15000)
                    except:
                        pass

                    page.wait_for_timeout(2000)

                    # ✅ Capture first REAL Tender ID after click
                    first_after = get_first_real_tender_id(page)

                    print("First Tender After :", first_after)

                    # ✅ Confirm page changed
                    if first_after and first_after != first_before:
                        print(f"✅ Page {page_no + 1} loaded successfully!")
                        success = True
                        break

                    print("⚠️ Page did not refresh properly, retrying...\n")

                # ✅ Stop scraper if pagination failed
                if not success:
                    print("❌ Pagination failed. Stopping early.")
                    break


        browser.close()

    print("\n✅ Finished Scraping")
    print("✅ Total tenders saved:", len(tenders))
    print("✅ Records stored in:", OUT_FILE)

if __name__ == "__main__":
    main()
