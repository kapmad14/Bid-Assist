import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET() {
  // ✅ Must await because your helper is async
  const supabase = await createServerSupabaseClient();

  // ✅ Get logged-in user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // ✅ Count shortlisted tenders for this user
  const { count, error } = await supabase
    .from("user_shortlists")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  return NextResponse.json({
    count: count ?? 0,
  });
}
