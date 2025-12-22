import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tenderId = Number(body?.tenderId);

    if (!tenderId || Number.isNaN(tenderId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid tenderId' },
        { status: 400 }
      );
    }

    // ✅ FIX: await the async helper
    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase
      .from('tender_documents')
      .select(
        `
        id,
        url,
        filename,
        source,
        order_index,
        created_at
        `
      )
      .eq('tender_id', tenderId)
      .order('order_index', { ascending: true });

    if (error) {
      console.error('tender-documents query failed:', error);
      return NextResponse.json(
        { success: false, error: 'Database query failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      documents: data ?? [],
    });
  } catch (err) {
    console.error('tender-documents API error FULL:', err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}
