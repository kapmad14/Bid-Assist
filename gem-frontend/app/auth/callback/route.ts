import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  // ✅ Invalid callback → send user to login
  if (!code) {
    return NextResponse.redirect(new URL("/login", requestUrl.origin));
  }

  // ✅ Response object used for cookie writing
  let response = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  // ✅ This writes the session cookie correctly
  await supabase.auth.exchangeCodeForSession(code);

  // ✅ Redirect only AFTER cookies are written
  response = NextResponse.redirect(new URL("/dashboard", requestUrl.origin));
  return response;
}
