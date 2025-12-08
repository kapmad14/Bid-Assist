#!/usr/bin/env python3
"""
GeM bids scraper — robust, streaming "lift-and-shift" version.

Updates: fixes regex-template bug, adds set_sort_latest_start(), wraps the scraping run
with a restart-on-failure wrapper _run_scrape_with_retries(), streams NDJSON, dedupes,
adds pdf metadata to run-level JSON, and includes NDJSON cleanup + runtime metric.
"""
import json
import os
import re
import hashlib
import time
import logging
from datetime import datetime, timedelta
from typing import Optional, Tuple, List, Dict
from urllib.parse import urljoin, quote as urlquote
from dotenv import load_dotenv
import sys
import argparse

import requests
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

# optional dependency for robust parsing
try:
    from dateutil import parser as dateutil_parser  # type: ignore
except Exception:
    dateutil_parser = None

load_dotenv()

# ---------------- Logging ----------------
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)-5s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ---------------- CONFIG ---------------- #

ROOT_URL = "https://bidplus.gem.gov.in"
ALL_BIDS_URL = ROOT_URL + "/all-bids"
PAGE_LOAD_TIMEOUT = int(os.environ.get("PAGE_LOAD_TIMEOUT", 30000))  # ms (Playwright expects ms)
MAX_PAGES = int(os.environ.get("MAX_PAGES", 5000))  # hard safety cap
MIN_PAGES = int(os.environ.get("MIN_PAGES", 1200))  # minimum pages to scan before early stop allowed

# Supabase config via env vars
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET_NAME", "gem-pdfs")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/114.0 Safari/537.36"
)

DAILY_DATA_DIR = os.path.join(os.path.dirname(__file__), "daily_data")
os.makedirs(DAILY_DATA_DIR, exist_ok=True)

# runtime timeouts/delays
PDF_UPLOAD_TIMEOUT = int(os.environ.get("PDF_UPLOAD_TIMEOUT", 60))
JSON_UPLOAD_TIMEOUT = int(os.environ.get("JSON_UPLOAD_TIMEOUT", 30))
HEAD_TIMEOUT = int(os.environ.get("HEAD_TIMEOUT", 15))
PER_UPLOAD_DELAY = float(os.environ.get("PER_UPLOAD_DELAY", 0.5))
BROWSER_RESTART_ATTEMPTS = int(os.environ.get("BROWSER_RESTART_ATTEMPTS", 3))

# navigation robustness
CONSECUTIVE_NAV_FAILURES_BEFORE_ABORT = int(os.environ.get("CONSECUTIVE_NAV_FAILURES_BEFORE_ABORT", 6))

# streaming & tmp
NDJSON_TMP_DIR = os.path.join(DAILY_DATA_DIR, "tmp")
os.makedirs(NDJSON_TMP_DIR, exist_ok=True)
PARSE_FAILURE_SAMPLE_LIMIT = 3  # keep up to 3 raw_text samples per run for audit

# ---------------------------------------- #

# Date parsing pattern strings with {label} placeholder (we will format them safely)
_DATE_PATTERNS = [
    # exact: dd-mm-yyyy h:mm AM/PM
    (r"{label}:\s*([0-9]{2}-[0-9]{2}-[0-9]{4}\s+[0-9]{1,2}:[0-9]{2}\s+[AP]M)", "%d-%m-%Y %I:%M %p"),
    # d-m-yyyy h:mm AM/PM (single digit day/month)
    (r"{label}:\s*([0-9]{1,2}-[0-9]{1,2}-[0-9]{4}\s+[0-9]{1,2}:[0-9]{2}\s+[AP]M)", "%d-%m-%Y %I:%M %p"),
    # dd-mm-yyyy HH:MM (24-hour)
    (r"{label}:\s*([0-9]{2}-[0-9]{2}-[0-9]{4}\s+[0-9]{2}:[0-9]{2})", "%d-%m-%Y %H:%M"),
    # dd/mm/yyyy formats, allow optional AM/PM
    (r"{label}:\s*([0-9]{2}/[0-9]{2}/[0-9]{4}\s+[0-9]{1,2}:[0-9]{2}(?:\s*[APap][Mm])?)", None),
]

