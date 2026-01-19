import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json(
      { error: "Missing url param" },
      { status: 400 }
    );
  }

  try {
    // Mimic your scraper’s browser headers
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/114.0 Safari/537.36",
        "Accept": "application/pdf, application/octet-stream",
      },
    });

    if (!res.ok) {
      throw new Error(`GeM returned ${res.status}`);
    }

    const buffer = await res.arrayBuffer();
    const pdfBytes = new Uint8Array(buffer);

    return new NextResponse(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=gem.pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
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
