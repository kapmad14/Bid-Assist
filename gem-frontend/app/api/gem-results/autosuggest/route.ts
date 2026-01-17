import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET(req: Request) {
  const supabase = await createServerSupabaseClient();

  // Get distinct values for autosuggest
  const { data, error } = await supabase
    .from("gem_results")
    .select(`
      ministry,
      department,
      l1_seller,
      l2_seller,
      l3_seller
    `)
    .eq("extraction_status", "success");

  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  const rows = data ?? [];

  const ministries = Array.from(
    new Set(rows.map(r => r.ministry).filter(Boolean))
  );

  const departments = Array.from(
    new Set(rows.map(r => r.department).filter(Boolean))
  );

  const sellers = Array.from(
    new Set(
      rows.flatMap(r => [
        r.l1_seller,
        r.l2_seller,
        r.l3_seller
      ].filter(Boolean))
    )
  );

  return NextResponse.json({
    ministries,
    departments,
    sellers,
  });
}