_GENERIC_DATE_LIKE = re.compile(r"([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4}[^,\n\r]*)", re.IGNORECASE)


def parse_datetime_label(raw_text: str, label: str) -> Optional[datetime]:
    """
    Parse a datetime for 'label' (e.g., 'Start Date', 'End Date') using multiple patterns,
    then fallback to dateutil or generic extraction.
    Returns naive datetime (no tz).
    """
    if not raw_text or not isinstance(raw_text, str):
        return None

    text = " ".join(raw_text.split())

    for pattern_str, fmt in _DATE_PATTERNS:
        try:
            regex_str = pattern_str.format(label=re.escape(label))
            regex = re.compile(regex_str, re.IGNORECASE)
        except Exception:
            # fallback to naive replace (should not usually be necessary)
            try:
                regex = re.compile(pattern_str.replace("{label}", label), re.IGNORECASE)
            except Exception:
                continue
        m = regex.search(text)
        if m:
            candidate = m.group(1).strip()
            if fmt:
                try:
                    return datetime.strptime(candidate, fmt)
                except Exception:
                    pass
            else:
                if dateutil_parser:
                    try:
                        return dateutil_parser.parse(candidate, dayfirst=True)
                    except Exception:
                        pass
                for f in ("%d/%m/%Y %I:%M %p", "%d/%m/%Y %H:%M"):
                    try:
                        return datetime.strptime(candidate, f)
                    except Exception:
                        pass

    # generic fallback
    m2 = _GENERIC_DATE_LIKE.search(text)
    if m2:
        candidate = m2.group(1).strip()
        if dateutil_parser:
            try:
                return dateutil_parser.parse(candidate, dayfirst=True)
            except Exception:
                pass
        for f in ("%d-%m-%Y %I:%M %p", "%d-%m-%Y %H:%M", "%d/%m/%Y %I:%M %p", "%d/%m/%Y %H:%M"):
            try:
                return datetime.strptime(candidate, f)
            except Exception:
                pass

    return None


def parse_start_datetime(raw_text: str) -> Optional[datetime]:
    return parse_datetime_label(raw_text, "Start Date")


def parse_end_datetime(raw_text: str) -> Optional[datetime]:
    return parse_datetime_label(raw_text, "End Date")


def parse_extra_fields(raw_text: str) -> dict:
    """Parse item, quantity, department from the card text (optional metadata)."""
    try:
        lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
        joined = " ".join(lines)

        # Items
        m_items = re.search(r"Items:\s*(.+?)(?:\s+Quantity:|$)", joined, re.IGNORECASE)
        item = m_items.group(1).strip(" .") if m_items else None

        # Quantity (allow commas)
        m_qty = re.search(r"Quantity:\s*([\d,]+)", joined, re.IGNORECASE)
        quantity = int(m_qty.group(1).replace(",", "")) if m_qty else None

        # Department
        m_dept = re.search(
            r"Department Name And Address:\s*(.+?)\s*(?:Start Date:|End Date:|$)",
            joined,
            re.IGNORECASE,
        )
        department = m_dept.group(1).strip() if m_dept else None

        return {
            "item": item,
            "quantity": quantity,
            "department": department,
        }
    except Exception:
        return {"item": None, "quantity": None, "department": None}


def _encode_object_name(object_name: str) -> str:
    return "/".join(urlquote(p, safe="") for p in object_name.split("/"))


def ensure_supabase_env():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in env")


def download_pdf(detail_url: str) -> bytes:
    logger.debug("Downloading PDF: %s", detail_url)
    resp = requests.get(detail_url, headers={"User-Agent": USER_AGENT}, timeout=60)
    resp.raise_for_status()
    return resp.content


