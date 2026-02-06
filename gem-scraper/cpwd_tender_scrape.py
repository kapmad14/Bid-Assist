#!/usr/bin/env python3
"""
CPWD Scraper – Active / New Tenders Within One Day/Week

✅ Manual Takeover Mode
✅ Scrapes listing rows
✅ Opens Tender Details popup
✅ Extracts ALL fields + tables (Covers, Mandatory Docs, Eligibility Docs)
✅ Deduplication enforced
✅ Pagination supported
✅ Crash-safe JSONL

Target:
User manually navigates from:
https://etender.cpwd.gov.in/
→ New Tenders Within One Day/Week
"""

import json
import os
import re
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright
import subprocess

# ---------------- CONFIG ----------------

RESULTS_DIR = os.path.join("gem-scraper", "results", "cpwd_active")
os.makedirs(RESULTS_DIR, exist_ok=True)

SCRAPED_ON = str(datetime.today().date())

OUT_FILE = os.path.join(
    RESULTS_DIR,
    f"cpwd_active_{SCRAPED_ON}.jsonl"
)

# ✅ Tender Document Downloads
DOWNLOAD_DIR = os.path.join("gem-scraper", "downloads", "cpwd_docs")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# ✅ Must remain homepage (manual navigation)
TARGET_URL = "https://etender.cpwd.gov.in/"


# ---------------- HELPERS ----------------

