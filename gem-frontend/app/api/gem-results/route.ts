import { NextResponse } from "next/server";
import { getGemResultsServer } from "@/services/gemResultsStore.server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const page = Number(searchParams.get("page") ?? 1);
  const limit = Number(searchParams.get("limit") ?? 10);

  // NEW: read filters from URL
  const item = searchParams.get("item") || undefined;
  const ministry = searchParams.get("ministry") || undefined;
  const department = searchParams.get("department") || undefined;
  const seller = searchParams.get("seller") || undefined;

  try {
    const result = await getGemResultsServer({
      page,
      limit,
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