def _compute_sha256(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def _get_object_sha256_if_exists(object_name: str) -> Optional[str]:
    ensure_supabase_env()
    encoded = _encode_object_name(object_name)
    storage_url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{encoded}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    last_exc = None
    for attempt in range(1, 4):
        try:
            resp = requests.head(storage_url, headers=headers, timeout=HEAD_TIMEOUT)
        except Exception as e:
            last_exc = e
            logger.debug("HEAD failed for %s (attempt %d): %s", object_name, attempt, e)
            time.sleep(2 ** attempt)
            continue

        if resp.status_code in (404, 400):
            logger.debug("HEAD returned %s for %s (object likely not present)", resp.status_code, object_name)
            return None
        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", "5"))
            logger.debug("HEAD 429, sleeping %ds", wait)
            time.sleep(wait)
            last_exc = RuntimeError("429 on HEAD")
            continue
        if not resp.ok:
            logger.debug("unexpected HEAD status %s for %s", resp.status_code, object_name)
            return None

        meta_sha = resp.headers.get("x-meta-sha256") or resp.headers.get("X-Meta-Sha256")
        return meta_sha

    logger.debug("HEAD exhausted for %s: %s", object_name, last_exc)
    return None


def upload_pdf_to_supabase(pdf_bytes: bytes, object_name: str) -> Tuple[bool, Optional[str]]:
    ensure_supabase_env()
    sha = _compute_sha256(pdf_bytes)

    existing_sha = _get_object_sha256_if_exists(object_name)
    if existing_sha:
        try:
            if existing_sha.strip().lower() == sha.lower():
                logger.info("Skipping upload for %s; SHA matches existing object", object_name)
                return False, sha
        except Exception:
            pass

    encoded = _encode_object_name(object_name)
    storage_url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{encoded}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/pdf",
        "x-meta-sha256": sha,
        "x-upsert": "true",
    }
    last_exc = None
    for attempt in range(1, 4):
        try:
            resp = requests.post(storage_url, headers=headers, data=pdf_bytes, timeout=PDF_UPLOAD_TIMEOUT)
            if resp.ok:
                time.sleep(PER_UPLOAD_DELAY)
                return True, sha
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", "5"))
                logger.debug("upload 429 sleeping %ds", wait)
                time.sleep(wait)
                last_exc = RuntimeError("429 on upload")
            else:
                last_exc = RuntimeError(f"Failed to upload PDF (status {resp.status_code}): {resp.text}")
        except Exception as e:
            last_exc = e
        sleep_time = 2 ** attempt
        logger.debug("upload attempt %d failed, retrying in %ds", attempt, sleep_time)
        time.sleep(sleep_time)

    raise RuntimeError(f"Failed to upload PDF after retries: {last_exc}")


def upload_json_to_supabase(json_bytes: bytes, object_name: str):
    ensure_supabase_env()
    encoded = _encode_object_name(object_name)
    storage_url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{encoded}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "x-upsert": "true",
    }
    last_exc = None
    for attempt in range(1, 4):
        try:
            resp = requests.post(storage_url, headers=headers, data=json_bytes, timeout=JSON_UPLOAD_TIMEOUT)
            if resp.ok:
                return
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", "5"))
                logger.debug("json upload 429 sleeping %ds", wait)
                time.sleep(wait)
                last_exc = RuntimeError("429 on JSON upload")
            else:
                last_exc = RuntimeError(f"Failed to upload JSON (status {resp.status_code}): {resp.text}")
        except Exception as e:
            last_exc = e
        sleep_time = 2 ** attempt
        logger.debug("json upload attempt %d failed, retrying in %ds", attempt, sleep_time)
        time.sleep(sleep_time)

    raise RuntimeError(f"Failed to upload JSON after retries: {last_exc}")


def make_public_pdf_url(object_name: str) -> str:
    encoded = "/".join(urlquote(p, safe="") for p in object_name.split("/"))
    return f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/{SUPABASE_BUCKET}/{encoded}"


# ---------------- navigation helpers (restored robust versions) ----------------

