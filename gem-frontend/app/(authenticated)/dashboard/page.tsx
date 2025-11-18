'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { Loader2, FileText, CheckCircle, Clock, XCircle, TrendingUp, DollarSign, Eye } from 'lucide-react';

interface TenderRow {
  id: number;
  status?: string;
  estimated_value?: number | string | null;
}

interface DashboardStats {
  totalTenders: number;
  activeTenders: number;
  wonTenders: number;
  lostTenders: number;
  pendingReview: number;
  totalValue: number;
  winRate: number;
  avgResponseTime: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    totalTenders: 0,
    activeTenders: 0,
    wonTenders: 0,
    lostTenders: 0,
    pendingReview: 0,
    totalValue: 0,
    winRate: 0,
    avgResponseTime: 0,
  });

  useEffect(() => {
    let mounted = true;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const {  userData, error: userErr } = await supabase.auth.getUser();
        
        if (userErr) {
          console.error('getUser error:', userErr);
        }

        const currentUser = userData?.user ?? null;

        if (!currentUser) {
          router.replace('/login');
          return;
        }

        if (!mounted) return;
        setUser({ email: (currentUser as any).email });

        // Fetch tenders
        const {  tendersData, error: tendersError } = await supabase
          .from<TenderRow>('tenders')
          .select('*');

        if (tendersError) {
          console.error('tenders query error:', tendersError);
          setError('Failed to load tenders.');
          return;
        }

        const tenders = tendersData ?? [];

        // Calculate stats
        const total = tenders.length;
        const active = tenders.filter(t => {
          const s = (t.status ?? '').toLowerCase();
          return s === 'active' || s === 'open';
        }).length;
        const won = tenders.filter(t => (t.status ?? '').toLowerCase() === 'won').length;
        const lost = tenders.filter(t => (t.status ?? '').toLowerCase() === 'lost').length;
        const pending = tenders.filter(t => (t.status ?? '').toLowerCase() === 'pending').length;

        const totalVal = tenders.reduce((sum, t) => {
          const v = Number(t.estimated_value ?? 0) || 0;
          return sum + v;
        }, 0);

        const completedTenders = won + lost;
        const winRate = completedTenders > 0 ? (won / completedTenders) * 100 : 0;

        if (!mounted) return;
        setStats({
          totalTenders: total,
          activeTenders: active,
          wonTenders: won,
          lostTenders: lost,
          pendingReview: pending,
          totalValue: totalVal,
          winRate,
          avgResponseTime: 3.5,
        });
      } catch (err: any) {
        console.error('Dashboard fetch error:', err);
        setError(err?.message ?? 'Unexpected error');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchData();

    return () => {
      mounted = false;
    };
  }, [router, supabase]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F5F7]">
        <div className="mb-6">
          <div className="h-6 w-48 bg-gray-200 rounded animate-pulse"></div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="bg-white rounded-[24px] p-6 shadow-lg">
              <div className="h-12 w-12 bg-gray-200 rounded-xl mb-4 animate-pulse"></div>
              <div className="h-8 w-16 bg-gray-200 rounded mb-2 animate-pulse"></div>
              <div className="h-4 w-24 bg-gray-200 rounded animate-pulse"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F7]">
      {/* Simple Welcome Header */}
      <div className="mb-6">
        <p className="text-gray-600">Welcome back, {user?.email}!</p>
      </div>

      {/* Show error if exists */}
      {error && (
        <div className="mb-6 p-4 bg-[#FC574E]/10 border-2 border-[#FC574E]/20 rounded-2xl">
          <p className="text-sm text-[#FC574E]">{error}</p>
        </div>
      )}

      {/* Stats Grid - 8 Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Total Tenders */}
        <div className="bg-white rounded-[24px] p-6 shadow-lg hover:shadow-xl transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-[#F7C846]/20 rounded-xl flex items-center justify-center">
              <FileText className="w-6 h-6 text-[#F7C846]" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-[#0E121A] mb-1">{stats.totalTenders}</h3>
          <p className="text-sm text-gray-600">Total Tenders</p>
        </div>

        {/* Active Tenders */}
        <div className="bg-white rounded-[24px] p-6 shadow-lg hover:shadow-xl transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center">
              <Clock className="w-6 h-6 text-blue-500" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-[#0E121A] mb-1">{stats.activeTenders}</h3>
          <p className="text-sm text-gray-600">Active Tenders</p>
        </div>

        {/* Won Tenders */}
        <div className="bg-white rounded-[24px] p-6 shadow-lg hover:shadow-xl transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-[#8AE98D]/20 rounded-xl flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-[#8AE98D]" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-[#0E121A] mb-1">{stats.wonTenders}</h3>
          <p className="text-sm text-gray-600">Won Tenders</p>
        </div>

        {/* Lost Tenders */}
        <div className="bg-white rounded-[24px] p-6 shadow-lg hover:shadow-xl transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-[#FC574E]/20 rounded-xl flex items-center justify-center">
              <XCircle className="w-6 h-6 text-[#FC574E]" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-[#0E121A] mb-1">{stats.lostTenders}</h3>
          <p className="text-sm text-gray-600">Lost Tenders</p>
        </div>

        {/* Pending Review */}
        <div className="bg-white rounded-[24px] p-6 shadow-lg hover:shadow-xl transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-orange-500/20 rounded-xl flex items-center justify-center">
              <Eye className="w-6 h-6 text-orange-500" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-[#0E121A] mb-1">{stats.pendingReview}</h3>
          <p className="text-sm text-gray-600">Pending Review</p>
        </div>

        {/* Total Value */}
        <div className="bg-white rounded-[24px] p-6 shadow-lg hover:shadow-xl transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-green-500/20 rounded-xl flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-green-500" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-[#0E121A] mb-1">₹{(stats.totalValue / 100000).toFixed(1)}L</h3>
          <p className="text-sm text-gray-600">Total Value</p>
        </div>

        {/* Win Rate */}
        <div className="bg-white rounded-[24px] p-6 shadow-lg hover:shadow-xl transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-purple-500" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-[#0E121A] mb-1">{stats.winRate.toFixed(1)}%</h3>
          <p className="text-sm text-gray-600">Win Rate</p>
        </div>

        {/* Avg Response Time */}
        <div className="bg-white rounded-[24px] p-6 shadow-lg hover:shadow-xl transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-cyan-500/20 rounded-xl flex items-center justify-center">
              <Clock className="w-6 h-6 text-cyan-500" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-[#0E121A] mb-1">{stats.avgResponseTime} days</h3>
          <p className="text-sm text-gray-600">Avg Response Time</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-[24px] p-6 shadow-lg mb-8">
        <h2 className="text-xl font-bold text-[#0E121A] mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => router.push('/tenders')}
            className="py-4 px-6 bg-[#F7C846] text-[#0E121A] font-bold rounded-2xl hover:bg-[#F7C846]/90 transition-all"
          >
            View All Tenders
          </button>
          <button className="py-4 px-6 bg-[#8AE98D] text-[#0E121A] font-bold rounded-2xl hover:bg-[#8AE98D]/90 transition-all">
            Upload Catalogue
          </button>
          <button className="py-4 px-6 bg-blue-500 text-white font-bold rounded-2xl hover:bg-blue-600 transition-all">
            Generate Report
          </button>
        </div>
      </div>
    </div>
  );
}
