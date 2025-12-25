'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0E121A] to-[#1a1f2e]">
      {/* Simple Header */}
      <header className="fixed top-0 w-full bg-[#0E121A]/80 backdrop-blur-md border-b border-white/10 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="px-3 py-2 bg-[#F7C846] text-[#0E121A] font-bold text-sm rounded">
              TENDER
            </div>
            <span className="font-bold text-white text-sm">MATCH</span>
          </div>
          
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/login')}
                className="w-[96px] px-0 py-2.5 bg-[#F7C846] text-[#0E121A] font-semibold rounded-xl
                          hover:bg-[#F7C846]/90 transition-all text-center"
              >
                Login
              </button>

              <button
                onClick={() => router.push('/signup')}
                className="w-[96px] px-0 py-2.5 bg-white text-[#0E121A] font-semibold rounded-xl
                          border border-white/60
                          hover:bg-white hover:border-[#F7C846]
                          hover:shadow-[0_0_0_2px_rgba(247,200,70,0.35)]
                          transition-all text-center"
              >
                Sign Up
              </button>

            </div>

        </div>
      </header>

      {/* Hero Section */}
      <div className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-6xl font-bold text-white mb-6 leading-tight">
            Win More Tenders with{' '}
            <span className="text-[#F7C846] whitespace-nowrap">Data-Powered</span> Insights
          </h1>
          <p className="text-xl text-[#F0F0F0]/70 mb-10 max-w-2xl mx-auto">
            Analyze competitors, match your catalogue, and never miss a tender opportunity.
            Built specifically for the Indian GEM marketplace.
          </p>
          
          <button
            onClick={() => router.push('/login')}
            className="group inline-flex items-center gap-3 px-8 py-4 bg-[#F7C846] text-[#0E121A] font-bold text-lg rounded-2xl hover:bg-[#F7C846]/90 transform hover:scale-105 transition-all shadow-[0_8px_24px_rgba(247,200,70,0.4)]"
          >
            Get Started
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        {/* Features Grid */}
        <div className="max-w-6xl mx-auto mt-20 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
            <div className="w-12 h-12 bg-[#F7C846]/20 rounded-xl flex items-center justify-center mb-4">
              <span className="text-2xl">🎯</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Smart Matching</h3>
            <p className="text-[#F0F0F0]/60">
              Automatically match tenders with your product catalogue using AI
            </p>
          </div>

          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
            <div className="w-12 h-12 bg-[#8AE98D]/20 rounded-xl flex items-center justify-center mb-4">
              <span className="text-2xl">📊</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Competitor Analysis</h3>
            <p className="text-[#F0F0F0]/60">
              Track competitor bids and pricing to stay ahead
            </p>
          </div>

          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
            <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center mb-4">
              <span className="text-2xl">⚡</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Real-time Alerts</h3>
            <p className="text-[#F0F0F0]/60">
              Get notified instantly when relevant tenders are published
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
