// app/api/match-jobs/route.ts
import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { cookies as nextCookies } from "next/headers";

/**
 * Server-only admin client (uses service-role key).
 * Ensure SUPABASE_SERVICE_ROLE_KEY is set in your environment (never expose this to the browser).
 */
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/**
 * Allowed actions for safety
 */
const ALLOWED_ACTIONS = new Set(["create", "update", "pause", "resume", "delete"]);

/**
 * Try to get an authenticated user in two ways:
 * 1) Cookie-based session
 * 2) Authorization: Bearer <access_token> header
 */
async function requireAuthUser(req: NextRequest) {
  try {
    // 1) Cookie-based session using auth-helpers
    // Inside requireAuthUser()
    const supabaseClient = createRouteHandlerClient({ cookies: () => nextCookies() });
    const { data: cookieUserData, error: cookieErr } =
    await supabaseClient.auth.getUser();
    if (!cookieErr && cookieUserData?.user) {
    return cookieUserData.user;
    }

  } catch (e) {
    // ignore and try fallback
  }

  // 2) Bearer token fallback
  try {
    const authHeader =
      req.headers.get("authorization") || req.headers.get("Authorization");

    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.substring(7).trim();
      if (token) {
        const { data: userData, error: tokenErr } =
          await supabaseAdmin.auth.getUser(token);

        if (!tokenErr && userData?.user) {
          return userData.user;
        } else {
          console.error("Token verify error:", tokenErr);
        }
      }
    }
  } catch (e) {
    console.error("Bearer token auth error:", e);
  }

  throw new Error("Not authenticated");
}

/**
 * POST handler: create match job(s)
 */
export async function POST(req: NextRequest) {
  try {
    // Authenticate caller
    const user = await requireAuthUser(req);
    if (!user || !user.id) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    // Parse body
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const { action, catalog_item_id, catalog_item_ids, payload } = body;

    if (!action || typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    }

    // Normalize ids
    const ids: string[] = [];
    if (catalog_item_id && typeof catalog_item_id === "string") ids.push(catalog_item_id);

    if (Array.isArray(catalog_item_ids)) {
      for (const v of catalog_item_ids) {
        if (typeof v === "string") ids.push(v);
      }
    }

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "no_catalog_item_ids_provided" },
        { status: 400 }
      );
    }

    // SECURITY: Verify ownership
    const { data: ownedRows, error: fetchErr } = await supabaseAdmin
      .from("catalog_items")
      .select("id")
      .in("id", ids)
      .eq("user_id", user.id);

    if (fetchErr) {
      console.error("Error checking ownership:", fetchErr);
      return NextResponse.json({ error: "internal_fetch_error" }, { status: 500 });
    }

    const ownedIds = new Set((ownedRows || []).map((r: any) => r.id));
    const notOwned = ids.filter((i) => !ownedIds.has(i));

    if (notOwned.length > 0) {
      return NextResponse.json(
        { error: "forbidden: you do not own some items", notOwned },
        { status: 403 }
      );
    }

    // Build job rows
    const jobsToInsert = ids.map((cid) => ({
      user_id: user.id,
      catalog_item_id: cid,
      action,
      payload: payload || null,
      status: "pending",
    }));

    const { data: insertData, error: insertErr } = await supabaseAdmin
      .from("match_jobs")
      .insert(jobsToInsert)
      .select();

    if (insertErr) {
      console.error("Error inserting match_jobs:", insertErr);
      return NextResponse.json(
        { error: "failed_to_create_jobs" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, jobs: insertData }, { status: 200 });
  } catch (err: any) {
    console.error("match-jobs POST error:", err?.message || err);
    const message = err?.message || "server_error";
    const status = message === "Not authenticated" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
