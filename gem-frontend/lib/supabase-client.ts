import { createBrowserClient } from '@supabase/ssr';

let browserClient: any = null;

/**
 * Browser-only Supabase client.
 * 
 * IMPORTANT:
 * - This must never be called on the server.
 * - Server code should use the helper in `supabase-server.ts` instead.
 */
export function createClient() {
  if (typeof window === 'undefined') {
    throw new Error(
      'createClient() was called on the server. Use the server Supabase helper (supabase-server.ts) instead.'
    );
  }

  // Singleton pattern – reuse the same browser client
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }
    );
  }

  return browserClient;
}
