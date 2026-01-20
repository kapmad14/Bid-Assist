import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bid = searchParams.get("bid");

  if (!bid) {
    return NextResponse.json(
      { error: "Missing bid number" },
      { status: 400 }
    );
  }

  let data, error;

  try {
    const res = await supabase
      .from("tenders_archive")
      .select("pdf_public_url")
      .eq("bid_number", bid)
      .single();

    data = res.data;
    error = res.error;
  } catch (err) {
    console.error("Supabase archive lookup failed:", err);
    return NextResponse.json(
      { pdf_public_url: null, found: false, error: "supabase_error" },
      { status: 500 }
    );
  }

  if (error || !data?.pdf_public_url) {
    return NextResponse.json(
      { pdf_public_url: null, found: false },
      { status: 404 }
    );
  }

  return NextResponse.json({
    pdf_public_url: data.pdf_public_url,
    found: true,
  });
}