def append_record(record):
    """Write one tender record immediately (crash-safe)."""
    with open(OUT_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def extract_field(page, label):
    """Extract value next to label cell."""

    loc = page.locator(
        f"xpath=//td[normalize-space()='{label}']/following-sibling::td[1]"
    )

    if loc.count() == 0:
        loc = page.locator(
            f"xpath=//td[contains(normalize-space(),'{label}')]/following-sibling::td[1]"
        )

    return loc.first.inner_text().strip() if loc.count() else None


def extract_authority_email(page):
    """Authority Email appears after Address field."""

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
    """Convert ₹ 5,68,152 → 568152"""
    if not val:
        return None

    m = re.search(r"₹\s*([\d,]+)", val)
    return int(m.group(1).replace(",", "")) if m else None


def clean_datetime(val):
    """Extract only DD/MM/YYYY HH:MM"""
    if not val:
        return None

    parts = val.strip().split()
    return f"{parts[0]} {parts[1]}" if len(parts) >= 2 else val.strip()


def to_pg_utc(val):
    """Convert CPWD datetime → Postgres UTC string"""
    if not val:
        return None

    try:
        dt = datetime.strptime(val.strip(), "%d/%m/%Y %H:%M")
        dt = dt.replace(tzinfo=timezone.utc)
        return dt.strftime("%Y-%m-%d %H:%M:%S+00")
    except:
        return val

# ---------------- PDF COMPRESSION ----------------

def compress_pdf(input_path):
    """
    Compress PDF using Ghostscript (good readability).
    Returns compressed file path if successful, else original.
    """

    compressed_path = input_path.replace(".pdf", "_compressed.pdf")

    command = [
        "gs",
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        "-dPDFSETTINGS=/ebook",  # ✅ Best balance
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        f"-sOutputFile={compressed_path}",
        input_path
    ]

    try:
        subprocess.run(command, check=True)

        # ✅ Replace original file with compressed version
        os.remove(input_path)
        os.rename(compressed_path, input_path)

        return input_path

    except Exception as e:
        print("⚠️ Compression failed:", e)

        # Cleanup leftover compressed file
        if os.path.exists(compressed_path):
            os.remove(compressed_path)

        return input_path


# ---------------- TABLE EXTRACTION ----------------

def extract_section_table(page, section_title):
    """
    Extract popup document tables:
    - Mandatory Documents
    - Eligibility Documents Details
    - Covers (special structured format)
    """

    results = []

    try:
        heading = page.locator(f"text={section_title}").first
        table = heading.locator("xpath=following::table[1]")

        rows = table.locator("tr").all()[1:]  # skip header row

        # ✅ Covers special handling
        if section_title.lower() == "covers":

            for r in rows:
                cols = r.locator("td").all()
                if len(cols) == 0:
                    cols = r.locator("th").all()

                if len(cols) < 4:
                    continue

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

        # ✅ Standard 3-column document tables
        for r in rows:
            cols = r.locator("td").all()
            if len(cols) >= 3:
                results.append({
                    "sr_no": cols[0].inner_text().strip(),
                    "document_name": cols[1].inner_text().strip(),
                    "document_type": cols[2].inner_text().strip()
                })

    except Exception as e:
        print("⚠️ Table extract failed:", section_title, e)

    return results


# ---------------- PAGINATION HELPERS ----------------

def get_first_real_tender_id(page):
    """Used to confirm page refresh after clicking Next."""
    rows = page.locator("table tbody tr")

    for i in range(rows.count()):
        try:
            val = rows.nth(i).locator("td").nth(0).inner_text().strip()
            if val.isdigit():
                return val
        except:
            continue

    return None


def navigate_next_cpwd(page):
    """Try clicking Next page safely."""

    selectors = [
        "a:has-text('Next')",
        "a:has-text('NEXT')",
        "a:has-text('>')",
        "li:has-text('Next') a",
        "a[aria-label='Next']",
    ]

    for sel in selectors:
        loc = page.locator(sel)

        if loc.count() > 0:
            try:
                print(f"✅ Clicking Next using: {sel}")
                loc.first.scroll_into_view_if_needed()
                loc.first.click(force=True, timeout=5000)
                page.wait_for_timeout(2500)
                return True
            except:
                continue

    print("🚫 Next pagination button not found.")
    return False


# ---------------- POPUP SCRAPER ----------------

def scrape_popup1(detail_page):
    """Full Tender Details popup scraper (feature parity)."""

    detail_page.wait_for_selector("text=Tender ID", timeout=15000)

    return {
        # Core Tender Info
        "subwork_packages": extract_field(detail_page, "Subwork/Packages"),

        "tender_type": extract_field(detail_page, "Tender Type"),
        "procurement_type": extract_field(detail_page, "Procurement Type"),
        "bid_type": extract_field(detail_page, "Bid Type"),

        # Cost & Duration
        "estimated_cost": clean_amount(extract_field(detail_page, "Estimated Cost")),
        "time_allowed": extract_field(detail_page, "Time Allowed"),

        # Classification
        "type_of_work": extract_field(detail_page, "Type of Work"),
        "category_of_tendered": extract_field(detail_page, "Category of Tendered"),
        "competitive_bidding_type": extract_field(detail_page, "Competitive Bidding Type"),
        "no_of_stages": extract_field(detail_page, "No of Stages"),

        # Dates
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

        # Authority
        "office_inviting_bids": extract_field(detail_page, "Office Inviting Bids"),
        "designation": extract_field(detail_page, "Designation"),
        "address": extract_field(detail_page, "Address"),
        "phone": extract_field(detail_page, "Contact Details"),
        "email": extract_authority_email(detail_page),

        # EMD Block
        "emd_amount": clean_amount(extract_field(detail_page, "EMD (INR)")),
        "emd_in_favour_of": extract_field(detail_page, "EMD In Favour Of"),
        "emd_mode": extract_field(detail_page, "Mode of Payment"),

        # Tables (JSONB)
        "mandatory_documents": extract_section_table(detail_page, "Mandatory Documents"),
        "eligibility_documents": extract_section_table(detail_page, "Eligibility Documents Details"),
        "covers": extract_section_table(detail_page, "Covers"),
    }


def download_tender_documents(detail_page, tender_id):

    docs = []

    # ✅ Popup stabilizes quickly
    detail_page.wait_for_timeout(2000)

    # ✅ Link inside the Tender Details popup
    doc_link = detail_page.locator("a:has-text('Tender Document')")

    if doc_link.count() == 0:
        print("     ⚠️ Tender Documents link not found for:", tender_id)
        total_mb = round(sum(d["file_size_mb"] for d in docs), 2)
        print(f"     ✅ Total compressed tender docs size: {total_mb} MB")
        return docs

    print("     📄 Clicking Tender Documents (same popup)...")

    # ✅ CLICK happens inside same popup (no popup expected)
    doc_link.first.click(force=True)

    # ✅ Now popup navigates into documents page
    detail_page.wait_for_selector("table tbody tr a", timeout=10000)

    file_links = detail_page.locator("table tbody tr a")

    for i in range(file_links.count()):

        link = file_links.nth(i)
        filename = link.inner_text().strip()

        if not filename.lower().endswith(".pdf"):
            continue

        # ✅ Keep original filename + tender_id
        safe_filename = filename.replace("/", "_").replace("\\", "_")

        save_name = f"{tender_id}_{safe_filename}"

        save_path = os.path.join(DOWNLOAD_DIR, save_name)

        print(f"        ⬇ Downloading: {save_name}")

        try:
            with detail_page.expect_download(timeout=10000) as download_info:
                link.click(force=True)

                download = download_info.value
                download.save_as(save_path)

                # ✅ Compress downloaded PDF (overwrites original)
                final_path = compress_pdf(save_path)

                file_size_mb = round(os.path.getsize(final_path) / (1024 * 1024), 2)


                docs.append({
                    "original_file": filename,
                    "saved_file": save_name,
                    "saved_path": final_path
                })


        except Exception as e:
            print("        ❌ Download failed:", filename, e)

    return docs

# ---------------- MAIN ----------------

def main():

    MAX_PAGES = int(input("\nEnter Max Pages to Scrape: "))

    saved_count = 0
    seen_ids = set()

    with sync_playwright() as p:

        browser = p.chromium.launch(headless=False, slow_mo=150)

        context = browser.new_context(accept_downloads=True)

        page = context.new_page()

        print("\n🔴 MANUAL STEP REQUIRED 🔴")
        print("1. Open CPWD homepage")
        print("2. Navigate to: New Tenders Within One Day/Week")
        print("3. Set Show Records = 100")
        print("4. Ensure tender rows visible\n")

        page.goto(TARGET_URL)

        input("✅ Press ENTER once ready (Show=100)...")

        print("✅ Waiting for tender table...")

        page.wait_for_selector(
            "table tbody tr",
            timeout=60000,
            state="attached"
        )

        # ---------------- SCRAPE LOOP ----------------

        for page_no in range(1, MAX_PAGES + 1):

            print(f"\n✅ Scraping Page {page_no}")

            rows = page.locator("table tbody tr")
            total = rows.count()

            for i in range(total):

                cols = rows.nth(i).locator("td")
                if cols.count() < 9:
                    continue

                tender_id = cols.nth(0).text_content()
                if not tender_id:
                    continue

                tender_id = tender_id.strip()
                if not tender_id.isdigit():
                    continue

                # ✅ Dedup enforcement
                if tender_id in seen_ids:
                    continue
                seen_ids.add(tender_id)

                nit_no = cols.nth(1).text_content().strip()
                title = cols.nth(2).text_content().strip()

                # ✅ Action column index = 8
                action_links = cols.nth(8).locator("a")
                if action_links.count() == 0:
                    continue

                print("  → Tender:", tender_id)

                try:
                    with page.expect_popup(timeout=10000) as popup_info:
                        action_links.first.click(force=True)

                    detail_page = popup_info.value

                    # ✅ Scrape popup info
                    details = scrape_popup1(detail_page)

                    # ✅ Download Tender Documents (inside same popup)
                    tender_docs = download_tender_documents(detail_page, tender_id)

                    # ✅ Close popup after finishing EVERYTHING
                    detail_page.close()

                    # ✅ Cooldown so CPWD doesn't break for next tender
                    page.wait_for_timeout(500)

                except Exception as e:
                    print("❌ Popup failed:", tender_id, e)
                    continue

                record = {
                    "source": "cpwd",
                    "scraped_on": SCRAPED_ON,
                    "listing": {
                        "tender_id": tender_id,
                        "nit_no": nit_no,
                        "title": title,
                        "status": None,
                        "document_count": len(tender_docs)
                    },
                    "details": details,
                    "tender_documents": tender_docs
                }

                append_record(record)
                saved_count += 1

                print("✅ Saved", saved_count)


            # ---------------- PAGINATION ----------------
            if page_no < MAX_PAGES:

                first_before = get_first_real_tender_id(page)

                print(f"\n➡️ Moving to Page {page_no + 1}...")

                clicked = navigate_next_cpwd(page)
                if not clicked:
                    break

                page.wait_for_timeout(3000)

                first_after = get_first_real_tender_id(page)

                if not first_after or first_after == first_before:
                    print("❌ Page did not refresh properly. Stopping.")
                    break

        browser.close()

    print("\n✅ Finished Scraping")
    print("✅ Total tenders saved:", saved_count)
    print("✅ Output:", OUT_FILE)


if __name__ == "__main__":
    main()
