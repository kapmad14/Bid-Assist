import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return new Response("Missing url", { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    const buffer = await res.arrayBuffer();

    return new Response(buffer, {
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
