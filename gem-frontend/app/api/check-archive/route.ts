// app/api/check-archive/route.ts
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
    return NextResponse.json({ found: false }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("tenders_archive")
    .select("pdf_public_url")
    .eq("bid_number", bid)
    .maybeSingle();   // <-- safer than .single()

  if (error || !data?.pdf_public_url) {
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({
    found: true,
    pdf_public_url: data.pdf_public_url,
  });
}
