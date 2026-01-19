import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json(
      { error: "Missing url parameter" },
      { status: 400 }
    );
  }

  try {
    console.log("Fetching PDF from:", url);

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/114.0 Safari/537.36",
      },
      timeout: 30000,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Upstream error:", res.status, text);

      return NextResponse.json(
        { error: "Upstream fetch failed", status: res.status, body: text },
        { status: 500 }
      );
    }

    const arrayBuffer = await res.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=gem.pdf",
      },
    });
  } catch (err: any) {
    console.error("Server error:", err);

    return NextResponse.json(
      {
        error: "fetch failed",
        detail: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}
