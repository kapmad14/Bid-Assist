'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { Search, PackagePlus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LabelList } from 'recharts';

function fillDateBuckets(
  rows: { date: string; count: number }[],
  startOffsetDays: number,
  endOffsetDays: number,
  dateKey: 'publish_date' | 'closing_date',
) {
  const map = new Map<string, number>();

  rows.forEach((r: any) => {
    map.set(r[dateKey], Number(r.count));
  });

  const result: { date: string; count: number }[] = [];
  const today = new Date();

  for (let i = startOffsetDays; i <= endOffsetDays; i++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() + i);

    const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD

    result.push({
      date: dateStr,
      count: map.get(dateStr) ?? 0,
    });
  }

  return result;
}
interface DashboardStats {
  activeTenders: number;
  closingSoon: number;
  recommended: number;
  shortlisted: number;
  catalogActive: number;
  catalogTotal: number;
  catalogPaused: number;
}


export default function DashboardPage() {
  const router = useRouter();

  const [publishedChart, setPublishedChart] = useState<
    { date: string; count: number }[]
  >([]);

  const [closingChart, setClosingChart] = useState<
    { date: string; count: number }[]
  >([]);


  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    activeTenders: 0,
    closingSoon: 0,
    recommended: 0,
    shortlisted: 0,
    catalogActive: 0,
    catalogTotal: 0,
    catalogPaused: 0,
  });

  useEffect(() => {
    let mounted = true;

    const fetchData = async () => {
      const supabase = createClient();
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

        const tendersActiveQuery = supabase
          .from('tenders')
          .select('id', { count: 'exact', head: true })
          .gt('bid_end_datetime', nowIso);

        const tendersClosingSoonQuery = supabase
          .from('tenders')
          .select('id', { count: 'exact', head: true })
          .gt('bid_end_datetime', nowIso)
          .lt('bid_end_datetime', sevenDaysLaterIso);

        const recommendedQuery = supabase
          .from('recommendations')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', currentUser.id);

        const shortlistQuery = supabase
          .from('user_shortlists')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', currentUser.id);

        const catalogPausedQuery = supabase
          .from('catalog_items')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', currentUser.id)
          .eq('status', 'paused');

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
          tendersActiveRes,
          tendersClosingSoonRes,
          recommendedRes,
          shortlistRes,
          catalogActiveRes,
          catalogTotalRes,
          catalogPausedRes,
          publishedChartRes,
          closingChartRes,
        ] = await Promise.all([
          tendersActiveQuery,
          tendersClosingSoonQuery,
          recommendedQuery,
          shortlistQuery,
          catalogActiveQuery,
          catalogTotalQuery,
          catalogPausedQuery,
          supabase.rpc('dashboard_tenders_published_last_7_days'),
          supabase.rpc('dashboard_tenders_closing_next_7_days'),
        ]);


        const allErrors = [
          tendersActiveRes.error,
          tendersClosingSoonRes.error,
          recommendedRes.error,
          shortlistRes.error,
          catalogActiveRes.error,
          catalogPausedRes.error,
          catalogTotalRes.error,
          publishedChartRes.error,
          closingChartRes.error,
        ].filter(Boolean);


        if (allErrors.length > 0) {
          console.error('Dashboard query errors:', allErrors);
          if (mounted) {
            setError('Some dashboard data could not be loaded.');
          }
        }

        if (!mounted) return;

          setStats({
            activeTenders: tendersActiveRes.count ?? 0,
            closingSoon: tendersClosingSoonRes.count ?? 0,
            recommended: recommendedRes.count ?? 0,
            shortlisted: shortlistRes.count ?? 0,
            catalogActive: catalogActiveRes.count ?? 0,
            catalogTotal: catalogTotalRes.count ?? 0,
            catalogPaused: catalogPausedRes.count ?? 0,
          });

          const publishedFilled = fillDateBuckets(
            publishedChartRes.data ?? [],
            -7,
            -1,
            'publish_date',
          );

          const closingFilled = fillDateBuckets(
            closingChartRes.data ?? [],
            1,
            7,
            'closing_date',
          );

          setPublishedChart(publishedFilled);
          setClosingChart(closingFilled);
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
  }, [router]);

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

      <div className="mb-6 px-2">
      </div>


      {error && (
        <div className="mb-6 p-4 bg-[#FC574E]/10 border-2 border-[#FC574E]/20 rounded-2xl">
          <p className="text-sm text-[#FC574E]">{error}</p>
        </div>
      )}

      {/* ===================== CARDS ===================== */}
      <div className="grid gap-4 lg:grid-cols-4 mb-6">

        {/* LEFT YELLOW WELCOME BLOCK */}
        <div className="rounded-3xl bg-[#F7C846] p-7 shadow-lg flex flex-col justify-between min-h-[296px]">

          {/* Top identity */}
          <div>
            <div className="flex items-end gap-2">
              <p className="text-5xl font-extrabold text-black leading-none">Hi!</p>
            </div>
            <p className="mt-1 text-sm font-medium text-black/70 truncate">
              {userEmail}
            </p>
          </div>

          {/* Divider */}
          <div className="h-px w-full bg-black/15 my-4" />

          {/* CTA */}
          <button
            onClick={() => router.push('/tenders2?from=dashboard')}
            className="w-full rounded-2xl bg-black text-white py-2 font-semibold
                      transition-all duration-200
                      flex items-center justify-center gap-2
                      hover:bg-[#1a1a1a] hover:scale-[1.02] active:scale-[0.98]
                      shadow-md hover:shadow-lg"
          >
            <Search size={18} />
            View all tenders
          </button>

        </div>



        {/* BLACK METRIC BLOCKS */}
        <div className="space-y-4">
          <div
            onClick={() => router.push('/tenders2?tab=Active&from=dashboard')}
            className="rounded-3xl bg-black px-5 py-6 shadow-lg min-h-[140px]
                      flex flex-col justify-center cursor-pointer
                      transition-all hover:scale-[1.02] hover:bg-[#111]"
          >
            <p className="text-sm font-semibold text-[#F7C846] mb-1">Active</p>
            <p className="text-3xl font-bold text-white">{stats.activeTenders}</p>
          </div>

          <div
            onClick={() => router.push('/tenders2?tab=Closing%20Soon&from=dashboard')}
            className="rounded-3xl bg-black px-5 py-6 shadow-lg min-h-[140px]
                      flex flex-col justify-center cursor-pointer
                      transition-all hover:scale-[1.02] hover:bg-[#111]"
          >
            <p className="text-sm font-semibold text-[#F7C846] mb-1">Closing Soon</p>
            <p className="text-3xl font-bold text-white">{stats.closingSoon}</p>
          </div>

        </div>

        <div className="space-y-4">
          <div
            onClick={() => router.push('/shortlisted?from=dashboard')}
            className="rounded-3xl bg-black px-5 py-6 shadow-lg min-h-[140px]
                      flex flex-col justify-center cursor-pointer
                      transition-all hover:scale-[1.02] hover:bg-[#111]"
          >
            <p className="text-sm font-semibold text-[#F7C846] mb-1">Shortlisted</p>
            <p className="text-3xl font-bold text-white">{stats.shortlisted}</p>
          </div>

          <div
            onClick={() => router.push('/recommended?from=dashboard')}
            className="rounded-3xl bg-black px-5 py-6 shadow-lg min-h-[140px]
                      flex flex-col justify-center cursor-pointer
                      transition-all hover:scale-[1.02] hover:bg-[#111]"
          >
            <p className="text-sm font-semibold text-[#F7C846] mb-1">Recommended</p>
            <p className="text-3xl font-bold text-white">{stats.recommended}</p>
          </div>

        </div>

        {/* CATALOGUE BLOCK */}
        <div className="rounded-3xl bg-white px-6 py-6 shadow-lg flex flex-col justify-between min-h-[296px]">
          <div>
            <p className="text-sm font-semibold text-black/70 mb-6 text-center">
              Catalogue
            </p>

          {stats.catalogTotal === 0 ? (
            <>
              <div className="flex flex-col items-center text-center mt-6">
                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-[#F7C846]/20 mb-3">
                  <PackagePlus size={28} className="text-[#F7C846]" strokeWidth={2.2} />
                </div>

                <p className="text-sm text-black/60">
                  No products in your catalogue yet
                </p>
              </div>

              <div className="flex justify-center mt-4">
                <button
                  onClick={() => router.push('/catalog')}
                  className="rounded-xl bg-[#F7C846] text-black px-5 py-2 text-sm font-semibold hover:brightness-95 transition"
                >
                  Add product
                </button>
              </div>
            </>
          ) : (

            <div className="flex justify-center">
              <div className="flex gap-4">


                <div className="w-[71px] h-[80px] rounded-2xl bg-[#F5F5F7] flex flex-col items-center justify-center shrink-0">
                  <p className="text-xs text-black/60">Total</p>
                  <p className="text-2xl font-bold text-black">{stats.catalogTotal}</p>
                </div>

                <div className="w-[71px] h-[80px] rounded-2xl bg-green-50 border border-green-200 flex flex-col items-center justify-center shrink-0">
                  <p className="text-xs text-green-700">Active</p>
                  <p className="text-2xl font-bold text-green-800">{stats.catalogActive}</p>
                </div>

                <div className="w-[71px] h-[80px] rounded-2xl bg-amber-50 border border-amber-200 flex flex-col items-center justify-center shrink-0">
                  <p className="text-xs text-amber-700">Paused</p>
                  <p className="text-2xl font-bold text-amber-800">{stats.catalogPaused}</p>
                </div>
              </div>
            </div>
          )}

          {stats.catalogTotal > 0 && (
            <div className="mt-4">
              <div className="h-1 w-full bg-black/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500"
                  style={{
                    width: `${stats.catalogTotal
                      ? (stats.catalogActive / stats.catalogTotal) * 100
                      : 0}%`,
                  }}
                />
              </div>
              <p className="text-xs text-black/40 mt-2">
                {stats.catalogActive} of {stats.catalogTotal} products active
              </p>
            </div>
          )}
          </div>

          <div className="mt-4 flex flex-col items-center gap-3 text-center">

            {stats.catalogTotal > 0 && (
              <button
                onClick={() => router.push('/catalog')}
                className="
                  flex items-center gap-1
                  px-3 py-1.5 rounded-full
                  text-xs font-semibold
                  bg-[#F5F5F7] text-[#0E121A]
                  hover:bg-[#ECECEC]
                  transition
                "
              >
                Manage catalogue
                <span className="text-sm">→</span>
              </button>
            )}

            <p className="text-xs text-black/40 max-w-[220px]">
              Needed for Recommendations
            </p>
          </div>


        </div>
      </div>


      {/* ===================== ANALYTICS ======================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Published – Last 7 Days */}
        <div className="rounded-3xl bg-black px-8 pt-8 pb-6 shadow-lg">
          <p className="text-sm font-semibold text-white/80 mb-4">
            Tenders Published (Last 7 Days)
          </p>

          <div className="h-[260px] mt-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={publishedChart} barCategoryGap={20}>
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#FFFFFF', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: string) => {
                    const [, month, day] = value.split('-');
                    return `${day}/${month}`;
                  }}
                />
                <YAxis
                  hide
                  domain={[0, (dataMax: number) => dataMax * 1.25]}
                />
                  <Bar dataKey="count" fill="#FFFFFF" barSize={38} radius={[6, 6, 0, 0]}>
                    <LabelList
                      dataKey="count"
                      content={({ x, y, width, value }) =>
                        typeof value === 'number' && value > 0 ? (
                          <g>
                            <rect
                              x={x}
                              y={(y as number) - 24}
                              width={width}
                              height={20}
                              rx="6"
                              fill="#FFFFFF"
                            />
                            <text
                              x={(x as number) + (width as number) / 2}
                              y={(y as number) - 14}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              fill="#000000"
                              fontSize="12"
                              fontWeight="700"
                            >
                              {value}
                            </text>
                          </g>
                        ) : null
                      }
                    />
                  </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Closing – Next 7 Days */}
        <div className="rounded-3xl bg-black px-8 pt-8 pb-6 shadow-lg">
          <p className="text-sm font-semibold text-white/80 mb-4">
            Tenders Closing (Next 7 Days)
          </p>

          <div className="h-[260px] mt-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={closingChart} barCategoryGap={20}>
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#FFFFFF', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: string) => {
                    const [, month, day] = value.split('-');
                    return `${day}/${month}`;
                  }}
                />
                  <YAxis
                    hide
                    domain={[0, (dataMax: number) => dataMax * 1.25]}
                  />

                  <Bar dataKey="count" fill="#F7C846" barSize={38} radius={[6, 6, 0, 0]}>
                    <LabelList
                      dataKey="count"
                      content={({ x, y, width, value }) =>
                        typeof value === 'number' && value > 0 ? (
                          <g>
                            <rect
                              x={x}
                              y={(y as number) - 24}
                              width={width}
                              height={20}
                              rx="6"
                              fill="#F7C846"
                            />
                            <text
                              x={(x as number) + (width as number) / 2}
                              y={(y as number) - 14}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              fill="#0E121A"
                              fontSize="12"
                              fontWeight="700"
                            >
                              {value}
                            </text>
                          </g>
                        ) : null
                      }
                    />
                  </Bar>

              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
}