def navigate_next(page, first_before_text: Optional[str], current_page_number: int) -> bool:
    """
    Robustly navigate to the next page. Strategies tried (in order):
      0) click numeric page link for page (current_page_number+1)
      1) click detected 'Next' button
      2) find href via DOM and goto it
      3) JS-click a matching anchor
      4) page.reload()
    Returns True if navigation action was initiated (caller still must wait/check for new content).
    """
    target_page_num = current_page_number + 1
    # 0: numeric page link
    try:
        anchors = page.locator("a")
        for i in range(anchors.count()):
            try:
                a = anchors.nth(i)
                txt = (a.inner_text() or "").strip()
                if txt == str(target_page_num):
                    logger.debug("NAV: clicking numeric page link '%s'", txt)
                    try:
                        a.click()
                        return True
                    except Exception as e:
                        logger.debug("NAV: numeric click failed: %s", e)
            except Exception:
                continue
    except Exception:
        pass

    # 1: click Next button if available
    try:
        candidates = [
            "a[aria-label='Next']",
            "a.page-link[rel='next']",
            "a[rel='next']",
            "a[title='Next']",
            "a:has-text('Next')",
            "button:has-text('Next')",
        ]
        for sel in candidates:
            loc = page.locator(sel)
            if loc.count() == 0:
                continue
            btn = loc.first
            try:
                disabled = (btn.get_attribute("disabled") or "").lower()
            except Exception:
                disabled = ""
            try:
                classes = (btn.get_attribute("class") or "").lower()
            except Exception:
                classes = ""
            if "disabled" in classes or disabled in ("true", "disabled"):
                continue
            try:
                logger.debug("NAV: clicking Next control selector=%s", sel)
                btn.click()
                return True
            except Exception as e:
                logger.debug("NAV: click Next failed for %s: %s", sel, e)
    except Exception:
        pass

    # 2: DOM-href fallback
    try:
        js = '''
        (() => {
          const selectors = [
            'a[aria-label="Next"]',
            'a.page-link[rel="next"]',
            'a[rel="next"]',
            'a[title="Next"]',
            'a:has-text("Next")',
            'a:has-text("›")',
            'a.pagination__next'
          ];
          for (const s of selectors) {
            try {
              const el = document.querySelector(s);
              if (el && el.getAttribute && el.getAttribute('href')) return el.getAttribute('href');
            } catch (e) {}
          }
          const tokens = ['next', '›', '»', 'more', '→'];
          const anchors = Array.from(document.querySelectorAll('a'));
          for (const a of anchors) {
            const txt = (a.textContent || '').trim().toLowerCase();
            if (!txt) continue;
            for (const t of tokens) {
              if (txt === t || txt.includes(t)) {
                if (a.getAttribute && a.getAttribute('href')) return a.getAttribute('href');
              }
            }
          }
          return null;
        })();
        '''
        href = page.evaluate(js)
        if href:
            try:
                from urllib.parse import urljoin as _uj
                abs = _uj(ALL_BIDS_URL, href)
            except Exception:
                abs = href
            logger.debug("NAV: DOM-href found -> goto %s", abs)
            try:
                page.goto(abs, timeout=PAGE_LOAD_TIMEOUT)
                return True
            except Exception as e:
                logger.debug("NAV: goto failed for %s: %s", abs, e)
    except Exception as e:
        logger.debug("NAV: DOM href extraction failed: %s", e)

    # 3: JS-click first anchor containing next-like tokens
    try:
        js_click = """
        (() => {
          const tokens = ['next', '›', '»', 'more', '→'];
          const anchors = Array.from(document.querySelectorAll('a'));
          for (const a of anchors) {
            const txt = (a.textContent || '').trim().toLowerCase();
            if (!txt) continue;
            for (const t of tokens) {
              if (txt === t || txt.includes(t)) {
                try { a.click(); return true; } catch(e) {}
              }
            }
          }
          return false;
        })();
        """
        clicked = page.evaluate(js_click)
        if clicked:
            logger.debug("NAV: JS-click succeeded")
            return True
    except Exception as e:
        logger.debug("NAV: JS-click attempt failed: %s", e)

    # 4: last-ditch reload
    try:
        logger.debug("NAV: attempting page.reload() as last resort")
        page.reload(timeout=PAGE_LOAD_TIMEOUT)
        return True
    except Exception as e:
        logger.debug("NAV: reload failed: %s", e)

    return False


