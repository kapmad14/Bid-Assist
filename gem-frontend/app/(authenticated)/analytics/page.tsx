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
  Treemap,
} from "recharts";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type TreemapMetric = "value" | "count";

/* ---------------- TREEMAP SIZE CAPPING ---------------- */
function capTreemapData(data: any[], capRatio = 0.4) {
  if (!data.length) return [];

  const sorted = [...data].sort((a, b) => b.rankValue - a.rankValue);

  const maxItem = sorted[0];
  const rest = sorted.slice(1);

  const restTotal = rest.reduce(
    (sum, d) => sum + d.rankValue,
    0
  );

  return [
    {
      ...maxItem,          // ✅ PRESERVES bidCount
      __size: capRatio,
    },
    ...rest.map((d) => ({
      ...d,                // ✅ PRESERVES bidCount
      __size:
        restTotal > 0
          ? (d.rankValue / restTotal) * (1 - capRatio)
          : 0,
    })),
  ];
}

/* ---------------- LENIENT TEXT WRAPPING ---------------- */
function wrapText(
  text: string,
  maxCharsPerLine = 36,
  maxLines = 7
) {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length <= maxCharsPerLine) {
      current = next;
    } else {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  return lines;
}

/* ---------------- CUSTOM TREEMAP NODE ---------------- */
function TreemapNode(props: any) {
  const {
    x,
    y,
    width,
    height,
    name,
    payload,
    treemapMetric,
  } = props;

  // Always render rects — layout depends on this
  const data = payload?.payload;

  const bidCount =
    typeof data?.bidCount === "number" ? data.bidCount : null;

  const valueCr =
    typeof data?.valueCr === "number" ? data.valueCr : null;

  const isLeaf = bidCount !== null || valueCr !== null;
  const showLabel = isLeaf && width > 110 && height > 70;

  return (
    <g>
      {/* TILE */}
      <rect
        x={x}
        y={y}
        width={Math.max(0, width)}
        height={Math.max(0, height)}
        fill="#FFB703"
        stroke="#111"
      />

      {/* TEXT ONLY FOR LEAF NODES */}
      {showLabel && (
        <>
          <text
            x={x + 10}
            y={y + 22}
            fontSize={12}
            fontWeight={600}
            fill="#000"
            pointerEvents="none"
          >
            {name}
          </text>

          <text
            x={x + 10}
            y={y + 40}
            fontSize={11}
            fill="#222"
            pointerEvents="none"
          >
            {treemapMetric === "count"
              ? `${bidCount!.toLocaleString()} bids`
              : `₹ ${valueCr!.toFixed(1)} Cr`}
          </text>
        </>
      )}
    </g>
  );
}


/* ===================================================== */

export default function AnalyticsPage() {
  const [chartData, setChartData] = useState<any[]>([]);
  const [treemapData, setTreemapData] = useState<any[]>([]);
  const [treemapMetric, setTreemapMetric] =
    useState<TreemapMetric>("value");

  const [kpis, setKpis] = useState({
    totalBids: 0,
    totalValueCr: 0,
    avgValueLakh: 0,
  });

  const fromDate = dayjs().subtract(30, "day").format("YYYY-MM-DD");
  const toDate = dayjs().subtract(2, "day").format("YYYY-MM-DD");

  /* ---------------- BASE DATA ---------------- */
  useEffect(() => {
    async function fetchBase() {
      const kpiRes = await supabase.rpc("get_results_kpis", {
        from_date: null,
        to_date: null,
        ministry_param: null,
      });

      if (kpiRes.data?.length) {
        setKpis({
          totalBids: kpiRes.data[0].total_bids ?? 0,
          totalValueCr: kpiRes.data[0].total_value_cr ?? 0,
          avgValueLakh: kpiRes.data[0].avg_value_lakh ?? 0,
        });
      }

      const { data: histogram } = await supabase.rpc(
        "get_daily_histogram",
        {
          from_date: fromDate,
          to_date: toDate,
          ministry: null,
          department: null,
          seller: null,
          bid_ra: null,
        }
      );

      setChartData(
        histogram?.map((d: any) => ({
          day: dayjs(d.day).format("DD MMM"),
          bid_count_raw: d.bid_count ?? 0,
          value_cr: d.total_value_cr ?? 0,
        })) ?? []
      );
    }

    fetchBase();
  }, []);

  /* ---------------- TREEMAP ---------------- */
  useEffect(() => {
    async function fetchTreemap() {
      const { data, error } = await supabase.rpc(
        "get_top_ministries_treemap",
        {
          metric: treemapMetric,
          limit_count: 15,
        }
      );

      if (error) {
        console.error("Treemap RPC error:", error);
        return;
      }

      const normalized =
        data?.map((m: any, i: number) => ({
          name: m.ministry,
          valueCr: Number(m.total_value_cr),
          bidCount: Number(m.bid_count),
          rankValue:
            treemapMetric === "count"
              ? Number(m.bid_count)
              : Number(m.total_value_cr),
          rank: i + 1,
        })) ?? [];

      setTreemapData(capTreemapData(normalized, 0.4));
    }

    fetchTreemap();
  }, [treemapMetric]);

  return (
    <div className="p-8 space-y-6">

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard title="Total Bids" value={String(kpis.totalBids)} />
        <KpiCard
          title="Total Awarded Value"
          value={`₹ ${kpis.totalValueCr} Cr`}
        />
        <KpiCard
          title="Avg Bid Value"
          value={`₹ ${kpis.avgValueLakh} lakh`}
        />
      </div>

      {/* HISTOGRAM */}
      <div className="bg-black p-6 rounded-xl h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#222" />
            <XAxis dataKey="day" tick={{ fill: "#aaa" }} axisLine={false} />
            <YAxis hide />
            <Tooltip />
            <Line dataKey="bid_count_raw" stroke="#fff" strokeWidth={2.5} />
            <Bar dataKey="value_cr" fill="#FFB703" barSize={7} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* TREEMAP */}
      <div className="bg-black p-6 rounded-xl h-[380px]">

        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-white text-sm">Top 15 Ministries</h3>
            <p className="text-xs text-gray-400">
              Ranked by{" "}
              {treemapMetric === "value"
                ? "total awarded value"
                : "number of bids"}
            </p>
            <p className="text-xs text-gray-500">
              Area capped at 40% for readability
            </p>
          </div>

          <div className="flex bg-gray-900 rounded-lg p-1">
            <button
              onClick={() => setTreemapMetric("value")}
              className={`px-3 py-1 text-xs rounded-md ${
                treemapMetric === "value"
                  ? "bg-[#FFB703] text-black"
                  : "text-gray-400"
              }`}
            >
              ₹ Value
            </button>
            <button
              onClick={() => setTreemapMetric("count")}
              className={`px-3 py-1 text-xs rounded-md ${
                treemapMetric === "count"
                  ? "bg-[#FFB703] text-black"
                  : "text-gray-400"
              }`}
            >
              Bid Count
            </button>
          </div>
        </div>

        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={treemapData}
            dataKey="__size"
            nameKey="name"
            content={(props) => (
              <TreemapNode {...props} treemapMetric={treemapMetric} />
            )}
          />
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ---------------- KPI CARD ---------------- */
function KpiCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-black p-4 rounded-xl border border-gray-800">
      <div className="text-gray-400 text-sm">{title}</div>
      <div className="text-white text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
