'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/lib/supabase-client';

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

        // 2) Build all queries (run in parallel)

        // Total tenders: total rows in tenders table
        const tendersTotalQuery = supabase
          .from('tenders')
          .select('id', { count: 'exact', head: true });

        // Active: bid_end_datetime > now
        const tendersActiveQuery = supabase
          .from('tenders')
          .select('id', { count: 'exact', head: true })
          .gt('bid_end_datetime', nowIso);

        // Closing Soon:
        // Today = 22 Nov
        // - tender ending 28 Nov -> included
        // - tender ending 30 Nov -> NOT included
        // => bid_end_datetime > now AND < now + 7 days
        const tendersClosingSoonQuery = supabase
          .from('tenders')
          .select('id', { count: 'exact', head: true })
          .gt('bid_end_datetime', nowIso)
          .lt('bid_end_datetime', sevenDaysLaterIso);

        // Archived: bid_end_datetime < now
        const tendersArchivedQuery = supabase
          .from('tenders')
          .select('id', { count: 'exact', head: true })
          .lt('bid_end_datetime', nowIso);

        // Recommended: total rows in recommendations for this user
        const recommendedQuery = supabase
          .from('recommendations')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', currentUser.id);

        // Shortlisted: total rows in user_shortlists for this user
        const shortlistQuery = supabase
          .from('user_shortlists')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', currentUser.id);

        // Catalogue: active items for this user
        const catalogActiveQuery = supabase
          .from('catalog_items')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', currentUser.id)
          .eq('status', 'active');

        // Catalogue: total products for this user
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

        // 3) Handle errors (log but keep going where possible)
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] p-6">
        <div className="h-10 w-64 bg-gray-200 rounded-xl mb-6 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 7 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-3xl bg-white shadow-lg p-5 space-y-3"
            >
              <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
              <div className="h-8 w-10 bg-gray-200 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F7] p-6">
      {/* Top yellow header bar */}
      <div className="mb-6 rounded-3xl bg-[#F7C846] px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between shadow-md">
        <div>
          <h1 className="text-2xl font-bold text-black">Dashboard</h1>
          <p className="text-sm text-black/80">
            Plan, Prioritize and Accomplish with ease
          </p>
        </div>
        <div className="mt-3 sm:mt-0 text-sm text-black/80">
          Welcome back{userEmail ? `, ${userEmail}` : ''}!
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-[#FC574E]/10 border-2 border-[#FC574E]/20 rounded-2xl">
          <p className="text-sm text-[#FC574E]">{error}</p>
        </div>
      )}

      {/* Main cards layout */}
      <div className="grid gap-4 lg:grid-cols-4 mb-6">
        {/* Column 1 - yellow cards */}
        <div className="space-y-4">
          {/* Total Tenders */}
          <div className="rounded-3xl bg-[#F7C846] px-5 py-4 shadow-lg">
            <p className="text-sm font-semibold text-black/80 mb-1">
              Total Tenders
            </p>
            <p className="text-3xl font-bold text-black">
              {stats.totalTenders}
            </p>
          </div>

          {/* Recommended */}
          <div className="rounded-3xl bg-[#F7C846] px-5 py-4 shadow-lg">
            <p className="text-sm font-semibold text-black/80 mb-1">
              Recommended
            </p>
            <p className="text-3xl font-bold text-black">
              {stats.recommended}
            </p>
          </div>
        </div>

        {/* Column 2 - black cards */}
        <div className="space-y-4">
          {/* Active */}
          <div className="rounded-3xl bg-black px-5 py-4 shadow-lg">
            <p className="text-sm font-semibold text-[#F7C846] mb-1">
              Active
            </p>
            <p className="text-3xl font-bold text-white">
              {stats.activeTenders}
            </p>
          </div>

          {/* Shortlisted */}
          <div className="rounded-3xl bg-black px-5 py-4 shadow-lg">
            <p className="text-sm font-semibold text-[#F7C846] mb-1">
              Shortlisted
            </p>
            <p className="text-3xl font-bold text-white">
              {stats.shortlisted}
            </p>
          </div>
        </div>

        {/* Column 3 - black cards */}
        <div className="space-y-4">
          {/* Closing Soon */}
          <div className="rounded-3xl bg-black px-5 py-4 shadow-lg">
            <p className="text-sm font-semibold text-[#F7C846] mb-1">
              Closing Soon
            </p>
            <p className="text-3xl font-bold text-white">
              {stats.closingSoon}
            </p>
          </div>

          {/* Archived */}
          <div className="rounded-3xl bg-black px-5 py-4 shadow-lg">
            <p className="text-sm font-semibold text-[#F7C846] mb-1">
              Archived
            </p>
            <p className="text-3xl font-bold text-white">
              {stats.archived}
            </p>
          </div>
        </div>

        {/* Column 4 - catalogue card */}
        <div className="rounded-3xl bg-white px-5 py-4 shadow-lg flex flex-col justify-between">
          <div>
            <p className="text-sm font-semibold text-black/70 mb-1">
              Catalogue
            </p>
            <p className="text-3xl font-bold text-black">
              {stats.catalogActive}
            </p>
            <p className="text-sm text-black/70">Active</p>
          </div>
          <div className="mt-4">
            <p className="text-sm text-black/60">
              / {stats.catalogTotal} Products
            </p>
          </div>
        </div>
      </div>

      {/* Chart area (image placeholder) */}
      <div className="rounded-3xl bg-black px-6 py-5 shadow-lg">
        {/* Replace src with your actual chart-image path under /public */}
        <div className="relative w-full h-40 sm:h-52">
          <Image
            src="/dashboard-chart.png"
            alt="Published vs Recommended chart"
            fill
            className="object-contain"
          />
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-white/80">
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