def wait_for_page_change(page, prev_url: str, first_before_text: Optional[str], timeout_ms: int = PAGE_LOAD_TIMEOUT) -> bool:
    """
    Wait until URL changes or first bid text changes. On failure, save HTML + screenshot for debugging.
    """
    wait_interval_ms = 500
    waited = 0
    changed = False
    failures_dir = os.path.join(DAILY_DATA_DIR, "failures")
    os.makedirs(failures_dir, exist_ok=True)

    while waited < timeout_ms:
        try:
            page.wait_for_timeout(wait_interval_ms)
            try:
                page.wait_for_selector("a.bid_no_hover", timeout=wait_interval_ms)
            except PlaywrightTimeoutError:
                pass

            try:
                after_url = page.url
            except Exception:
                after_url = prev_url

            try:
                after_first = None
                f = page.locator("a.bid_no_hover").first
                if f and f.count() > 0:
                    try:
                        after_first = f.inner_text().strip()
                    except Exception:
                        after_first = None
            except Exception:
                after_first = None

            if after_url != prev_url:
                logger.debug("WAIT: detected url change: %s", after_url)
                changed = True
                break
            if first_before_text is None and after_first:
                logger.debug("WAIT: detected first-bid presence on new page")
                changed = True
                break
            if first_before_text and after_first and after_first != first_before_text:
                logger.debug("WAIT: detected first-bid text change")
                changed = True
                break

        except Exception:
            pass

        waited += wait_interval_ms

    if not changed:
        ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        html_path = os.path.join(failures_dir, f"page_failure_{ts}.html")
        png_path = os.path.join(failures_dir, f"page_failure_{ts}.png")
        try:
            content = page.content()
            with open(html_path, "w", encoding="utf-8") as fh:
                fh.write(content)
            logger.debug("Saved failure HTML to %s", html_path)
        except Exception as e:
            logger.debug("Failed to save HTML snapshot: %s", e)
        try:
            page.screenshot(path=png_path, full_page=True)
            logger.debug("Saved failure screenshot to %s", png_path)
        except Exception as e:
            logger.debug("Failed to save screenshot: %s", e)

        try:
            logger.debug("WAIT: attempting one final reload after failure")
            page.reload(timeout=PAGE_LOAD_TIMEOUT)
            page.wait_for_timeout(1000)
            try:
                new_url = page.url
            except Exception:
                new_url = prev_url
            if new_url != prev_url:
                logger.debug("WAIT: reload changed URL; continuing")
                return True
        except Exception:
            pass

        return False

    return True


# ---------------- helper to set sort order ----------------

def set_sort_latest_start(page):
    """Click 'Sort by' → 'Bid Start Date: Latest First' and wait for bids to appear."""
    try:
        sort_btn = page.locator("button:has-text('Sort by')")
        if sort_btn.count() == 0:
            sort_btn = page.locator("text=Sort by")
        if sort_btn.count() > 0:
            try:
                sort_btn.first.click()
            except Exception:
                try:
                    page.evaluate("document.querySelector(\"button:has-text('Sort by')\").click()")
                except Exception:
                    pass

        option = page.locator("text='Bid Start Date: Latest First'")
        if option.count() > 0:
            try:
                option.first.click()
            except Exception:
                try:
                    page.evaluate(
                        "Array.from(document.querySelectorAll('*')).find(e => e.textContent && e.textContent.includes('Bid Start Date: Latest First')).click()"
                    )
                except Exception:
                    pass
    except Exception:
        pass

    # explicit wait for bids to ensure sort applied
    try:
        page.wait_for_selector("a.bid_no_hover", timeout=PAGE_LOAD_TIMEOUT)
    except PlaywrightTimeoutError:
        try:
            page.wait_for_load_state("networkidle", timeout=PAGE_LOAD_TIMEOUT)
        except PlaywrightTimeoutError:
            pass


# ---------------- scraping + streaming pipeline ----------------

def find_bid_block_container(link_locator):
    container = link_locator
    last_good = link_locator
    for _ in range(8):
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
    return last_good


