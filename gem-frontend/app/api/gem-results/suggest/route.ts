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

    // ✅ SELLER CASE (Dictionary Based)
    if (type === "seller") {
    const query = q.trim().toUpperCase();

    const res = await supabase
        .from("seller_dictionary")
        .select("seller_name")
        .ilike("seller_name", `${query}%`) // ✅ Prefix match only
        .order("l1_count", { ascending: false }) // ✅ Ranked sellers first
        .limit(8);

    if (res.error) {
        return new NextResponse(res.error.message, { status: 500 });
    }

    return NextResponse.json({
        options: res.data?.map((r) => r.seller_name) ?? [],
    });
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

    // ✅ Clean unique options (Ministry/Department only)
    const options = Array.from(
    new Set(data.map((r: any) => r[column!]).filter(Boolean))
    ).slice(0, 8);

    return NextResponse.json({ options });
}
