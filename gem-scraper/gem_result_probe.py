from playwright.sync_api import sync_playwright
import re, time

URL = "https://bidplus.gem.gov.in/bidding/bid/getBidResultView/8650038"  # use any real bid url

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context()
        page = ctx.new_page()

        print("\n--- NETWORK TRACE ---\n")

        def on_request(req):
            if "evaluation" in req.url.lower():
                print("➡️  REQ:", req.method, req.url)

        def on_response(res):
            if "evaluation" in res.url.lower() or "getBid" in res.url:
                try:
                    print("⬅️  RES:", res.status, res.url)
                    txt = res.text()
                    print("    ⤷ size:", len(txt))
                    if "<table" in txt:
                        print("    ⤷ HTML TABLE FOUND")
                except:
                    pass

        page.on("request", on_request)
        page.on("response", on_response)

        page.goto(URL, wait_until="networkidle")

        print("\n--- DOM SNAPSHOT ---\n")
        print(page.content()[:2000])

        input("\nPress ENTER to close...")
        browser.close()

if __name__ == "__main__":
    main()
