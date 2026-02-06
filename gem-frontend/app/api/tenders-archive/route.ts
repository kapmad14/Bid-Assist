import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Lazy init (safe for Vercel builds)
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
      { hasArchive: false, pdf_public_url: null, error: "missing_bid" },
      { status: 400 }
    );
  }

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err: any) {
    console.error("Supabase env error:", err.message);
    return NextResponse.json(
      { hasArchive: false, pdf_public_url: null, error: "env_error" },
      { status: 500 }
    );
  }

  try {
    const res = await supabase
      .from("tenders_archive")
      .select("pdf_public_url")
      .eq("bid_number", bid)
      .single();

    // No row OR no stored URL
    if (res.error || !res.data?.pdf_public_url) {
      return NextResponse.json({
        hasArchive: false,
        pdf_public_url: null,
      });
    }

    // Row exists with a stored URL
    return NextResponse.json({
      hasArchive: true,
      pdf_public_url: res.data.pdf_public_url,
    });

  } catch (err) {
    console.error("Supabase archive lookup failed:", err);
    return NextResponse.json(
      { hasArchive: false, pdf_public_url: null, error: "supabase_error" },
      { status: 500 }
    );
  }
}
