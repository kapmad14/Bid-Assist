#!/usr/bin/env python3
import os
import re
import csv
import random
import requests
from pypdf import PdfReader

PDF_DIR = "tender-pdfs"
SAMPLE_SIZE = 20

PIN_CSV_URL = "https://drive.google.com/uc?export=download&id=15qbbFvxK1JHE2ZMSSDdxVoFJ7L5K5xLa"

PIN_AT_START = re.compile(r"^\s*(\d{6})\s*,")
PIN_AT_END   = re.compile(r"(?:-|–|\s)(\d{6})$")
PIN_REGEX    = re.compile(r"\b(\d{6})\b")

STAR_TRAIL_LOCATION = re.compile(r"\*{10,}\s*([A-Z][A-Z ]{2,})", re.I)
STOP_ROW = re.compile(r"Buyer\s*Added\s*Bid|Additional\s*Requirement|Disclaimer", re.I)


# ---------------- PIN DIRECTORY ---------------- #

def load_pin_map():
    print("Loading PIN reference data...")
    resp = requests.get(PIN_CSV_URL, timeout=30)
    resp.raise_for_status()

    pin_map = {}
    reader = csv.DictReader(resp.text.splitlines())
    for row in reader:
        pin = row.get("pincode", "").strip()
        if pin.isdigit():
            pin_map[pin] = row.get("district", "").strip().upper()
    print(f"Loaded {len(pin_map)} PIN records\n")
    return pin_map


# ---------------- PDF PARSING ---------------- #

def normalize(s):
    return re.sub(r"\s+", " ", s).strip()


def extract_address_block(text):
    rows, buf = [], []
    started = False

    for raw in text.splitlines():
        line = normalize(raw)

        # Stop when quantity column begins
        if started and re.fullmatch(r"\d{1,5}", line):
            break

        if STOP_ROW.search(line):
            break

        # **********CITY must be detected first
        m = STAR_TRAIL_LOCATION.search(line)
        if m:
            # Only accept masked city if no PIN already captured in this block
            if not any(PIN_REGEX.search(x) for x in buf):
                started = True
                if buf:
                    rows.append("\n".join(buf))
                    buf = []
                buf.append("**********" + m.group(1).strip())
            continue


        # PIN-based row starts
        if PIN_AT_START.match(line) or PIN_AT_END.search(line):
            started = True
            # If PIN appears, drop any earlier masked rows
            buf = [x for x in buf if not STAR_TRAIL_LOCATION.search(x)]
            if buf:
                rows.append("\n".join(buf))
                buf = []
            buf.append(line)

    if buf:
        rows.append("\n".join(buf))

    return rows[0] if rows else ""


def resolve_pin_and_district(block, pin_map):

    # 1️⃣ PIN always wins
    m = PIN_REGEX.search(block)
    if m:
        pin = m.group(1)
        return pin, pin_map.get(pin, "")

    # 2️⃣ Only then try **********CITY
    m = STAR_TRAIL_LOCATION.search(block)
    if m:
        candidate = m.group(1).strip().upper()

        # Reject directional garbage
        if re.fullmatch(r"(NORTH|SOUTH|EAST|WEST)(\s+AND.*)?", candidate):
            return "", ""

        return "", candidate

    return "", ""


def get_pin_and_district(pdf_path, pin_map):
    try:
        reader = PdfReader(pdf_path)
    except Exception:
        return "", ""

    text = ""
    for p in reader.pages:
        try:
            text += (p.extract_text() or "") + "\n"
        except Exception:
            pass

    block = extract_address_block(text)
    return resolve_pin_and_district(block, pin_map)


# ---------------- MAIN ---------------- #

def main():
    pin_map = load_pin_map()

    pdfs = sorted(f for f in os.listdir(PDF_DIR) if f.lower().endswith(".pdf"))

    print(f"\nProcessing {len(pdfs)} PDFs...\n")

    for f in pdfs:
        pin, district = get_pin_and_district(os.path.join(PDF_DIR, f), pin_map)
        print(f"{f:45} -> PIN: {pin or 'N/A':6}  DISTRICT: {district or 'N/A'}")

if __name__ == "__main__":
    main()
