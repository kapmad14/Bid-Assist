import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createServerSupabaseClient();

  // Only from SUCCESS rows
  const baseQuery = supabase
    .from("gem_results")
    .select("ministry, department, l1_seller, l2_seller, l3_seller")
    .eq("extraction_status", "success");

  const { data, error } = await baseQuery;

  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  const ministries = Array.from(
    new Set(data.map(r => r.ministry).filter(Boolean))
  ).sort();

  const departments = Array.from(
    new Set(data.map(r => r.department).filter(Boolean))
  ).sort();

  const sellers = Array.from(
    new Set(
      data.flatMap(r =>
        [r.l1_seller, r.l2_seller, r.l3_seller].filter(Boolean)
      )
    )
  ).sort();

  return NextResponse.json({
    ministries,
    departments,
    sellers,
  });
}
