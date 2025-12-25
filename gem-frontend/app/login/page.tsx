'use client';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

import { useState, useMemo, useRef, useEffect } from 'react';
import type { Subscription } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-client';
import { Loader2, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();

  // ✅ Supabase client must only be created in the browser
  const supabase = useMemo(() => {
    if (typeof window !== 'undefined') {
      return createClient();
    }
    return null; // during prerender this prevents the crash
  }, []);

  const authListenerRef = useRef<Subscription | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      authListenerRef.current?.unsubscribe();
      authListenerRef.current = null;
    };
  }, []);

  const handleEmailLogin = async () => {
    if (!supabase || loading) return;

    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    authListenerRef.current = supabase.auth.onAuthStateChange((event: string, session) => {
      if (event === 'SIGNED_IN' && session) {
        authListenerRef.current?.unsubscribe();
        authListenerRef.current = null;
        router.replace('/dashboard');
      }
    });
  };


  const handleGoogleLogin = async () => {
    if (!supabase) return; // SSR safety
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) setError(error.message);
  };

  return (
    <div className="fixed inset-0 bg-[#0E121A] flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-[32px] p-8 shadow-2xl">

          {/* Header */}
          <div className="mb-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-[#F7C846] rounded-2xl mb-4">
              <span className="text-2xl font-bold text-[#0E121A]">TM</span>
            </div>
            <h1 className="text-3xl font-bold text-[#0E121A] mb-2">TenderMatch</h1>
            <p className="text-gray-600 text-sm">Welcome back! Sign in to continue</p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 p-4 bg-[#FC574E]/10 border-2 border-[#FC574E]/20 rounded-2xl">
              <p className="text-sm text-[#FC574E]">{error}</p>
            </div>
          )}

          {/* LOGIN FORM */}
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-[#0E121A] mb-2">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleEmailLogin()}
                className="w-full px-4 py-3.5 bg-[#F0F0F0] rounded-2xl"
                placeholder="you@example.com"
                disabled={loading}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#0E121A] mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleEmailLogin()}
                  className="w-full px-4 py-3.5 pr-12 bg-[#F0F0F0] rounded-2xl"
                  placeholder="Enter your password"
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <label className="flex items-center">
                <input type="checkbox" className="w-4 h-4" disabled={loading} />
                <span className="ml-2 text-sm text-gray-700">Remember me</span>
              </label>
              <Link href="/forgot-password" className="text-sm font-semibold">Forgot password?</Link>
            </div>

            <button
              type="button"
              onClick={handleEmailLogin}
              disabled={loading}
              className="w-full py-4 px-6 bg-[#F7C846] text-[#0E121A] rounded-2xl"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin inline" /> : 'Sign in'}
            </button>
          </div>

          {/* Divider */}
          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white text-gray-500">Or continue with</span>
            </div>
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-[#F0F0F0] rounded-2xl"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">...</svg>
            <span className="font-semibold text-[#0E121A]">Continue with Google</span>
          </button>

          <p className="text-center text-sm text-gray-600 mt-8">
            Don’t have an account?{' '}
            <Link href="/signup" className="font-bold">Create account</Link>
          </p>
        </div>

        <p className="text-center text-xs text-white/50 mt-6">
          By signing in, you agree to our Terms & Privacy Policy
        </p>
      </div>
    </div>
  );
}
