import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return new Response("Missing url", { status: 400 });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7",
        "Accept": "application/pdf",
        "Referer": "https://bidplus.gem.gov.in/",
      },
    });

    if (!upstream.ok) {
      return new Response(`Upstream error: ${upstream.status}`, { status: 500 });
    }

    // ✅ STREAM the PDF instead of loading whole thing into memory
    const stream = upstream.body;

    return new Response(stream, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=gem_document.pdf",
        "Cache-Control": "no-store",
      },
    });

  } catch (err) {
    console.error("PDF proxy failed:", err);
    return new Response("Failed to fetch PDF", { status: 500 });
  }
}
