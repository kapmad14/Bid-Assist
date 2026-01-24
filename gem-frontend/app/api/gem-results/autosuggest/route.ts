import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET(req: Request) {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("gem_results")
    .select("ministry, department")
    .eq("extraction_status", "success");

  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  const rows = (data ?? []) as {
    ministry: string | null;
    department: string | null;
  }[];

  const ministries = Array.from(
    new Set(rows.map(r => r.ministry).filter(Boolean))
  );

  const departments = Array.from(
    new Set(rows.map(r => r.department).filter(Boolean))
  );

  return NextResponse.json({
    ministries,
    departments,
  });
}
