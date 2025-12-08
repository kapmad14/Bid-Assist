#!/usr/bin/env python3
import json
import os
import re
import hashlib
import time
import random
from datetime import datetime, timedelta
from typing import Optional, Tuple
from urllib.parse import urljoin, quote
from dotenv import load_dotenv

import requests
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
import logging

# ---- env + logging ----
load_dotenv()

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)-5s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# reuse a requests session for all HTTP calls (better perf / keepalive)
HTTP_SESSION = requests.Session()
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/114.0 Safari/537.36"
)
HTTP_SESSION.headers.update({"User-Agent": USER_AGENT})

# ---------------- CONFIG ---------------- #

ROOT_URL = "https://bidplus.gem.gov.in"
ALL_BIDS_URL = ROOT_URL + "/all-bids"
PAGE_LOAD_TIMEOUT = int(os.environ.get("PAGE_LOAD_TIMEOUT", 30000))  # ms (Playwright expects ms)
MAX_PAGES = int(os.environ.get("MAX_PAGES", 5000))  # hard safety cap
# Minimum pages to attempt (force at least this many pages unless stop conditions hit)
MIN_PAGES = int(os.environ.get("MIN_PAGES", 1200))

# Supabase config via env vars
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
# default bucket = gem-pdfs (your requirement)
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET_NAME", "gem-pdfs")

# Local metadata folder (inside gem-scraper)
DAILY_DATA_DIR = os.path.join(os.path.dirname(__file__), "daily_data")

# runtime-configurable timeouts/delays
PDF_UPLOAD_TIMEOUT = int(os.environ.get("PDF_UPLOAD_TIMEOUT", 60))
JSON_UPLOAD_TIMEOUT = int(os.environ.get("JSON_UPLOAD_TIMEOUT", 30))
HEAD_TIMEOUT = int(os.environ.get("HEAD_TIMEOUT", 15))
PER_UPLOAD_DELAY = float(os.environ.get("PER_UPLOAD_DELAY", 0.5))
BROWSER_RESTART_ATTEMPTS = int(os.environ.get("BROWSER_RESTART_ATTEMPTS", 3))

# Navigation robustness
NAV_RETRY_ATTEMPTS = int(os.environ.get("NAV_RETRY_ATTEMPTS", 3))  # per-page navigation attempts
CONSECUTIVE_NAV_FAILURES_BEFORE_ABORT = int(
    os.environ.get("CONSECUTIVE_NAV_FAILURES_BEFORE_ABORT", 6)
)

# make sure MIN_PAGES/MAX_PAGES sane
if MIN_PAGES < 1:
    MIN_PAGES = 1
if MAX_PAGES < 1:
    MAX_PAGES = 1
