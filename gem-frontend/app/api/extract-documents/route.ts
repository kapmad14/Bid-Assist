import { NextRequest, NextResponse } from "next/server";

const EXTRACTOR_URL =
  process.env.EXTRACTOR_URL || "http://localhost:5001";

export async function POST(request: NextRequest) {
  try {
    const { tenderId } = await request.json();

    const response = await fetch(`${EXTRACTOR_URL}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenderId }),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });

  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
