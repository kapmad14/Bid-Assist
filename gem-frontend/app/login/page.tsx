'use client';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-client';
import { Loader2, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {


  // ✅ Supabase client must only be created in the browser
  const supabase = useMemo(() => {
    if (typeof window !== 'undefined') {
      return createClient();
    }
    return null; // during prerender this prevents the crash
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    }
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
          <div className="mb-8 flex items-center gap-4">
            <div className="flex items-center justify-center w-16 h-16 bg-[#F7C846] rounded-2xl shrink-0">
              <span className="text-2xl font-bold text-[#0E121A]">TM</span>
            </div>

            <div className="flex flex-col">
              <h1 className="text-2xl font-bold text-[#0E121A] leading-tight">
                TenderMatch
              </h1>
              <p className="text-gray-600 text-sm">
                Welcome back! Sign in to continue
              </p>
            </div>
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
                className="w-full py-4 px-6 bg-[#F7C846] text-[#0E121A] font-bold rounded-2xl
                          hover:bg-[#F7C846]/90 transform hover:scale-[1.02] transition-all
                          shadow-[0_4px_12px_rgba(247,200,70,0.4)]
                          disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Signing in...
                  </span>
                ) : (
                  <span>Sign in</span>
                )}
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
              className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-[#F0F0F0] rounded-2xl
                        hover:bg-gray-200 transition-all shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>

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