def scrape_and_stream(target_date: datetime.date):
    """
    Scrape pages and stream processed bid records to NDJSON.
    Returns stats including path to the NDJSON file and parse failure info.
    """
    date_str = target_date.strftime("%Y-%m-%d")
    ndjson_path = os.path.join(NDJSON_TMP_DIR, f"gem_bids_{date_str}.ndjson")
    failures_dir = os.path.join(DAILY_DATA_DIR, "failures")
    os.makedirs(failures_dir, exist_ok=True)

    seen = set()
    parse_failures = 0
    parse_failure_samples: List[str] = []
    passed_target_date = False

    ensure_supabase_env()

    with sync_playwright() as p, open(ndjson_path, "a", encoding="utf-8") as ndjson_f:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            page.set_extra_http_headers({"User-Agent": USER_AGENT})
        except Exception:
            pass

        logger.info("Opening: %s", ALL_BIDS_URL)
        try:
            page.goto(ALL_BIDS_URL, timeout=PAGE_LOAD_TIMEOUT)
        except PlaywrightTimeoutError:
            logger.warning("Initial load timed out, trying reload")
            try:
                page.reload(timeout=PAGE_LOAD_TIMEOUT)
            except Exception:
                pass
            try:
                page.goto(ALL_BIDS_URL, timeout=PAGE_LOAD_TIMEOUT)
            except Exception as e:
                browser.close()
                raise RuntimeError("Failed initial load") from e

        page.wait_for_selector("a.bid_no_hover", timeout=PAGE_LOAD_TIMEOUT)

        # set sort latest first via helper
        set_sort_latest_start(page)

        page_number = 1
        consecutive_nav_failures = 0

        while page_number <= MAX_PAGES:
            logger.info("--- Scraping page %d ---", page_number)

            bid_links = page.locator("a.bid_no_hover")
            count = bid_links.count()
            logger.info("Page %d: %d bid/RA links", page_number, count)

            # iterate through bids on this page
            for i in range(count):
                try:
                    link = bid_links.nth(i)
                except Exception as e:
                    logger.warning("Failed to access bid link %d on page %d: %s", i, page_number, e)
                    continue

                try:
                    bid_number_text = link.inner_text().strip()
                except Exception as e:
                    logger.warning("Failed to read inner_text for link %d page %d: %s", i, page_number, e)
                    continue

                if "/B/" not in bid_number_text:
                    # skip RA entries
                    continue

                try:
                    href = link.get_attribute("href") or ""
                    detail_url = urljoin(ROOT_URL, href)
                except Exception as e:
                    logger.warning("Failed to get href for %s: %s", bid_number_text, e)
                    continue

                try:
                    container = find_bid_block_container(link)
                except Exception as e:
                    logger.debug("find container failed for link %s: %s", bid_number_text, e)
                    container = link
                try:
                    raw_text = container.inner_text().strip()
                except PlaywrightTimeoutError:
                    try:
                        raw_text = link.inner_text().strip()
                    except Exception as e:
                        logger.warning("Failed to read fallback link text for %s: %s", bid_number_text, e)
                        continue
                except Exception as e:
                    logger.warning("Failed to read container text for %s: %s", bid_number_text, e)
                    continue

                try:
                    if "RA NO" in raw_text.upper():
                        continue
                except Exception:
                    pass

                # parse start and end datetimes robustly
                start_dt = parse_start_datetime(raw_text)
                if not start_dt:
                    parse_failures += 1
                    if len(parse_failure_samples) < PARSE_FAILURE_SAMPLE_LIMIT:
                        parse_failure_samples.append(raw_text[:400])
                    # cannot rely on this bid for date-based filtering; skip
                    continue

                sd = start_dt.date()
                if sd < target_date:
                    passed_target_date = True
                    logger.info("Hit bids older than %s on page %d (bid %s); marking passed_target_date", target_date, page_number, bid_number_text)
                    # break this page's bid loop to evaluate stopping condition
                    break

                if sd != target_date:
                    # not the target date; skip
                    continue

                # dedupe by bid number
                bid_num = bid_number_text
                if bid_num in seen:
                    logger.debug("duplicate skipped for %s (page %d)", bid_num, page_number)
                    continue
                seen.add(bid_num)

                # extract extra fields
                try:
                    extra = parse_extra_fields(raw_text)
                except Exception:
                    extra = {}

                # parse end datetime (best-effort)
                end_dt = parse_end_datetime(raw_text)
                end_iso = end_dt.isoformat() if end_dt else None

                bid_record = {
                    "page": page_number,
                    "bid_number": bid_num,
                    "detail_url": detail_url,
                    "start_datetime": start_dt.isoformat(),
                    "end_datetime": end_iso,
                    "raw_text": raw_text,
                    **(extra or {}),
                }

                # immediate PDF processing
                parts = bid_num.split("/")
                if len(parts) >= 2:
                    suffix = "_".join(parts[-2:])
                else:
                    suffix = bid_num.replace("/", "_")
                date_token = target_date.strftime("%d%m%y")
                base_name = f"GeM_{date_token}_{suffix}"
                pdf_filename = base_name + ".pdf"
                pdf_object_name = f"bids/{target_date.strftime('%Y-%m-%d')}/{pdf_filename}"

                try:
                    pdf_bytes = download_pdf(detail_url)
                    uploaded, sha = upload_pdf_to_supabase(pdf_bytes, pdf_object_name)
                except Exception as e:
                    logger.exception("PDF handling failed for %s: %s", bid_num, e)
                    uploaded = False
                    sha = None

                bid_record["pdf_storage_path"] = pdf_object_name
                bid_record["pdf_sha256"] = sha
                bid_record["pdf_uploaded"] = bool(uploaded)
                try:
                    bid_record["pdf_public_url"] = make_public_pdf_url(pdf_object_name)
                except Exception:
                    bid_record["pdf_public_url"] = None

                # write to NDJSON
                try:
                    ndjson_f.write(json.dumps(bid_record, ensure_ascii=False) + "\n")
                    ndjson_f.flush()
                except Exception as e:
                    logger.exception("Failed to write NDJSON for %s: %s", bid_num, e)

            # after iterating bids on page, check early-stop condition
            if passed_target_date and page_number >= MIN_PAGES:
                logger.info("Reached bids older than target date on page %d and page_number >= MIN_PAGES (%d); stopping.", page_number, MIN_PAGES)
                break

            # NAVIGATION: robust navigation with retries
            try:
                first_before = None
                try:
                    first_before = page.locator("a.bid_no_hover").first.inner_text().strip()
                except Exception:
                    first_before = None
            except Exception:
                first_before = None

            navigated = navigate_next(page, first_before, page_number)

            if not navigated:
                consecutive_nav_failures += 1
                logger.warning("No usable Next navigation path on page %d. consecutive_nav_failures=%d", page_number, consecutive_nav_failures)
                if consecutive_nav_failures >= CONSECUTIVE_NAV_FAILURES_BEFORE_ABORT:
                    logger.error("Exceeded consecutive navigation failures (%d). Aborting.", CONSECUTIVE_NAV_FAILURES_BEFORE_ABORT)
                    break
                else:
                    time.sleep(1)
                    continue
            else:
                consecutive_nav_failures = 0

            # small delay
            try:
                time.sleep(PER_UPLOAD_DELAY)
            except Exception:
                pass

            prev_url = page.url
            ok = wait_for_page_change(page, prev_url, first_before, timeout_ms=PAGE_LOAD_TIMEOUT)
            if not ok:
                logger.warning("Timed out waiting for new page content after navigation; stopping.")
                break

            page_number += 1

        # end page loop
        browser.close()

    # save parse-failure snapshot if needed
    if parse_failures > 0:
        ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        try:
            with sync_playwright() as p2:
                b2 = p2.chromium.launch(headless=True)
                pg2 = b2.new_page()
                try:
                    pg2.goto(ALL_BIDS_URL, timeout=PAGE_LOAD_TIMEOUT)
                except Exception:
                    pass
                html_path = os.path.join(failures_dir, f"parse_failure_sample_{ts}.html")
                try:
                    content = pg2.content()
                    with open(html_path, "w", encoding="utf-8") as fh:
                        fh.write(content)
                    logger.info("Saved parse-failure HTML sample to %s", html_path)
                except Exception as e:
                    logger.debug("Failed to save parse-failure HTML sample: %s", e)
                b2.close()
        except Exception:
            logger.debug("Could not produce parse-failure HTML sample with Playwright")

    return {
        "ndjson_path": ndjson_path,
        "seen_count": len(seen),
        "parse_failures": parse_failures,
        "parse_failure_samples": parse_failure_samples,
    }


