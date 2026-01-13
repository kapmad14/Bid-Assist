#!/usr/bin/env python3
"""
GeM Result Page Harvester – FINAL STABLE VERSION
-----------------------------------------------
Input  : gem_results_pilot_first25.json
Output : gem_results_harvested.json

Safely opens each result page and extracts seller tables
from the correct accordion panel only.
"""

import json, time, re
from pathlib import Path
from playwright.sync_api import sync_playwright

INPUT_FILE  = "gem_results_pilot_first25.json"
OUTPUT_FILE = "gem_results_harvested.json"


def expand_section(page, title):
    headers = page.locator("div.card-header")

    for i in range(headers.count()):
        h = headers.nth(i)
        try:
            txt = h.inner_text().upper()
        except:
            continue

        if title.upper() in txt:
            body = h.locator("xpath=following-sibling::div[contains(@class,'card-body')]").first

            # already open → do nothing
            if body.is_visible():
                return body

            # closed → open
            h.scroll_into_view_if_needed()
            h.click(force=True)
            page.wait_for_timeout(1200)

            if body.is_visible():
                return body

            return None
    return None

def open_financial_accordion(page):
    headers = page.locator("div.card-header")

    for i in range(headers.count()):
        h = headers.nth(i)

        try:
            label = h.inner_text().strip().upper()
        except:
            continue

        if "FINANCIAL EVALUATION" not in label:
            continue

        # The real toggle is the caret icon, not the text
        caret = h.locator("i.fa-chevron-down, i.fa-chevron-up, span.fa")

        if caret.count() == 0:
            print("⚠️  Caret not found in header")
            return False

        caret.first.scroll_into_view_if_needed()
        caret.first.click(force=True)

        page.wait_for_timeout(2500)
        return True

    print("⚠️  FINANCIAL EVALUATION header not found")
    return False


def harvest_result_page(ctx, url):
    page = ctx.new_page()
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(4000)

    # 🔹 OPEN FINANCIAL ACCORDION BY UI
    triggers = page.locator(
        "a:has-text('FINANCIAL EVALUATION'), a:has-text('Evaluation')"
    )

    if triggers.count():
        triggers.first.scroll_into_view_if_needed()
        triggers.first.click(force=True)
        page.wait_for_timeout(4000)

    html = page.content()
    page.close()

    # 🔹 FIND EMBEDDED JSON PAYLOAD
    patterns = [
        r"financialEvaluationData\s*=\s*(\{.*?\});",
        r"singlePacketEvaluationData\s*=\s*(\{.*?\});",
        r"financialEvaluation\s*=\s*(\{.*?\});",
        r"sellerList\s*=\s*(\{.*?\});"
    ]

    payload = None
    for pat in patterns:
        m = re.search(pat, html, re.S)
        if m:
            try:
                payload = json.loads(m.group(1))
                break
            except:
                continue

    if not payload:
        return {"financial_evaluation": []}

    sellers = payload.get("sellerList") or payload.get("financialEvaluation") or []

    rows = []
    for s in sellers:
        rows.append([
            s.get("srNo") or "",
            s.get("sellerName") or "",
            s.get("itemDesc") or "",
            s.get("totalPrice") or "",
            s.get("rank") or "",
        ])

    return {"financial_evaluation": rows}

def main():
    input_data = json.loads(Path(INPUT_FILE).read_text())

    harvested = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context()

        for i, rec in enumerate(input_data, 1):
            print(f"\n[{i}/{len(input_data)}] Harvesting {rec['bid_number']}")

            # Rule: RA takes precedence
            if "ra_result_url" in rec:
                print(f"    ↳ Using RA {rec['ra_number']}")
                final_url = rec["ra_result_url"]
            else:
                final_url = rec["bid_result_url"]

            rec["final_results"] = harvest_result_page(ctx, final_url)
            harvested.append(rec)


        browser.close()

    Path(OUTPUT_FILE).write_text(json.dumps(harvested, indent=2))
    print(f"\n✅ Saved {len(harvested)} records → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
