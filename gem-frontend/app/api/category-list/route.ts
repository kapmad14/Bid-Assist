import { NextResponse } from 'next/server';

// -------------------------------------
// In-memory category cache
// -------------------------------------
let categoryCache: string[] | null = null;
let categoryCacheTime = 0;
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

export async function GET() {
  try {
        // serve from cache if still fresh
    if (categoryCache && Date.now() - categoryCacheTime < CACHE_TTL_MS) {
      return NextResponse.json(
        { categories: categoryCache },
        { headers: { 'Cache-Control': 'public, max-age=3600' } }
      );
    }

    // 🔧 convert your drive share link to direct download
    const url =
      'https://drive.google.com/uc?export=download&id=1lTrKWZDaPO954P-VXMNz8-c5HkIYp6rh';

    const res = await fetch(url, { cache: 'no-store' });
    const text = await res.text();

    const lines = text.split('\n');

    if (lines.length < 2) {
      return NextResponse.json(
        { categories: [] },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // parse header row
    const headers = lines[0].split(',');
    const nameIndex = headers.findIndex(h => h.trim() === 'Name');

    if (nameIndex === -1) {
      return NextResponse.json(
        { categories: [] },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const categories: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const name = cols[nameIndex]?.trim();
      if (name) categories.push(name);
    }

    categoryCache = categories;
    categoryCacheTime = Date.now();

    return NextResponse.json(
      { categories },
      { headers: { 'Cache-Control': 'public, max-age=3600' } }
    );


  } catch (e) {
    console.error('category api error', e);
    return NextResponse.json(
        { categories: [] },
        { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