if MIN_PAGES > MAX_PAGES:
    logger.warning(
        "MIN_PAGES (%d) is greater than MAX_PAGES (%d). Adjusting MAX_PAGES to MIN_PAGES.",
        MIN_PAGES,
        MAX_PAGES,
    )
    MAX_PAGES = MIN_PAGES

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
    if sort_btn.count() > 0:
        try:
            sort_btn.first.click()
        except Exception:
            # sometimes clicking fails silently; try JS click
            try:
                page.evaluate("document.querySelector(\"button:has-text('Sort by')\").click()")
            except Exception:
                logger.debug("Could not click Sort by via JS")
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
                logger.debug("Could not click 'Bid Start Date: Latest First' via JS")

    # Wait explicitly for the bids selector to be present rather than sleeping
    try:
        page.wait_for_selector("a.bid_no_hover", timeout=PAGE_LOAD_TIMEOUT)
    except PlaywrightTimeoutError:
        # fallback: wait for network to be idle
        try:
            page.wait_for_load_state("networkidle", timeout=PAGE_LOAD_TIMEOUT)
        except PlaywrightTimeoutError:
            logger.debug("set_sort_latest_start: fallback networkidle timed out")


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
        except Exception:
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
    logger.info("Page %d: %d bid/RA links", page_number, count)

    for i in range(count):
        # Robust per-card handling: protect each step against unexpected exceptions
        try:
            link = bid_links.nth(i)
        except Exception as e:
            logger.warning("failed to access bid link at index %d: %s", i, e)
            continue

        try:
            bid_number = link.inner_text().strip()
        except Exception as e:
            logger.warning("failed to read bid link text at index %d: %s", i, e)
            continue

        # Only consider genuine Bid numbers
        if "/B/" not in bid_number:
            continue

        try:
            href = link.get_attribute("href") or ""
            detail_url = urljoin(ROOT_URL, href)
        except Exception as e:
            logger.warning("failed to get href for %s: %s", bid_number, e)
            continue

        # Find a container for additional text
        try:
            container = find_bid_block_container(link)
        except Exception as e:
            # find_bid_block_container is robust but guard anyway
            logger.warning("failed to find container for %s: %s", bid_number, e)
            container = link

        try:
            raw_text = container.inner_text().strip()
        except PlaywrightTimeoutError:
            try:
                raw_text = link.inner_text().strip()
            except Exception as e:
                logger.warning("failed to read fallback link text for %s: %s", bid_number, e)
                continue
        except Exception as e:
            logger.warning("failed to read container text for %s: %s", bid_number, e)
            continue

        # Skip if this card mentions RA NO anywhere
        try:
            if "RA NO" in raw_text.upper():
                continue
        except Exception:
            # defensive: if raw_text isn't a string for some reason, skip
            continue

        try:
            start_dt = parse_start_datetime(raw_text)
        except Exception as e:
            logger.warning("failed to parse start datetime for %s: %s", bid_number, e)
            continue

        if start_dt is None:
            continue

        sd = start_dt.date()

        if sd == target_date:
            try:
                extra = parse_extra_fields(raw_text)
            except Exception as e:
                logger.warning("failed to parse extra fields for %s: %s", bid_number, e)
                extra = {}
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

    logger.info("Page %d: kept %d bids with Start Date = %s", page_number, len(matches), target_date)
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
        return btn
    return None


def _run_scrape_with_retries(target_date: datetime.date):
    """
    Wrap the scraping logic with an automatic restart on Playwright/browser errors.
    Returns the list of bids collected or raises after attempts exhausted.
    """
    last_exc = None
    for attempt in range(1, BROWSER_RESTART_ATTEMPTS + 1):
        try:
            return _scrape_for_date_once(target_date)
        except Exception:
            logger.exception("scraping attempt %d failed", attempt)
            last_exc = True
            if attempt < BROWSER_RESTART_ATTEMPTS:
                wait = 2 ** attempt
                logger.info("Restarting browser and retrying after %ds...", wait)
                time.sleep(wait)
            else:
                logger.error("Exhausted browser restart attempts.")
    raise RuntimeError("Scraping failed after attempts")


def _attempt_goto(page, url, timeout_ms=PAGE_LOAD_TIMEOUT):
    """
    Attempt a page.goto with Playwright timeout handling. Returns True on success.
    """
    try:
        page.goto(url, timeout=timeout_ms)
        # Ensure at least the bid selector exists or wait for network idle
        try:
            page.wait_for_selector("a.bid_no_hover", timeout=timeout_ms)
        except PlaywrightTimeoutError:
            try:
                page.wait_for_load_state("networkidle", timeout=timeout_ms)
            except PlaywrightTimeoutError:
                logger.debug("attempt_goto: network idle timeout for %s", url)
        return True
    except PlaywrightTimeoutError as e:
        logger.debug("page.goto timeout for %s: %s", url, e)
        return False
    except Exception as e:
        logger.debug("page.goto exception for %s: %s", url, e)
        return False


