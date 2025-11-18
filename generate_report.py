#!/usr/bin/env python3
"""
generate_report.py

Simple daily report for today (or date override) based on data/db/YYYY-MM-DD.db
Produces: totals, succeeded, failed, bids vs RA breakdown, and saves CSV summary.
"""
import sqlite3
import csv
import argparse
from pathlib import Path
from datetime import date

DATA_DIR = Path("data")
DB_DIR = DATA_DIR / "db"

def run_report(dbpath: Path, out_csv: Path = None):
    if not dbpath.exists():
        print("DB not found:", dbpath)
        return 1

    conn = sqlite3.connect(str(dbpath))
    cur = conn.cursor()

    # total rows (everything we stored)
    cur.execute("SELECT count(*) FROM tenders")
    total = cur.fetchone()[0] or 0

    # count successes (pdf_path not null/empty)
    cur.execute("SELECT count(*) FROM tenders WHERE pdf_path IS NOT NULL AND pdf_path != ''")
    succ = cur.fetchone()[0] or 0

    # count failures (last_fail_reason set) - some rows might be neither
    cur.execute("SELECT count(*) FROM tenders WHERE last_fail_reason IS NOT NULL AND last_fail_reason != ''")
    fail = cur.fetchone()[0] or 0

    # breakdown bids vs RA for successes
    cur.execute("SELECT gem_bid_id, pdf_path FROM tenders WHERE pdf_path IS NOT NULL AND pdf_path != ''")
    succ_rows = cur.fetchall()
    succ_bids = sum(1 for r in succ_rows if r[0] and "/B/" in r[0])
    succ_ra   = sum(1 for r in succ_rows if r[0] and "/R/" in r[0])

    # breakdown bids vs RA for failures
    cur.execute("SELECT gem_bid_id, last_fail_reason FROM tenders WHERE last_fail_reason IS NOT NULL AND last_fail_reason != ''")
    fail_rows = cur.fetchall()
    fail_bids = sum(1 for r in fail_rows if r[0] and "/B/" in r[0])
    fail_ra   = sum(1 for r in fail_rows if r[0] and "/R/" in r[0])

    print("Report for:", dbpath.name)
    print("Total rows in DB:      ", total)
    print("Total succeeded (pdf): ", succ, f"(bids {succ_bids}, RA {succ_ra})")
    print("Total failed:          ", fail, f"(bids {fail_bids}, RA {fail_ra})")
    print("Neither succ nor fail: ", total - succ - fail)

    # optionally write CSV summary
    if out_csv:
        with open(out_csv, "w", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(["db","total","succeeded","succ_bids","succ_ra","failed","fail_bids","fail_ra","neither"])
            writer.writerow([dbpath.name, total, succ, succ_bids, succ_ra, fail, fail_bids, fail_ra, total - succ - fail])
        print("Saved CSV summary to", out_csv)

    conn.close()
    return 0

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYY-MM-DD (default: today)", default=date.today().isoformat())
    ap.add_argument("--csv", help="Write CSV summary to path", default=None)
    args = ap.parse_args()
    dbfile = DB_DIR / f"{args.date}.db"
    out_csv = Path(args.csv) if args.csv else None
    raise SystemExit(run_report(dbfile, out_csv))
