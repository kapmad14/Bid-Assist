"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Clock, Building2, Calendar, Database } from "lucide-react";

import { gemResultsClientStore } from "@/services/gemResultsStore.client";
import { GemResult } from "@/types";

const PAGE_SIZE = 10;

export default function ResultsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPage = Number(searchParams.get("page") ?? 1);

  const [currentPage, setCurrentPage] = useState(initialPage);
  const [results, setResults] = useState<GemResult[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI typing state (fast)
  const [itemFilterInput, setItemFilterInput] = useState("");
  const [ministryFilterInput, setMinistryFilterInput] = useState("");
  const [departmentFilterInput, setDepartmentFilterInput] = useState("");
  const [sellerFilterInput, setSellerFilterInput] = useState("");

  // Actual filters that trigger fetch (slow)
  const [itemFilter, setItemFilter] = useState("");
  const [ministryFilter, setMinistryFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [sellerFilter, setSellerFilter] = useState("");

  // Control dropdown visibility
  const [showMinistryList, setShowMinistryList] = useState(false);
  const [showDepartmentList, setShowDepartmentList] = useState(false);
  const [showSellerList, setShowSellerList] = useState(false);

  // Global autosuggest options loaded once from server
  const [ministryOptions, setMinistryOptions] = useState<string[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [sellerOptions, setSellerOptions] = useState<string[]>([]);

  // Load filters from URL on first render
  useEffect(() => {
    const item = searchParams.get("item") || "";
    const ministry = searchParams.get("ministry") || "";
    const department = searchParams.get("department") || "";
    const seller = searchParams.get("seller") || "";

    // Sync BOTH input + real filters
    setItemFilterInput(item);
    setMinistryFilterInput(ministry);
    setDepartmentFilterInput(department);
    setSellerFilterInput(seller);

    setItemFilter(item);
    setMinistryFilter(ministry);
    setDepartmentFilter(department);
    setSellerFilter(seller);
  }, []);



  // ✅ STEP 5C — load global autosuggest ONCE
  useEffect(() => {
    gemResultsClientStore.getAutosuggest()
      .then(({ ministries, departments, sellers }) => {
        setMinistryOptions(ministries);
        setDepartmentOptions(departments);
        setSellerOptions(sellers);
      })
      .catch(err => {
        console.error("Failed to load autosuggest options:", err);
      });
  }, []);


  // Keep state in sync with URL
  useEffect(() => {
    const p = Number(searchParams.get("page") ?? 1);
    if (p !== currentPage) setCurrentPage(p);
  }, [searchParams, currentPage]);


  // Debounce INPUT → REAL filters (exactly like tender page)
  useEffect(() => {
    const t = setTimeout(() => {
      setItemFilter(itemFilterInput);
      setMinistryFilter(ministryFilterInput);
      setDepartmentFilter(departmentFilterInput);
      setSellerFilter(sellerFilterInput);
      setCurrentPage(1);
    }, 400);

    return () => clearTimeout(t);
  }, [
    itemFilterInput,
    ministryFilterInput,
    departmentFilterInput,
    sellerFilterInput,
  ]);


  // ✅ UPDATE URL WITHOUT NAVIGATION (NO REFRESH)
  useEffect(() => {
    const params = new URLSearchParams();

    params.set("page", "1");

    if (itemFilter) params.set("item", itemFilter);
    if (ministryFilter) params.set("ministry", ministryFilter);
    if (departmentFilter) params.set("department", departmentFilter);
    if (sellerFilter) params.set("seller", sellerFilter);

    const newUrl = `/results?${params.toString()}`;
    window.history.replaceState(null, "", newUrl);
  }, [itemFilter, ministryFilter, departmentFilter, sellerFilter]);

  const fetchResults = useCallback(async () => {
    setError(null);

    try {
      const { data, total } = await gemResultsClientStore.getResults({
        page: currentPage,
        limit: PAGE_SIZE,
        item: itemFilter || undefined,
        ministry: ministryFilter || undefined,
        department: departmentFilter || undefined,
        seller: sellerFilter || undefined,
      });

      setResults(data);
      setTotalRecords(total);
    } catch (err: any) {
      console.error("Results fetch failed:", err);
      setError(err?.message ?? "Failed to load results");
      setResults([]);
      setTotalRecords(0);
    } finally {
      setIsLoading(false);
    }
  }, [
    currentPage,
    itemFilter,
    ministryFilter,
    departmentFilter,
    sellerFilter,
  ]);


  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const clearFilters = () => {
    setItemFilterInput("");
    setMinistryFilterInput("");
    setDepartmentFilterInput("");
    setSellerFilterInput("");

    setItemFilter("");
    setMinistryFilter("");
    setDepartmentFilter("");
    setSellerFilter("");
  };


  const lastPage = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));

  const showingStart = useMemo(() => {
    if (totalRecords === 0) return 0;
    return (currentPage - 1) * PAGE_SIZE + 1;
  }, [currentPage, totalRecords]);

  const showingEnd = useMemo(() => {
    if (totalRecords === 0) return 0;
    return Math.min(totalRecords, currentPage * PAGE_SIZE);
  }, [currentPage, totalRecords]);

  const formatCurrency = (amount?: number | null) => {
    if (amount == null || Number.isNaN(amount)) return "N/A";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const safeDate = (val?: string | null) => {
    if (!val) return "N/A";
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return val;
    return d.toLocaleDateString("en-IN", { dateStyle: "medium" });
  };

    const getPrimaryTitle = (r: GemResult) => {
    // If RA exists, RA number becomes the MAIN title
    if (r.has_reverse_auction && r.ra_number) {
        return r.ra_number;
    }
    // Otherwise Bid number is the main title
    return r.bid_number;
    };

    const getSecondaryTitle = (r: GemResult) => {
    if (r.has_reverse_auction && r.ra_number && r.bid_number) {
        return `(Bid Number: ${r.bid_number})`;
    }
    return null;
    };

  
  if (isLoading) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="w-10 h-10 text-gray-300 animate-spin mx-auto" />
        <p className="text-gray-400 mt-3 font-medium">Loading results...</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="p-12 text-center bg-white border border-dashed rounded-xl m-6">
        <Database className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-bold">No results found</h3>
        {error && (
          <div className="mt-4 text-xs text-red-700 font-mono">{error}</div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Results</h1>
        <div className="text-sm text-gray-600">
          Showing <strong>{showingStart}</strong>–
          <strong>{showingEnd}</strong> of{" "}
          <strong>{totalRecords}</strong>
        </div>
      </div>

      {/* TOP FILTER BAR */}
      <div className="bg-white border rounded-xl shadow-sm p-4 mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">

        {/* L1 ITEM FILTER (simple text search) */}
        <div className="relative">
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
            L1 Item
          </label>
          <input
            value={itemFilterInput}
            onChange={(e) => setItemFilterInput(e.target.value)}
            placeholder="Search item..."
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>

        {/* MINISTRY AUTOSUGGEST */}
        <div className="relative">
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
            Ministry
          </label>
            <input
              value={ministryFilterInput}
              onFocus={() => setShowMinistryList(true)}
              onChange={(e) => {
                setMinistryFilterInput(e.target.value);
                setShowMinistryList(true);
              }}
              placeholder="Type ministry..."
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />


          {showMinistryList && ministryFilterInput && (
            <div className="absolute left-0 right-0 bg-white border mt-1 rounded shadow max-h-40 overflow-auto z-10">
              {ministryOptions
                .filter(m =>
                  m.toLowerCase().includes(ministryFilter.toLowerCase())
                )
                .slice(0, 8)
                .map(m => (
                  <div
                    key={m}
                    onClick={() => {
                      setMinistryFilterInput(m);
                      setShowMinistryList(false);   // <-- CLOSE dropdown
                    }}
                    className="px-3 py-2 text-sm hover:bg-gray-100 cursor-pointer"
                  >
                    {m}
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* DEPARTMENT AUTOSUGGEST */}
        <div className="relative">
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
            Department
          </label>
            <input
              value={departmentFilterInput}
              onFocus={() => setShowDepartmentList(true)}
              onChange={(e) => {
                setDepartmentFilterInput(e.target.value);
                setShowDepartmentList(true);
              }}
              placeholder="Type department..."
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />

          {showDepartmentList && departmentFilterInput && (
            <div className="absolute left-0 right-0 bg-white border mt-1 rounded shadow max-h-40 overflow-auto z-10">
              {departmentOptions
                .filter(d =>
                  d.toLowerCase().includes(departmentFilter.toLowerCase())
                )
                .slice(0, 8)
                .map(d => (
                  <div
                    key={d}
                    onClick={() => {
                      setDepartmentFilterInput(d);
                      setShowDepartmentList(false);
                    }}
                    className="px-3 py-2 text-sm hover:bg-gray-100 cursor-pointer"
                  >
                    {d}
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* SELLER AUTOSUGGEST (L1/L2/L3) */}
        <div className="relative">
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
            Seller (L1/L2/L3)
          </label>
            <input
              value={sellerFilterInput}
              onFocus={() => setShowSellerList(true)}
              onChange={(e) => {
                setSellerFilterInput(e.target.value);
                setShowSellerList(true);
              }}
              placeholder="Search seller..."
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          {showSellerList && sellerFilterInput && (
            <div className="absolute left-0 right-0 bg-white border mt-1 rounded shadow max-h-40 overflow-auto z-10">
              {sellerOptions
                .filter(s =>
                  s.toLowerCase().includes(sellerFilter.toLowerCase())
                )
                .slice(0, 8)
                .map(s => (
                  <div
                    key={s}
                    onClick={() => {
                      setSellerFilterInput(s);
                      setShowSellerList(false);
                    }}
                    className="px-3 py-2 text-sm hover:bg-gray-100 cursor-pointer"
                  >
                    {s}
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="col-span-full flex justify-end">
          <button
            onClick={clearFilters}
            className="text-sm text-blue-600 hover:underline"
          >
            Clear all filters
          </button>
        </div>
      </div>

      {/* Cards */}
      <div className="space-y-4">
        {results.map((r) => (
          <div
            key={r.id ?? r.bid_number}
            className="bg-white border rounded-xl shadow-sm p-5 hover:shadow-md transition"
          >
        {/* TITLE + SECONDARY TITLE + ITEM */}
        <div className="mb-3">
        {r.has_reverse_auction && r.ra_number ? (
        <a
            href={r.ra_detail_url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="text-lg font-semibold text-blue-700 hover:underline block"
        >
            {r.ra_number}
        </a>
        ) : (
        <a
            href={r.bid_detail_url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="text-lg font-semibold text-blue-700 hover:underline block"
        >
            {r.bid_number}
        </a>
        )}


        {/* Secondary title in brackets (only when RA exists) */}
        {getSecondaryTitle(r) && r.bid_detail_url && (
        <a
            href={r.bid_detail_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gray-700 font-medium mt-0.5 hover:underline"
        >
            {getSecondaryTitle(r)}
        </a>
        )}


        {/* ITEM ALWAYS IN CAPS */}
        {r.l1_item && (
            <p className="text-sm text-gray-600 mt-1 line-clamp-1 uppercase">
            {r.l1_item}
            </p>
        )}
        </div>



            {/* Meta row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
                <div className="flex items-start gap-2">
                <Building2 className="w-4 h-4 text-blue-600 mt-0.5" />
                <div>
                    {/* PRIMARY LINE: Ministry */}
                    <p className="font-semibold">
                    {r.ministry || "Ministry not specified"}
                    </p>

                    {/* SECOND LINE: Department (only if available) */}
                    {r.department && (
                    <p className="text-sm text-gray-600 mt-0.5">
                        {r.department}
                    </p>
                    )}

                    {/* TERTIARY LINE: Organisation address (smaller, lighter) */}
                    {r.organisation_address && (
                    <p className="text-xs text-gray-500 mt-0.5">
                        {r.organisation_address}
                    </p>
                    )}
                </div>
                </div>


              <div className="flex items-center gap-3 text-gray-600">
                <Calendar className="w-4 h-4" />
                <span>
                  Start: {safeDate(r.start_datetime)} | End:{" "}
                  {safeDate(r.end_datetime)}
                </span>
              </div>
            </div>

            {/* Tech stats */}
            {(r.tech_participated != null || r.tech_qualified != null) && (
              <div className="text-xs text-gray-700 mb-4 bg-gray-50 p-2 rounded border">
                Participated:{" "}
                <strong>{r.tech_participated ?? "N/A"}</strong> • Qualified:{" "}
                <strong>{r.tech_qualified ?? "N/A"}</strong>
              </div>
            )}

            {/* L1 / L2 / L3 PANEL (NO ITEMS — as you requested) */}
            <div className="border rounded-lg overflow-hidden text-sm">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left">Rank</th>
                    <th className="px-3 py-2 text-left">Seller</th>
                    <th className="px-3 py-2 text-right">Price</th>
                  </tr>
                </thead>
                <tbody>
                {/* L1 — always show */}
                <tr className="border-b">
                    <td className="px-3 py-2 font-semibold">L1</td>
                    <td className="px-3 py-2">
                    {r.l1_seller ?? "N/A"}
                    </td>
                    <td className="px-3 py-2 text-right">
                    {formatCurrency(r.l1_price)}
                    </td>
                </tr>

                {/* L2 — show only if exists */}
                {r.l2_seller && (
                    <tr className="border-b">
                    <td className="px-3 py-2 font-semibold">L2</td>
                    <td className="px-3 py-2">
                        {r.l2_seller}
                    </td>
                    <td className="px-3 py-2 text-right">
                        {formatCurrency(r.l2_price)}
                    </td>
                    </tr>
                )}

                {/* L3 — show only if exists */}
                {r.l3_seller && (
                    <tr>
                    <td className="px-3 py-2 font-semibold">L3</td>
                    <td className="px-3 py-2">
                        {r.l3_seller}
                    </td>
                    <td className="px-3 py-2 text-right">
                        {formatCurrency(r.l3_price)}
                    </td>
                    </tr>
                )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
        {totalRecords > 0 && (
        <div className="py-8 flex justify-center">
            <div className="flex items-center gap-2">
            {/* Prev Button */}
            <button
                onClick={() => router.push(`/results?page=${currentPage - 1}`)}
                disabled={currentPage === 1}
                className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-all
                ${
                    currentPage === 1
                    ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                }
                `}
            >
                Prev
            </button>

            {/* Page Numbers (same logic as Tenders) */}
            {(() => {
                const pages: (number | string)[] = [];
                const total = lastPage;

                const add = (p: number | string) => pages.push(p);

                add(1);

                if (currentPage > 4) add("...");

                const start = Math.max(2, currentPage - 2);
                const end = Math.min(total - 1, currentPage + 2);

                for (let i = start; i <= end; i++) add(i);

                if (currentPage < total - 3) add("...");

                if (total > 1) add(total);

                return pages.map((p, idx) =>
                p === "..." ? (
                    <span key={`ellipsis-${idx}`} className="px-2 text-gray-500">
                    …
                    </span>
                ) : (
                    <button
                    key={`page-${p}`}
                    onClick={() => router.push(`/results?page=${p}`)}
                    className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-all
                        ${
                        p === currentPage
                            ? "bg-blue-600 text-white border-blue-600 shadow"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                        }
                    `}
                    >
                    {p}
                    </button>
                )
                );
            })()}

            {/* Next Button */}
            <button
                onClick={() =>
                router.push(`/results?page=${Math.min(lastPage, currentPage + 1)}`)
                }
                disabled={currentPage === lastPage}
                className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-all
                ${
                    currentPage === lastPage
                    ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                }
                `}
            >
                Next
            </button>
            </div>
        </div>
        )}
    </div>
  );
}
