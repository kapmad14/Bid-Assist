import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// --- Lazy initializer (VERY IMPORTANT for Vercel builds) ---
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment"
    );
  }

  return createClient(url, key);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bid = searchParams.get("bid");

  if (!bid) {
    return NextResponse.json(
      { error: "Missing bid number" },
      { status: 400 }
    );
  }

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err: any) {
    console.error("Supabase env error:", err.message);
    return NextResponse.json(
      { pdf_public_url: null, found: false, error: "env_error" },
      { status: 500 }
    );
  }

  try {
    const res = await supabase
      .from("tenders_archive")
      .select("pdf_public_url")
      .eq("bid_number", bid)
      .single();

    // If no row or no URL → clean 404
    if (res.error || !res.data?.pdf_public_url) {
      return NextResponse.json(
        { pdf_public_url: null, found: false },
        { status: 404 }
      );
    }

    return NextResponse.json({
      pdf_public_url: res.data.pdf_public_url,
      found: true,
    });

  } catch (err) {
    console.error("Supabase archive lookup failed:", err);
    return NextResponse.json(
      { pdf_public_url: null, found: false, error: "supabase_error" },
      { status: 500 }
    );
  }
}