def dedupe_and_write_final_json(ndjson_path: str, target_date: datetime.date) -> Tuple[str, int]:
    """
    Read NDJSON, dedupe by bid_number, and write final run-level JSON into daily_data/.
    Returns (meta_path, unique_count).

    Ensures temporary NDJSON is removed in a finally: block (best-effort).
    """
    date_str = target_date.strftime("%Y-%m-%d")
    meta_filename = f"gem_bids_{date_str}_no_ra_meta.json"
    meta_path = os.path.join(DAILY_DATA_DIR, meta_filename)

    unique_map: Dict[str, dict] = {}
    total = 0
    try:
        with open(ndjson_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                total += 1
                bn = rec.get("bid_number")
                if bn:
                    if bn not in unique_map:
                        unique_map[bn] = rec

        final_bids = list(unique_map.values())
        scraped_at = datetime.utcnow().isoformat() + "Z"
        payload = {"scraped_at": scraped_at, "record_count": len(final_bids), "bids": final_bids}
        with open(meta_path, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False, indent=2))
        logger.info("Wrote final metadata to %s (raw_ndjson_total=%d unique=%d)", meta_path, total, len(final_bids))
        return meta_path, len(final_bids)
    finally:
        # best-effort cleanup of NDJSON temp file
        try:
            os.remove(ndjson_path)
            logger.debug("Cleaned up tmp NDJSON in dedupe_and_write_final_json: %s", ndjson_path)
        except Exception:
            logger.debug("Could not clean up tmp NDJSON (it may have been removed already): %s", ndjson_path)


