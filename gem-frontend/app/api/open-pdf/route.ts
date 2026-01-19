import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/114.0",
    });

    const page = await context.newPage();

    // Open the GeM link like a real browser
    const response = await page.goto(url, { waitUntil: "networkidle" });

    // Download the PDF bytes from the page response
    const pdfBuffer = await response?.body();

    await browser.close();

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=gem.pdf",
      },
    });
  } catch (err: any) {
    console.error("Playwright open-pdf error:", err);
    await browser?.close();
    return NextResponse.json({ error: "playwright failed", detail: err.message }, { status: 500 });
  }
}
