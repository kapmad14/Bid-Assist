import json, re, requests
from pathlib import Path
from bs4 import BeautifulSoup

INPUT_FILE = "gem_results_pilot_first25.json"
OUT_FILE   = "gem_results_batch_output.txt"

HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept-Language": "en-US,en;q=0.9"
}

# ---------- helpers ---------- #

def clean(text):
    return re.sub(r"\s+", " ", text.strip()) if text else None


def get_value(soup, label):
    node = soup.find(string=lambda x: x and label.lower() in x.lower())
    if not node:
        return None

    parent = node.parent
    texts = list(parent.stripped_strings)
    for i, t in enumerate(texts):
        if label.lower() in t.lower() and i + 1 < len(texts):
            val = texts[i + 1]
            if val and len(val) < 120:
                return clean(val)

    nxt = node.find_next(string=True)
    if nxt and label.lower() not in nxt.lower():
        return clean(nxt)

    return None


# ---------- TECHNICAL EVALUATION EXTRACTION (NEW) ---------- #

def find_technical_table(soup):
    header = soup.find(string=lambda x: x and "TECHNICAL EVALUATION" in x.upper())
    if not header:
        return None

    # The technical table is the NEXT table AFTER this header
    table = header.find_parent().find_next("table")
    return table


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

        # Status is ALWAYS the last column
        status = clean(tds[-1].get_text(" "))

        # Count ONLY explicit "Qualified"
        if status and re.search(r"\bqualified\b", status, re.I):
            qualified += 1

    return participated, qualified


# ---------- FINANCIAL EVALUATION ---------- #

def find_financial_table(soup):
    header = soup.find(string=lambda x: x and "FINANCIAL EVALUATION" in x.upper())
    if not header:
        return None
    return header.find_parent().find_next("table")


def extract_financial_rows(soup):
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

        # ---- CLEAN SELLER NAME ----
        seller = re.sub(r"\s*\(.*?\)", "", cols[1])
        seller = re.sub(r"\bUnder\s+PMA\b", "", seller, flags=re.I).strip()

        # ---- CLEAN ITEM ----
        item = cols[2]
        item = re.sub(r"^Item Categories\s*:\s*", "", item, flags=re.I).strip()

        # ---- CLEAN PRICE (INTEGER ONLY) ----
        price_raw = re.sub(r"[^\d.]", "", cols[3])
        price = price_raw.split(".")[0] if price_raw else ""

        rows.append(f"{seller} | {item} | {price} | {rank}")

    return rows


# ---------- RA extraction (financial only) ---------- #

def extract_ra(url):
    soup = BeautifulSoup(requests.get(url, headers=HEADERS, timeout=30).text, "lxml")

    meta = {
        "ra_number": get_value(soup, "RA Number"),
        "quantity": get_value(soup, "Quantity"),
        "ra_validity": get_value(soup, "RA Validity"),
        "start_datetime": get_value(soup, "RA Start Date"),
        "end_datetime": get_value(soup, "RA End Date"),
        "buyer_address": get_value(soup, "Address"),
        "ministry": get_value(soup, "Ministry"),
        "department": get_value(soup, "Department"),
        "organisation": get_value(soup, "Organisation"),
    }

    return meta, extract_financial_rows(soup)


# ---------- BID extraction (tech + financial) ---------- #

def extract_bid(url):
    soup = BeautifulSoup(requests.get(url, headers=HEADERS, timeout=30).text, "lxml")

    meta = {
        "bid_number": get_value(soup, "Bid Number"),
        "quantity": get_value(soup, "Quantity"),
        "bid_validity": get_value(soup, "Bid Validity"),
        "buyer_address": get_value(soup, "Address"),
        "ministry": get_value(soup, "Ministry"),
        "department": get_value(soup, "Department"),
        "organisation": get_value(soup, "Organisation"),
    }

    tech_participated, tech_qualified = extract_technical_counts(soup)

    return meta, extract_financial_rows(soup), tech_participated, tech_qualified


# ---------- batch runner ---------- #

records = json.loads(Path(INPUT_FILE).read_text())
out = []

for rec in records:

    # ---- ALWAYS GET TECHNICAL FROM BID PAGE ----
    bid_meta, bid_financial, tech_participated, tech_qualified = \
        extract_bid(rec["bid_result_url"])

    if "ra_result_url" in rec:
        out.append(f"\n================ RA {rec['ra_number']} =================")
        out.append(f"BID : {rec['bid_number']}")
        out.append(f"RA  : {rec['ra_number']}")

        ra_meta, ra_rows = extract_ra(rec["ra_result_url"])

        meta = ra_meta
        rows = ra_rows

    else:
        out.append(f"\n================ BID {rec['bid_number']} =================")
        out.append(f"BID : {rec['bid_number']}")

        meta = bid_meta
        rows = bid_financial

    # ---- OUTPUT META ----
    out.append("\nMETA DATA")
    for k,v in meta.items():
        out.append(f"{k:15} : {v}")

    # ---- NEW: TECHNICAL SUMMARY ----
    out.append("\nTECHNICAL EVALUATION")
    out.append(f"participated : {tech_participated}")
    out.append(f"qualified    : {tech_qualified}")

    # ---- FINANCIAL RESULTS ----
    out.append("\nFINANCIAL EVALUATION")
    out.extend(rows or ["No financial evaluation found."])


Path(OUT_FILE).write_text("\n".join(out), encoding="utf-8")
print("Saved:", OUT_FILE)
