// app/api/catalogue/categories/route.ts

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createServerSupabaseClient();

  // ✅ Get logged-in user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // ✅ Fetch ACTIVE catalogue categories only
  const { data, error } = await supabase
    .from("catalog_items")
    .select("category")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  // ✅ Extract unique categories
  const categories = Array.from(
    new Set((data ?? []).map((r) => r.category).filter(Boolean))
  );

  return NextResponse.json({ categories });
}
