"use client";

import { useEffect, useState } from "react";
import dayjs from "dayjs";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------------- CUSTOM TOOLTIP ---------------- */
function MirrorTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;

  const row = payload[0].payload;

  return (
    <div className="bg-gray-800 text-white p-3 rounded-lg shadow-lg text-sm border border-gray-700">
      <div className="font-semibold mb-1">{row.day}</div>

      <div className="flex justify-between gap-4">
        <span className="text-white">Bids:</span>
        <span>{row.bid_count_raw.toLocaleString()}</span>
      </div>

      <div className="flex justify-between gap-4">
        <span className="text-[#FFB703]">Value:</span>
        <span>₹ {row.value_cr} Cr</span>
      </div>
    </div>
  );
}
/* ----------------------------------------------- */

export default function ResultsDashboard() {
  const [chartData, setChartData] = useState<any[]>([]);
  const [kpis, setKpis] = useState({
    totalBids: 0,
    totalValueCr: 0,
    avgValueLakh: 0,
  });
  const [loading, setLoading] = useState(true);

  // T-30 to T-2 window
  const fromDate = dayjs().subtract(30, "day").format("YYYY-MM-DD");
  const toDate = dayjs().subtract(2, "day").format("YYYY-MM-DD");

  useEffect(() => {
    async function fetchData() {
      setLoading(true);

      // ---- KPI QUERY ----
      const { data: kpiData } = await supabase.rpc("get_results_kpis", {
        from_date: fromDate,
        to_date: toDate,
      });

      if (kpiData && kpiData.length) {
        setKpis({
          totalBids: kpiData[0].total_bids,
          totalValueCr: kpiData[0].total_value_cr,
          avgValueLakh: kpiData[0].avg_value_lakh,
        });
      }

      // ---- CHART QUERY ----
      const { data } = await supabase.rpc("get_daily_histogram", {
        from_date: fromDate,
        to_date: toDate,
      });

      if (data) {
        const formatted = data
          .filter((d: any) => (d.bid_count || 0) > 0) // skip zero-bid days
          .map((d: any) => ({
            day: dayjs(d.day).format("DD MMM"),

            // NATURAL SCALES (NO SCALING)
            bid_count_raw: d.bid_count,     // LINE (top)
            value_cr: d.total_value_cr,     // BARS (upward)
          }));

        setChartData(formatted);
      }

      setLoading(false);
    }

    fetchData();
  }, []);

  if (loading) {
    return <div className="p-8">Loading dashboard...</div>;
  }

  return (
    <div className="p-8 space-y-6">
      {/* -------- KPI CARDS -------- */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard
          title="Total Bids"
          value={kpis.totalBids.toLocaleString()}
        />
        <KpiCard
          title="Total Awarded Value"
          value={`₹ ${kpis.totalValueCr} Cr`}
        />
        <KpiCard
          title="Avg Bid Value"
          value={`₹ ${kpis.avgValueLakh} lakh`}
        />
      </div>

      {/* -------- CHART -------- */}
      <div className="bg-black p-6 rounded-xl h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} barCategoryGap={4} barGap={0}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#222" />

            {/* SHARED X-AXIS */}
            <XAxis
              dataKey="day"
              tick={{ fill: "#aaa", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              interval={6}
            />

            {/* PRIMARY AXIS — BIDS (HIDDEN) */}
            <YAxis yAxisId="bids" orientation="left" hide={true} />

            {/* SECONDARY AXIS — VALUE (HIDDEN) */}
            <YAxis yAxisId="value" orientation="right" hide={true} />

            {/* BASELINE */}
            <ReferenceLine
              y={0}
              stroke="#777"
              strokeWidth={1.5}
            />

            {/* CUSTOM TOOLTIP */}
            <Tooltip content={<MirrorTooltip />} />

            {/* TOP — SMOOTH WHITE LINE FOR BIDS */}
            <Line
              yAxisId="bids"
              type="monotone"
              dataKey="bid_count_raw"
              stroke="#FFFFFF"
              strokeWidth={2.5}
              dot={{ r: 3, fill: "#FFFFFF" }}
              activeDot={{ r: 5 }}
            />

            {/* BOTTOM — REGULAR UPWARD BARS FOR VALUE */}
            <Bar
              yAxisId="value"
              dataKey="value_cr"
              barSize={7}
              radius={[4, 4, 0, 0]}
              fill="#FFB703"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function KpiCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-black p-4 rounded-xl border border-gray-800">
      <div className="text-gray-400 text-sm">{title}</div>
      <div className="text-white text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