def navigate_next(page, first_before_text: Optional[str], current_page_number: int) -> bool:
    """
    Robustly navigate to the next page. Strategies tried (in order):
      A) Click numeric pagination link for page (current_page_number+1) if present
      B) click detected 'Next' button
      C) find href via DOM and goto it
      D) JS-click a matching anchor
      E) page.reload()
    Returns True if navigation action was initiated (caller still must wait/check for new content).
    """
    target_page_num = current_page_number + 1
    # 0: try numeric page link (most reliable if pagination shows numbers)
    try:
        # Look for anchors with exact text matching the next page number (trim whitespace)
        anchors = page.locator("a")
        count = anchors.count()
        for i in range(count):
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
    next_btn = find_next_button(page)
    if next_btn:
        try:
            logger.debug("NAV: clicking 'Next' control")
            next_btn.click()
            return True
        except Exception as e:
            logger.debug("NAV: click Next failed: %s", e)

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
            ok = _attempt_goto(page, abs)
            if ok:
                return True
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
    Wait until either:
      - page.url != prev_url
      - first bid text changed compared to first_before_text
      - or until timeout.
    On failure, save HTML + screenshot for debugging into DAILY_DATA_DIR/failures/
    """
    wait_interval_ms = 500
    waited = 0
    changed = False
    failures_dir = os.path.join(DAILY_DATA_DIR, "failures")
    os.makedirs(failures_dir, exist_ok=True)

    while waited < timeout_ms:
        try:
            page.wait_for_timeout(wait_interval_ms)
            # ensure bids selector present
            try:
                page.wait_for_selector("a.bid_no_hover", timeout=wait_interval_ms)
            except PlaywrightTimeoutError:
                # continue waiting; sometimes the new page takes longer
                pass

            # check URL change
            try:
                after_url = page.url
            except Exception:
                after_url = prev_url

            # check first link text change
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
        # Save snapshot for debugging
        ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        html_path = os.path.join(failures_dir, f"page_failure_{ts}.html")
        png_path = os.path.join(failures_dir, f"page_failure_{ts}.png")
        try:
            content = page.content()
            with open(html_path, "w", encoding="utf-8") as fh:
                fh.write(content)
            logger.debug("Saved failure HTML to %s", html_path)
        except Exception as e:
            logger.debug("failed to save HTML snapshot: %s", e)
        try:
            page.screenshot(path=png_path, full_page=True)
            logger.debug("Saved failure screenshot to %s", png_path)
        except Exception as e:
            logger.debug("failed to save screenshot: %s", e)

        # Try one more small reload to see if site recovers
        try:
            logger.debug("WAIT: attempting one final reload after failure")
            page.reload(timeout=PAGE_LOAD_TIMEOUT)
            # short wait then check url/content once
            page.wait_for_timeout(1000)
            # if reload changed url or DOM, let caller continue; we do one quick check:
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


def _scrape_for_date_once(target_date: datetime.date):
    """
    Actual scraping run using Playwright. Isolated so it can be retried safely.
    This version waits for page changes after clicking 'Next' and respects MIN_PAGES:
    it will only stop for passed_target_date when we've scanned at least MIN_PAGES pages.
    """
    all_bids = []
    seen_bid_numbers = set()
    os.makedirs(DAILY_DATA_DIR, exist_ok=True)

    try:
        with sync_playwright() as p:
            # headless=True is better for Docker / non-GUI
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            # set a realistic user-agent header for requests done by the browser (helps some sites)
            try:
                page.set_extra_http_headers({"User-Agent": USER_AGENT})
            except Exception:
                logger.debug("Could not set extra http headers on page")

            logger.info("Opening: %s", ALL_BIDS_URL)
            if not _attempt_goto(page, ALL_BIDS_URL):
                logger.warning("Initial page load failed; attempting one reload before aborting.")
                try:
                    page.reload(timeout=PAGE_LOAD_TIMEOUT)
                except Exception:
                    logger.debug("Initial reload failed")
                # try again quickly
                if not _attempt_goto(page, ALL_BIDS_URL):
                    browser.close()
                    raise RuntimeError("Failed to load ALL_BIDS_URL initially")

            page.wait_for_selector("a.bid_no_hover", timeout=PAGE_LOAD_TIMEOUT)
            set_sort_latest_start(page)

            page_number = 1
            consecutive_nav_failures = 0

            # Loop until MAX_PAGES (hard cap). We still respect MIN_PAGES when deciding to stop
            while page_number <= MAX_PAGES:
                logger.info("--- Scraping page %d ---", page_number)
                page_bids, passed_target_date = scrape_page_for_target_date(
                    page, page_number, target_date
                )

                # filter out bids we've already seen (dedupe by bid_number)
                new_added = 0
                for pb in page_bids:
                    bn = pb.get("bid_number")
                    if not bn:
                        continue
                    if bn in seen_bid_numbers:
                        logger.debug("duplicate skipped for %s (page %s)", bn, pb.get("page"))
                        continue
                    seen_bid_numbers.add(bn)
                    all_bids.append(pb)
                    new_added += 1
                logger.info("Page %d: appended %d new unique bids (page had %d parsed)", page_number, new_added, len(page_bids))

                # If we've hit bids older than target_date, only stop if we've scanned at least MIN_PAGES.
                # This implements: stop when passed_target_date AND page_number >= MIN_PAGES.
                if passed_target_date:
                    if page_number >= MIN_PAGES:
                        logger.info(
                            "Reached bids older than target date on page %d and page_number >= MIN_PAGES (%d); stopping.",
                            page_number,
                            MIN_PAGES,
                        )
                        break
                    else:
                        logger.info(
                            "Reached bids older than target date on page %d, but page_number < MIN_PAGES (%d); continuing.",
                            page_number,
                            MIN_PAGES,
                        )

                # --- NAVIGATION: robust navigation with bounded retries ---
                # capture first link text for change detection
                try:
                    first_before = None
                    f = page.locator("a.bid_no_hover").first
                    if f and f.count() > 0:
                        try:
                            first_before = f.inner_text().strip()
                        except Exception:
                            first_before = None
                except Exception:
                    first_before = None

                navigated = navigate_next(page, first_before, page_number)

                if not navigated:
                    consecutive_nav_failures += 1
                    logger.warning("No usable Next navigation path on page %d (failures=%d)", page_number, consecutive_nav_failures)
                    if consecutive_nav_failures >= CONSECUTIVE_NAV_FAILURES_BEFORE_ABORT:
                        logger.error("Exceeded consecutive navigation failures (%d). Aborting.", CONSECUTIVE_NAV_FAILURES_BEFORE_ABORT)
                        break
                    else:
                        # small sleep and attempt to continue loop (in case DOM will change on its own)
                        time.sleep(1 + random.uniform(0, 0.5))
                        continue
                else:
                    consecutive_nav_failures = 0

                # small delay after navigation to reduce flakiness and avoid too-regular patterns
                try:
                    time.sleep(PER_UPLOAD_DELAY + random.uniform(0, 0.3))
                except Exception:
                    pass

                # Wait loop: wait for first bid link text to change (or for the selector to appear).
                prev_url = page.url
                ok = wait_for_page_change(page, prev_url, first_before, timeout_ms=PAGE_LOAD_TIMEOUT)
                if not ok:
                    logger.warning("Timed out waiting for new page content after navigation; stopping.")
                    break

                page_number += 1

            browser.close()

        return all_bids

    except Exception:
        # Save partial progress for debugging / backfill
        try:
            ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
            tmp = os.path.join(DAILY_DATA_DIR, f"partial_{ts}.json")
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump({"bids": all_bids}, fh, ensure_ascii=False, indent=2)
            logger.exception("Scrape failed; saved partial results to %s", tmp)
        except Exception:
            logger.exception("Scrape failed and partial save also failed")
        raise


# ---------- PDF download + Supabase upload ---------- #


def ensure_supabase_env():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in env")


def download_pdf(detail_url: str) -> bytes:
    """
    Download the PDF bytes from the bid detail_url.
    Example: https://bidplus.gem.gov.in/showbidDocument/8655996
    """
    logger.info("Downloading PDF: %s", detail_url)
    resp = HTTP_SESSION.get(detail_url, timeout=60)
    resp.raise_for_status()

    ct = resp.headers.get("Content-Type", "")
    if "pdf" not in ct.lower():
        logger.warning("Expected PDF content-type but got '%s' for %s", ct, detail_url)
    return resp.content


def _compute_sha256(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def _encode_object_name(object_name: str) -> str:
    """
    URL-encode each path component of the object_name so we can safely include it in REST URLs.
    Example: 'daily_json_files/2025-12-04/gem_bids_2025-12-04.json'
    becomes percent-encoded for unsafe chars.
    """
    return "/".join(quote(p, safe="") for p in object_name.split("/"))


def _get_object_sha256_if_exists(object_name: str) -> Optional[str]:
    """
    Perform a HEAD request to Supabase Storage object URL and return
    the x-meta-sha256 value if present (string). Returns None if object doesn't exist
    or header is missing.
    """
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
            resp = HTTP_SESSION.head(storage_url, headers=headers, timeout=HEAD_TIMEOUT)
        except Exception as e:
            last_exc = e
            logger.warning("HEAD request failed for %s on attempt %d: %s", object_name, attempt, e)
            time.sleep(2 ** attempt)
            continue

        if resp.status_code in (404, 400):
            logger.debug("HEAD returned %d for %s (object likely not present)", resp.status_code, object_name)
            return None
        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", "5"))
            logger.info("attempt %d: Hit 429 on HEAD; sleeping %ds before retry", attempt, wait)
            time.sleep(wait)
            last_exc = RuntimeError("429 on HEAD")
            continue
        if not resp.ok:
            logger.debug("unexpected HEAD status %d for %s", resp.status_code, object_name)
            return None

        meta_sha = resp.headers.get("x-meta-sha256") or resp.headers.get("X-Meta-Sha256")
        return meta_sha

    logger.debug("HEAD requests exhausted for %s: %s", object_name, last_exc)
    return None


def upload_pdf_to_supabase(pdf_bytes: bytes, object_name: str) -> Tuple[bool, str]:
    """
    Upload a PDF to Supabase Storage using REST API with retries and SHA-256 idempotency.
    If an existing object has the same x-meta-sha256, upload is skipped.

    Returns tuple: (uploaded_bool, sha_hex)
    """
    ensure_supabase_env()

    sha = _compute_sha256(pdf_bytes)

    existing_sha = _get_object_sha256_if_exists(object_name)
    if existing_sha:
        try:
            if existing_sha.strip().lower() == sha.lower():
                logger.info("Skipping upload for '%s'; SHA matches existing object.", object_name)
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
        "x-upsert": "true",  # overwrite if exists (when different)
    }

    logger.info("Uploading to Supabase as %s (%d bytes) - sha=%s", object_name, len(pdf_bytes), sha)
    last_exc = None
    for attempt in range(1, 4):
        try:
            resp = HTTP_SESSION.post(storage_url, headers=headers, data=pdf_bytes, timeout=PDF_UPLOAD_TIMEOUT)
            if resp.ok:
                time.sleep(PER_UPLOAD_DELAY + random.uniform(0, 0.2))
                return True, sha
            elif resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", "5"))
                logger.info("attempt %d: hit 429, sleeping %ds then retrying", attempt, wait)
                time.sleep(wait)
                last_exc = RuntimeError(f"429 Rate limited on upload attempt {attempt}")
            else:
                last_exc = RuntimeError(f"Failed to upload PDF (status {resp.status_code}): {resp.text}")
                logger.debug("upload response: %s", resp.text)
        except Exception as e:
            last_exc = e
            logger.exception("upload attempt %d raised exception", attempt)

        sleep_time = 2 ** attempt
        logger.warning("attempt %d failed, retrying in %ds...", attempt, sleep_time)
        time.sleep(sleep_time)

    raise RuntimeError(f"Failed to upload PDF after retries: {last_exc}")


def upload_json_to_supabase(json_bytes: bytes, object_name: str):
    """
    Upload JSON to Supabase with simple retries and 429 handling.
    URL-encodes object paths.
    """
    ensure_supabase_env()
    encoded = _encode_object_name(object_name)
    storage_url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{encoded}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "x-upsert": "true",
    }

    logger.info("Uploading JSON (%d bytes) to Supabase as %s", len(json_bytes), object_name)
    last_exc = None
    for attempt in range(1, 4):
        try:
            resp = HTTP_SESSION.post(storage_url, headers=headers, data=json_bytes, timeout=JSON_UPLOAD_TIMEOUT)
            if resp.ok:
                time.sleep(PER_UPLOAD_DELAY + random.uniform(0, 0.2))
                return
            elif resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", "5"))
                logger.info("attempt %d: hit 429, sleeping %ds then retrying", attempt, wait)
                time.sleep(wait)
                last_exc = RuntimeError("429 Rate limited on JSON upload")
            else:
                last_exc = RuntimeError(f"Failed to upload JSON (status {resp.status_code}): {resp.text}")
                logger.debug("json upload response: %s", resp.text)
        except Exception as e:
            last_exc = e
            logger.exception("JSON upload attempt %d exception", attempt)

        sleep_time = 2 ** attempt
        logger.warning("attempt %d failed, retrying in %ds...", attempt, sleep_time)
        time.sleep(sleep_time)

    raise RuntimeError(f"Failed to upload JSON after retries: {last_exc}")


def main():
    # ensure local metadata directory exists
    os.makedirs(DAILY_DATA_DIR, exist_ok=True)

    target_date = get_target_date()
    logger.info("Target date (yesterday) = %s", target_date)

    # Use the resilient run wrapper (auto-restart on Playwright/browser errors)
    bids = _run_scrape_with_retries(target_date)
    logger.info("TOTAL RA-free bids for %s: %d", target_date, len(bids))

    # Add scraped_at to each bid (UTC) for traceability
    scraped_at = datetime.utcnow().isoformat() + "Z"
    for b in bids:
        b["scraped_at"] = scraped_at

    # Serialize metadata JSON (add top-level metadata: scraped_at and record_count)
    payload = {
        "scraped_at": scraped_at,  # ISO timestamp for the entire run
        "record_count": len(bids),  # number of bid records included
        "bids": bids,  # list of bid dicts (each already has scraped_at field)
    }
    json_str = json.dumps(payload, ensure_ascii=False, indent=2)

    date_str = target_date.strftime("%Y-%m-%d")
    meta_filename = f"gem_bids_{date_str}_no_ra_meta.json"

    # Save metadata into ./daily_data/
    meta_path = os.path.join(DAILY_DATA_DIR, meta_filename)
    with open(meta_path, "w", encoding="utf-8") as f:
        f.write(json_str)
    logger.info("Saved metadata locally as %s", meta_path)

    # Also upload the metadata JSON to Supabase storage under 'daily_json_files/{date}/'
    try:
        object_name = f"daily_meta/{date_str}/{meta_filename}"
        upload_json_to_supabase(json_str.encode("utf-8"), object_name)
        logger.info("Uploaded metadata JSON to Supabase as %s", object_name)
    except Exception as e:
        logger.warning("failed to upload metadata JSON to Supabase: %s", e)

    # Download + upload PDFs and per-bid JSONs
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
        # final path in bucket: bids/{date}/GeM_011225_B_6950285.pdf
        object_name = f"bids/{date_str}/{filename}"

        try:
            pdf_bytes = download_pdf(detail_url)
            uploaded, sha = upload_pdf_to_supabase(pdf_bytes, object_name)
        except Exception:
            logger.exception("ERROR for %s when downloading/uploading PDF", bid_no)
            uploaded = False
            sha = None

        # Create and upload per-bid JSON metadata (so backfill can match easily)
        try:
            per_bid_meta = dict(bid)  # shallow copy of the parsed bid dict (includes scraped_at)
            per_bid_meta["pdf_storage_path"] = object_name
            per_bid_meta["pdf_sha256"] = sha
            per_bid_meta["pdf_uploaded"] = bool(uploaded)
            per_bid_json_name = f"{os.path.splitext(filename)[0]}.json"
            per_bid_object = f"daily_json_files/{date_str}/{per_bid_json_name}"
            upload_json_to_supabase(json.dumps(per_bid_meta, ensure_ascii=False).encode("utf-8"), per_bid_object)
            logger.info("Uploaded per-bid JSON to Supabase as %s", per_bid_object)
        except Exception:
            logger.exception("failed to upload per-bid JSON for %s", bid_no)

    logger.info("All done.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.warning("Interrupted by user; exiting.")
    except Exception:
        logger.exception("Unhandled exception in main()")
        raise
