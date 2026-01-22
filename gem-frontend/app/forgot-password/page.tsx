'use client';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-client';
import { Loader2, ArrowLeft, Mail } from 'lucide-react';
import Image from 'next/image';


export default function ForgotPasswordPage() {
  // Prevent SSR crash: only create Supabase client in browser
  const supabase = useMemo(() => {
    if (typeof window !== 'undefined') {
      return createClient();
    }
    return null;
  }, []);

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!supabase) {
      setError('Supabase client not ready');
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="fixed inset-0 bg-[#0E121A] flex items-center justify-center p-4 z-50">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-[32px] p-8 shadow-2xl text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-[#F7C846]/20 rounded-full mb-6">
              <Mail className="w-10 h-10 text-[#F7C846]" />
            </div>
            <h2 className="text-2xl font-bold text-[#0E121A] mb-3">
              Check your email
            </h2>
            <p className="text-gray-600 mb-2">We've sent a password reset link to</p>
            <p className="font-semibold text-[#0E121A] mb-6">{email}</p>
            <p className="text-sm text-gray-500 mb-8">
              Click the link in the email to reset your password.
            </p>
            <Link href="/login">
              <button className="w-full py-4 px-6 bg-[#F7C846] text-[#0E121A] font-bold rounded-2xl hover:bg-[#F7C846]/90 transform hover:scale-[1.02] transition-all shadow-[0_4px_12px_rgba(247,200,70,0.4)]">
                Back to Login
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#0E121A] flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-[32px] p-8 shadow-2xl">
          
          {/* Header */}
          <div className="mb-8 flex flex-col items-center text-center gap-4">
            <div className="rounded-2xl overflow-hidden">
              <Image
                src="/logo/tenderbot-header.png"
                alt="tenderbot"
                height={48}
                width={220}
                priority
              />
            </div>

            <div>
              <h1 className="text-2xl font-bold text-[#0E121A] mb-1">
                Reset your password
              </h1>
              <p className="text-gray-600 text-sm">
                Enter your email to receive a reset link
              </p>
            </div>
          </div>


          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-[#FC574E]/10 border-2 border-[#FC574E]/20 rounded-2xl">
              <p className="text-sm text-[#FC574E]">{error}</p>
            </div>
          )}

          {/* Reset Form */}
          <form onSubmit={handleResetPassword} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-[#0E121A] mb-2">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3.5 bg-[#F0F0F0] border-0 rounded-2xl text-[#0E121A] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#F7C846] transition-all"
                placeholder="you@example.com"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 px-6 bg-[#F7C846] text-[#0E121A] font-bold rounded-2xl hover:bg-[#F7C846]/90 transform hover:scale-[1.02] transition-all shadow-[0_4px_12px_rgba(247,200,70,0.4)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Sending link...
                </span>
              ) : (
                'Send Reset Link'
              )}
            </button>
          </form>

          {/* Back to Login */}
          <div className="mt-8 text-center">
            <Link
              href="/login"
              className="inline-flex items-center text-sm font-semibold text-[#0E121A] hover:text-[#F7C846] transition-colors"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Login
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-[#F0F0F0]/50 mt-6">
          Remember your password? Sign in to continue
        </p>
      </div>
    </div>
  );
}
