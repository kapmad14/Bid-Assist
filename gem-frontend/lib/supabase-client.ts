import { createBrowserClient } from '@supabase/ssr';

let browserClient: any = null;

export function createClient() {
  if (typeof window === 'undefined') {
    throw new Error(
      'createClient() was called on the server. Use the server Supabase helper instead.'
    );
  }

  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          flowType: 'pkce',          // 🔑 REQUIRED
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }
    );
  }

  return browserClient;
}
