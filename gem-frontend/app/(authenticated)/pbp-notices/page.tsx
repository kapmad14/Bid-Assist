'use client';

import React, { useEffect, useState } from "react";
import { FileText, MapPin } from "lucide-react";
import Link from "next/link";

/* ---------------- TYPES ---------------- */

type PbpNotice = {
  pbp_number: string;
  item: string | null;
  quantity_required: number | null;
  department: string | null;
  address: string | null;
  create_date: string | null;
  end_date: string | null;
};

/* ---------------- HELPERS ---------------- */

const isValid = (val?: string | null) => {
  if (!val) return false;
  const cleaned = val.trim().toLowerCase();
  return cleaned !== "n/a" && cleaned !== "na";
};

/* ---------------- PAGE ---------------- */

export default function PbpNoticesPage() {
  const [notices, setNotices] = useState<PbpNotice[]>([]);
  const [loading, setLoading] = useState(true);

  /* ---------------- FETCH DATA ---------------- */

  useEffect(() => {
    async function load() {
      setLoading(true);

      try {
        const res = await fetch("/api/pbp-notices"); // placeholder endpoint
        const json = await res.json();

        setNotices(json.data ?? []);
      } catch (err) {
        console.error("Failed to load PBP notices:", err);
        setNotices([]);
      }

      setLoading(false);
    }

    load();
  }, []);

  /* ---------------- UI ---------------- */

  return (
    <div className="px-6 py-4 space-y-8">

      {/* ✅ Filters Placeholder Row */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="grid grid-cols-3 gap-4">

          <input
            placeholder="Search PBP Number..."
            className="border rounded-lg px-4 py-2 text-sm"
          />

          <input
            placeholder="Search Item..."
            className="border rounded-lg px-4 py-2 text-sm"
          />

          <input
            placeholder="Search Department..."
            className="border rounded-lg px-4 py-2 text-sm"
          />
        </div>
      </div>

      {/* ✅ Loading */}
      {loading ? (
        <div className="text-center py-20 text-gray-400 font-medium">
          Loading PBP Notices...
        </div>
      ) : notices.length === 0 ? (
        <div className="text-center py-20 text-gray-500 font-medium">
          No notices found.
        </div>
      ) : (
        /* ✅ 2 Column Grid Layout */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {notices.map((n) => (
            <div
              key={n.pbp_number}
              className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition p-6"
            >
              {/* ✅ PBP Number */}
              <Link
                href="#"
                className="text-xl font-bold text-blue-700 hover:underline"
              >
                {n.pbp_number}
              </Link>

              {/* ✅ Item */}
              {isValid(n.item) && (
                <p className="mt-3 text-gray-900 font-semibold text-sm uppercase tracking-wide">
                  {n.item}
                </p>
              )}

              {/* ✅ Department + Address (LEFT PRIORITY) */}
              {(isValid(n.department) || isValid(n.address)) && (
                <div className="mt-4 space-y-1 text-gray-700">

                  {/* Department */}
                  {isValid(n.department) && (
                    <div className="flex items-start gap-2 text-sm">
                      <FileText className="w-4 h-4 mt-[2px] text-gray-500" />
                      <span className="font-semibold">{n.department}</span>
                    </div>
                  )}

                  {/* Address */}
                  {isValid(n.address) && (
                    <div className="flex items-start gap-2 text-sm text-gray-600">
                      <MapPin className="w-4 h-4 mt-[2px] text-gray-400" />
                      <span>{n.address}</span>
                    </div>
                  )}
                </div>
              )}

              {/* ✅ Quantity */}
              {n.quantity_required != null && (
                <div className="mt-4 inline-flex items-center px-3 py-1 rounded-lg bg-gray-100 text-xs font-bold text-gray-700">
                  Quantity: {n.quantity_required}
                </div>
              )}

              {/* ✅ Dates */}
              <div className="mt-5 border-t border-gray-100 pt-4 flex justify-between text-xs text-gray-500">

                {isValid(n.create_date) && (
                  <span>Published: {n.create_date}</span>
                )}

                {isValid(n.end_date) && (
                  <span className="font-semibold text-red-600">
                    Ends: {n.end_date}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