# ---------------- wrapper for restart-on-failure ----------------

def _run_scrape_with_retries(target_date: datetime.date):
    last_exc = None
    for attempt in range(1, BROWSER_RESTART_ATTEMPTS + 1):
        try:
            return scrape_and_stream(target_date)
        except Exception as e:
            last_exc = e
            logger.exception("Scraping attempt %d failed: %s", attempt, e)
            if attempt < BROWSER_RESTART_ATTEMPTS:
                wait = 2 ** attempt
                logger.info("Restarting browser and retrying after %ds...", wait)
                time.sleep(wait)
            else:
                logger.error("Exhausted browser restart attempts.")
    raise RuntimeError(f"Scraping failed after {BROWSER_RESTART_ATTEMPTS} attempts: {last_exc}")


def _parse_target_date_arg() -> datetime.date:
    """Return the target date from CLI arg --date or positional, or default to yesterday."""
    parser = argparse.ArgumentParser(description="GeM bids scraper (target date YYYY-MM-DD).")
    parser.add_argument("date", nargs="?", help="Target date in YYYY-MM-DD (defaults to yesterday)")
    args = parser.parse_args()

    if args.date:
        try:
            return datetime.strptime(args.date, "%Y-%m-%d").date()
        except Exception:
            logger.error("Invalid date format '%s'. Expected YYYY-MM-DD.", args.date)
            sys.exit(2)
    # fallback: yesterday
    return (datetime.now().date() - timedelta(days=1))


def main():
    start_time = time.time()

    # determine target date from CLI (or default to yesterday)
    target_date = _parse_target_date_arg()
    logger.info("Effective target date: %s", target_date)

    logger.info("Starting scrape for %s", target_date)
    stats = _run_scrape_with_retries(target_date)
    ndjson_path = stats["ndjson_path"]
    logger.info("Streaming scrape complete: seen=%d parse_failures=%d", stats["seen_count"], stats["parse_failures"])
    if stats["parse_failure_samples"]:
        logger.info("Parse failure samples (truncated):")
        for s in stats["parse_failure_samples"]:
            logger.info("  %s", s.replace("\n", " ")[:300])

    meta_path, unique_count = dedupe_and_write_final_json(ndjson_path, target_date)

    # Upload the run-level JSON to Supabase under daily_meta/
    try:
        object_name = f"daily_meta/{os.path.basename(meta_path)}"
        upload_json_to_supabase(open(meta_path, "rb").read(), object_name)
        logger.info("Uploaded run-level metadata to Supabase as %s", object_name)
    except Exception as e:
        logger.exception("Failed to upload run-level metadata: %s", e)

    elapsed_min = (time.time() - start_time) / 60.0
    logger.info("Run complete: unique_bids=%d, total_runtime=%.1fmin", unique_count, elapsed_min)


if __name__ == "__main__":
    main()

