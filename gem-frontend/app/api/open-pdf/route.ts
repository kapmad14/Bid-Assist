import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json(
      { error: "Missing url param" },
      { status: 400 }
    );
  }

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
      ],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/114.0 Safari/537.36",
    });

    const page = await context.newPage();

    // Important: directly go to the GeM PDF URL
    const response = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    if (!response) {
      throw new Error("No response from GeM");
    }

    const buffer = await response.body(); // Node Buffer

    await browser.close();

    // 🔥 FIX: convert Buffer → Uint8Array (Next.js friendly)
    const pdfBytes = new Uint8Array(buffer);

    return new NextResponse(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=gem.pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    if (browser) await browser.close();

    console.error("open-pdf error:", err);

    return NextResponse.json(
      {
        error: "fetch failed",
        detail: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}
