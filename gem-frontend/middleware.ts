import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // Start with a single response object we can mutate
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Create a cookies bridge for supabase SSR client
  const supabase = createServerClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
            return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
            });
  },
}

    }
  );

  // NOTE: correct destructuring for getUser()
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const user = session?.user ?? null;


  // Debugging (remove in production)
  // console.log('middleware user:', user, 'error:', error);

  const path = request.nextUrl.pathname;

  // Protect routes — redirect to login if not authenticated
const isProtectedRoute =
  path.startsWith('/dashboard') ||
  path.startsWith('/tenders') ||
  path.startsWith('/catalog') ||
  path.startsWith('/results') ||
  path.startsWith('/analytics') ||
  path.startsWith('/help');    

  if (!user && isProtectedRoute) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // If already logged in, prevent access to auth pages
  if (user && (path === '/login' || path === '/signup')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Return the response (possibly with cookies set by supabase)
  return response;
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/tenders/:path*',
    '/catalog/:path*',
    '/results/:path*',
    '/analytics/:path*',
    '/help/:path*',
    '/login',
    '/signup'
  ],
};
