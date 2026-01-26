import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            // ✅ Correct: Only mutate response cookies
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // ✅ Most reliable in middleware
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  const isProtectedRoute =
    path.startsWith("/dashboard") ||
    path.startsWith("/tenders") ||
    path.startsWith("/catalog") ||
    path.startsWith("/results") ||
    path.startsWith("/analytics") ||
    path.startsWith("/help");

  // ✅ Redirect if not authenticated
  if (!user && isProtectedRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // ✅ Prevent auth pages if logged in
  if (user && (path === "/login" || path === "/signup")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/tenders/:path*",
    "/catalog/:path*",
    "/results/:path*",
    "/analytics/:path*",
    "/help/:path*",
    "/login",
    "/signup",
  ],
};
