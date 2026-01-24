import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const type = searchParams.get("type"); // ministry | department | seller
  const q = searchParams.get("q") || "";

  // ✅ Only start after 2 characters
  if (!type || q.trim().length < 2) {
    return NextResponse.json({ options: [] });
  }

  const supabase = await createServerSupabaseClient();

  // ✅ Column mapping (only for ministry/department)
  let column: string | null = null;

  if (type === "ministry") column = "ministry";
  if (type === "department") column = "department";

  let data: any[] = [];
  let error: any = null;

  // ✅ SELLER CASE (L1/L2/L3)
  if (type === "seller") {
    const res = await supabase
      .from("gem_results")
      .select("l1_seller, l2_seller, l3_seller")
      .eq("extraction_status", "success")
      .or(
        `l1_seller.ilike.%${q}%,l2_seller.ilike.%${q}%,l3_seller.ilike.%${q}%`
      )
      .limit(12);

    data = res.data ?? [];
    error = res.error;
  }

  // ✅ MINISTRY / DEPARTMENT CASE
  else if (column) {
    const res = await supabase
      .from("gem_results")
      .select(column)
      .eq("extraction_status", "success")
      .ilike(column, `%${q}%`)
      .limit(8);

    data = res.data ?? [];
    error = res.error;
  }

  // ✅ Invalid type fallback
  else {
    return NextResponse.json({ options: [] });
  }

  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  // ✅ Clean unique options
  let options: string[] = [];

  if (type === "seller") {
    const query = q.toLowerCase();

    options = Array.from(
    new Set(
        data.flatMap((r: any) =>
        [r.l1_seller, r.l2_seller, r.l3_seller].filter(Boolean)
        )
    )
    )
    // ✅ Only keep matches
    .filter((s) => s.toLowerCase().includes(query))

    // ✅ Rank: startsWith first
    .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(query);
        const bStarts = b.toLowerCase().startsWith(query);

        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        return a.localeCompare(b); // fallback alphabetical
    })

    // ✅ Only top 8
    .slice(0, 8);

  } else {
    options = Array.from(
      new Set(data.map((r: any) => r[column!]).filter(Boolean))
    ).slice(0, 8);
  }

  return NextResponse.json({ options });
}
