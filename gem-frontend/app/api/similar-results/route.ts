import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function POST(req: Request) {
  console.log("✅ /api/similar-results HIT");

  // ✅ Create Supabase client
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
    console.log("✅ Supabase client created");
  } catch (err) {
    console.log("❌ Supabase client creation failed:", err);
    return NextResponse.json(
      { success: false, error: "Supabase server client failed" },
      { status: 500 }
    );
  }

  // ✅ Ensure logged-in user
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    console.log("✅ AUTH CHECK:", user?.id ?? "NO USER");

    if (userError || !user) {
      console.log("❌ Unauthorized:", userError?.message);
      return new NextResponse("Unauthorized", { status: 401 });
    }
  } catch (err) {
    console.log("❌ Auth getUser crashed:", err);
    return NextResponse.json(
      { success: false, error: "Auth session crashed" },
      { status: 500 }
    );
  }

  // ✅ Parse JSON body safely
  let body: any = null;
  try {
    body = await req.json();
    console.log("✅ BODY RECEIVED:", body);
  } catch (err) {
    console.log("❌ Failed to parse JSON body:", err);
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // ✅ Extract values (never allow undefined/null)
  // ✅ These are already normalized KEY fields coming from client
  const tender_item_key = body?.tender_item_key ?? "";
  const tender_department_key = body?.tender_department_key ?? "";
  const tender_location_key = body?.tender_location_key ?? "";
  const tender_ministry_key = body?.tender_ministry_key ?? "";


  console.log("✅ INPUT KEYS:", {
    tender_item_key,
    tender_department_key,
    tender_location_key,
    tender_ministry_key,
  });

  // ✅ Hard stop if item_key is missing
  if (tender_item_key.trim().length < 3) {
    return NextResponse.json(
      { success: false, error: "Tender item key too short" },
      { status: 400 }
    );
  }


  // ✅ Run RPC safely
  let data = null;
  let error = null;

  try {
    const result = await supabase.rpc("search_similar_gem_results", {
    tender_item_key,
    tender_department_key,
    tender_location_key,
    tender_ministry_key,
    });


    data = result.data;
    error = result.error;

    console.log("✅ RPC ERROR:", error);
  } catch (err) {
    console.log("❌ RPC HARD CRASH:", err);

    return NextResponse.json(
      { success: false, error: "RPC crashed before returning" },
      { status: 500 }
    );
  }

  // ✅ If RPC returned error
  if (error) {
    console.log("❌ RPC FULL ERROR OBJECT:", error);

    return NextResponse.json(
      {
        success: false,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      },
      { status: 500 }
    );
  }


  // ✅ Success
  return NextResponse.json({
    success: true,
    results: data ?? [],
  });
}
