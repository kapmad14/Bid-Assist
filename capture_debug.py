#!/usr/bin/env python3
"""
capture_debug.py

Run: python capture_debug.py --page 1 --headful

Creates: data/listings/debug_page_<N>.json and supporting snapshots.
"""
import argparse, json, time, traceback
from pathlib import Path
from urllib.parse import urljoin
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

BASE = "https://bidplus.gem.gov.in"
LISTING_PATH = "/all-bids"
API_PATH_SUBSTR = "/all-bids-data"
DATA_DIR = Path("data")
LISTINGS_DIR = DATA_DIR / "listings"
USER_AGENT = "GeM-Debug/0.1 (+you@example.com)"
DATA_DIR.mkdir(exist_ok=True)
LISTINGS_DIR.mkdir(parents=True, exist_ok=True)

def run_debug(page_num=1, headful=False, wait_after_click=3.0, capture_timeout=12):
    out = {
        "page_num": page_num,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "nav": {},
        "requests": [],
        "responses": [],
        "cookies": None,
        "localStorage": None,
        "html_snapshot": None
    }
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headful)
        ctx = browser.new_context(user_agent=USER_AGENT)
        page = ctx.new_page()

        # handlers
        def on_request(req):
            try:
                if API_PATH_SUBSTR in req.url:
                    rd = {
                        "url": req.url,
                        "method": req.method,
                        "headers": dict(req.headers),
                        "post_data": None
                    }
                    try:
                        pd = req.post_data
                        rd["post_data"] = pd
                    except Exception:
                        rd["post_data"] = None
                    rd["ts"] = datetime.now(timezone.utc).isoformat()
                    out["requests"].append(rd)
                    print("REQ:", rd["method"], rd["url"], "len_post=", (len(rd["post_data"]) if rd["post_data"] else 0))
            except Exception:
                print("on_request err", traceback.format_exc())

        def on_response(resp):
            try:
                if API_PATH_SUBSTR in resp.url:
                    r = {
                        "url": resp.url,
                        "status": resp.status,
                        "headers": dict(resp.headers),
                        "text_len": None,
                        "text_preview": None,
                        "ts": datetime.now(timezone.utc).isoformat()
                    }
                    try:
                        txt = resp.text()
                        r["text_len"] = len(txt) if txt is not None else None
                        # keep preview (first 20k chars) to avoid massive files
                        r["text_preview"] = txt[:20000] if txt else ""
                    except Exception as e:
                        r["text_len"] = None
                        r["text_preview"] = f"<error reading response: {e}>"
                    out["responses"].append(r)
                    print("RESP:", resp.status, resp.url, "len_preview=", r["text_len"])
            except Exception:
                print("on_response err", traceback.format_exc())

        page.on("request", on_request)
        page.on("response", on_response)

        # navigate to base page
        try:
            page.goto(f"{BASE}{LISTING_PATH}", wait_until="domcontentloaded", timeout=30000)
        except Exception:
            try:
                page.goto(f"{BASE}{LISTING_PATH}", wait_until="load", timeout=30000)
            except Exception:
                pass

        # snapshot location and DOM
        try:
            out["nav"]["initial_hash"] = page.evaluate("() => location.hash")
        except Exception:
            out["nav"]["initial_hash"] = None

        # save HTML snapshot before click
        html_fp = LISTINGS_DIR / f"debug_page_{page_num}_before.html"
        html_fp.write_text(page.content() or "", encoding="utf-8")
        out["html_snapshot"] = str(html_fp)

        # attempt to click an anchor with '#page-N'
        anchor_selector = f'a[href*="#page-{page_num}"], button[data-page="{page_num}"], a[data-page="{page_num}"]'
        clicked = False
        try:
            el = page.query_selector(anchor_selector)
            if el:
                el.scroll_into_view_if_needed()
                el.click()
                clicked = True
                out["nav"]["action"] = "click_anchor"
        except Exception:
            clicked = False

        if not clicked:
            # fallback: set hash
            try:
                page.evaluate(f"() => {{ location.hash = '#page-{page_num}'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}")
                out["nav"]["action"] = "set_hash"
            except Exception:
                out["nav"]["action"] = "none_possible"

        # wait to let XHRs fire
        t0 = time.time()
        time.sleep(wait_after_click)

        # extra wait loop to gather responses for up to capture_timeout seconds total
        deadline = time.time() + capture_timeout
        while time.time() < deadline:
            # break early if we have at least one request+response pair for API_PATH
            if any(API_PATH_SUBSTR in r.get("url","") for r in out["responses"]) and len(out["responses"]) >= 1:
                # give a short extra window to ensure any follow-up responses are captured
                time.sleep(0.5)
                break
            time.sleep(0.5)

        # final snapshots
        try:
            out["nav"]["final_hash"] = page.evaluate("() => location.hash")
        except Exception:
            out["nav"]["final_hash"] = None

        try:
            out["cookies"] = ctx.cookies()
        except Exception:
            out["cookies"] = None

        try:
            out["localStorage"] = page.evaluate("() => { let o={}; for(let i=0;i<localStorage.length;i++){ let k=localStorage.key(i); o[k]=localStorage.getItem(k);} return o; }")
        except Exception:
            out["localStorage"] = None

        # save a final HTML
        html_fp2 = LISTINGS_DIR / f"debug_page_{page_num}_after.html"
        html_fp2.write_text(page.content() or "", encoding="utf-8")
        out["html_snapshot_after"] = str(html_fp2)

        # write JSON
        out_fp = LISTINGS_DIR / f"debug_page_{page_num}.json"
        with open(out_fp, "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=2, ensure_ascii=False)
        print("WROTE DEBUG ->", out_fp)

        try:
            page.close()
        except:
            pass
        try:
            ctx.close()
        except:
            pass
        try:
            browser.close()
        except:
            pass

    return out_fp

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", type=int, default=1)
    ap.add_argument("--headful", action="store_true")
    args = ap.parse_args()
    print("Running debug capture for page", args.page)
    res = run_debug(page_num=args.page, headful=args.headful, wait_after_click=3.0, capture_timeout=14)
    print("Done, output:", res)
