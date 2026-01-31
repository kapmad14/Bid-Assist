import { NextResponse } from "next/server";
import { getGemResultsServer } from "@/services/gemResultsStore.server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const page = Number(searchParams.get("page") ?? 1);
  const limit = Number(searchParams.get("limit") ?? 20);

  // Read filters from URL
  const bidRa = searchParams.get("bidRa") || undefined;
  const item = searchParams.get("item") || undefined;
  const ministry = searchParams.get("ministry") || undefined;
  const department = searchParams.get("department") || undefined;
  const seller = searchParams.get("seller") || undefined;
  const global = searchParams.get("global") || undefined;
  const catalogue = searchParams.getAll("catalogue");

  // ✅ Do NOT increase page size.
  // Keep normal pagination (20 per page)
  const effectiveLimit = limit;
  const effectivePage = page;


  try {
    const result = await getGemResultsServer({
      page: effectivePage,
      limit: effectiveLimit,
      global,
      catalogue: catalogue.length > 0 ? catalogue : undefined,
      bidRa,
      item,
      ministry,
      department,
      seller,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return new NextResponse(err?.message ?? "Server error", { status: 500 });
  }
}
