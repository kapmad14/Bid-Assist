'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface DashboardStats {
  totalTenders: number;
  activeTenders: number;
  closingSoon: number;
  archived: number;
  recommended: number;
  shortlisted: number;
  catalogActive: number;
  catalogTotal: number;
}

// Dummy data for the chart – purely visual, not tied to real stats
const chartData = [
  { name: '1', published: 10, recommended: 6 },
  { name: '2', published: 11, recommended: 6 },
  { name: '3', published: 10, recommended: 6 },
  { name: '4', published: 11, recommended: 6 },
  { name: '5', published: 10, recommended: 6 },
];

export default function DashboardPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    totalTenders: 0,
    activeTenders: 0,
    closingSoon: 0,
    archived: 0,
    recommended: 0,
    shortlisted: 0,
    catalogActive: 0,
    catalogTotal: 0,
  });

  useEffect(() => {
    let mounted = true;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        // 1) Get current user
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr) {
          console.error('getUser error:', userErr);
        }

        const currentUser = userData?.user ?? null;
        if (!currentUser) {
          router.replace('/login');
          return;
        }

        if (!mounted) return;
        setUserEmail((currentUser as any).email ?? null);

        // Time boundaries for tender logic
        const now = new Date();
        const sevenDaysLater = new Date(
          now.getTime() + 7 * 24 * 60 * 60 * 1000,
        );

        const nowIso = now.toISOString();
        const sevenDaysLaterIso = sevenDaysLater.toISOString();

        // ======================= Queries ==========================
        const tendersTotalQuery = supabase
          .from('tenders')
          .select('id', { count: 'exact', head: true });

        const tendersActiveQuery = supabase
          .from('tenders')
          .select('id', { count: 'exact', head: true })
          .gt('bid_end_datetime', nowIso);

        const tendersClosingSoonQuery = supabase
          .from('tenders')
          .select('id', { count: 'exact', head: true })
          .gt('bid_end_datetime', nowIso)
          .lt('bid_end_datetime', sevenDaysLaterIso);

        const tendersArchivedQuery = supabase
          .from('tenders')
          .select('id', { count: 'exact', head: true })
          .lt('bid_end_datetime', nowIso);

        const recommendedQuery = supabase
          .from('recommendations')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', currentUser.id);

        const shortlistQuery = supabase
          .from('user_shortlists')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', currentUser.id);

        const catalogActiveQuery = supabase
          .from('catalog_items')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', currentUser.id)
          .eq('status', 'active');

        const catalogTotalQuery = supabase
          .from('catalog_items')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', currentUser.id);

        const [
          tendersTotalRes,
          tendersActiveRes,
          tendersClosingSoonRes,
          tendersArchivedRes,
          recommendedRes,
          shortlistRes,
          catalogActiveRes,
          catalogTotalRes,
        ] = await Promise.all([
          tendersTotalQuery,
          tendersActiveQuery,
          tendersClosingSoonQuery,
          tendersArchivedQuery,
          recommendedQuery,
          shortlistQuery,
          catalogActiveQuery,
          catalogTotalQuery,
        ]);

        const allErrors = [
          tendersTotalRes.error,
          tendersActiveRes.error,
          tendersClosingSoonRes.error,
          tendersArchivedRes.error,
          recommendedRes.error,
          shortlistRes.error,
          catalogActiveRes.error,
          catalogTotalRes.error,
        ].filter(Boolean);

        if (allErrors.length > 0) {
          console.error('Dashboard query errors:', allErrors);
          if (mounted) {
            setError('Some dashboard data could not be loaded.');
          }
        }

        if (!mounted) return;

        setStats({
          totalTenders: tendersTotalRes.count ?? 0,
          activeTenders: tendersActiveRes.count ?? 0,
          closingSoon: tendersClosingSoonRes.count ?? 0,
          archived: tendersArchivedRes.count ?? 0,
          recommended: recommendedRes.count ?? 0,
          shortlisted: shortlistRes.count ?? 0,
          catalogActive: catalogActiveRes.count ?? 0,
          catalogTotal: catalogTotalRes.count ?? 0,
        });
      } catch (err: any) {
        console.error('Dashboard fetch error:', err);
        if (mounted) {
          setError(err?.message ?? 'Unexpected error');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchData();

    return () => {
      mounted = false;
    };
  }, [router, supabase]);

  // ================== LOADING UI ====================
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] p-6">
        <div className="h-10 w-64 bg-gray-200 rounded-xl mb-6 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 7 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-3xl bg-white shadow-lg p-5 space-y-3 min-h-[140px]"
            >
              <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
              <div className="h-8 w-10 bg-gray-200 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ================== MAIN UI ====================
  return (
    <div className="min-h-screen bg-[#F5F5F7] p-6">

      {/* Top yellow header */}
      <div className="mb-6 rounded-3xl bg-[#F7C846] px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between shadow-md">
        <div>
          <h1 className="text-2xl font-bold text-black">Dashboard</h1>
          <p className="text-sm text-black/80">Plan, Prioritize and Accomplish with ease</p>
        </div>
        <div className="mt-3 sm:mt-0 text-sm text-black/80">
          Welcome back{userEmail ? `, ${userEmail}` : ''}!
        </div>
      </div>

      {/* 📌 CTA now triggers when catalogTotal < 4 */}
      {stats.catalogTotal < 4 && (
        <div className="mb-6 rounded-3xl bg-white p-5 shadow-lg border border-black/5">
          <p className="font-bold text-lg mb-1 text-black">Quick Start Guide 🚀</p>
          <p className="text-black/70 mb-4">
            Browse tenders and add products in Catalogue page to unlock personalized recommendations.
          </p>

          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => router.push('/tenders')}
              className="flex-1 min-w-[140px] rounded-2xl bg-black !text-white py-3 font-semibold hover:opacity-85 transition"
            >
              🔍 Browse Tenders
            </button>


            <button
              onClick={() => router.push('/catalog')}
              className="flex-1 min-w-[140px] rounded-2xl bg-[#F7C846] text-black py-3 font-semibold hover:brightness-95 transition"
            >
              📦 Add Products to Catalogue
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-[#FC574E]/10 border-2 border-[#FC574E]/20 rounded-2xl">
          <p className="text-sm text-[#FC574E]">{error}</p>
        </div>
      )}

      {/* ===================== CARDS ======================= */}
      <div className="grid gap-4 lg:grid-cols-4 mb-6">

        <div className="space-y-4">
          <div className="rounded-3xl bg-[#F7C846] px-5 py-6 shadow-lg min-h-[140px] flex flex-col justify-center">
            <p className="text-sm font-semibold text-black/80 mb-1">Total Tenders</p>
            <p className="text-3xl font-bold text-black">{stats.totalTenders}</p>
          </div>
          <div className="rounded-3xl bg-[#F7C846] px-5 py-6 shadow-lg min-h-[140px] flex flex-col justify-center">
            <p className="text-sm font-semibold text-black/80 mb-1">Recommended</p>
            <p className="text-3xl font-bold text-black">{stats.recommended}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl bg-black px-5 py-6 shadow-lg min-h-[140px] flex flex-col justify-center">
            <p className="text-sm font-semibold text-[#F7C846] mb-1">Active</p>
            <p className="text-3xl font-bold text-white">{stats.activeTenders}</p>
          </div>
          <div className="rounded-3xl bg-black px-5 py-6 shadow-lg min-h-[140px] flex flex-col justify-center">
            <p className="text-sm font-semibold text-[#F7C846] mb-1">Shortlisted</p>
            <p className="text-3xl font-bold text-white">{stats.shortlisted}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl bg-black px-5 py-6 shadow-lg min-h-[140px] flex flex-col justify-center">
            <p className="text-sm font-semibold text-[#F7C846] mb-1">Closing Soon</p>
            <p className="text-3xl font-bold text-white">{stats.closingSoon}</p>
          </div>
          <div className="rounded-3xl bg-black px-5 py-6 shadow-lg min-h-[140px] flex flex-col justify-center">
            <p className="text-sm font-semibold text-[#F7C846] mb-1">Archived</p>
            <p className="text-3xl font-bold text-white">{stats.archived}</p>
          </div>
        </div>

        <div className="rounded-3xl bg-white px-5 py-6 shadow-lg flex flex-col justify-between min-h-[140px]">
          <div>
            <p className="text-sm font-semibold text-black/70 mb-1">Catalogue</p>
            <p className="text-3xl font-bold text-black">{stats.catalogActive}</p>
            <p className="text-sm text-black/70">Active</p>
          </div>
          <div className="mt-4">
            <p className="text-sm text-black/60">/ {stats.catalogTotal} Products</p>
          </div>
        </div>

      </div>

      {/* ===================== CHART ======================= */}
      <div className="rounded-3xl bg-black px-6 py-5 shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-3/4 h-28 sm:h-36">
          <div className="absolute bottom-2 left-[4%] right-[8%] h-[3px] bg-[#F7C846]" />

          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              barCategoryGap={40}
              margin={{ top: 8, right: 16, left: 16, bottom: 8 }}
            >
              <XAxis dataKey="name" hide />
              <YAxis hide domain={[0, 12]} />
              <Tooltip cursor={{ fill: 'transparent' }} content={() => null} />

              <Bar dataKey="published" fill="#FFFFFF" barSize={20} radius={[4, 4, 0, 0]} />
              <Bar dataKey="recommended" fill="#F7C846" barSize={16} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="mt-4 sm:mt-0 sm:ml-6 flex flex-col gap-3 text-xs text-white/80">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-white" />
            <span>Published</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-[#F7C846]" />
            <span>Recommended</span>
          </div>
        </div>
      </div>

    </div>
  );
}
