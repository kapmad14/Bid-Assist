"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Clock, Building2, Calendar, Database, Info, Trophy } from "lucide-react";

import { gemResultsClientStore } from "@/services/gemResultsStore.client";
import { GemResult } from "@/types";

const PAGE_SIZE = 20;

export default function ResultsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPage = Number(searchParams?.get("page") ?? 1);

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
  const [bidRaFilterInput, setBidRaFilterInput] = useState("");
  const [globalSearchInput, setGlobalSearchInput] = useState("");


  // Actual filters that trigger fetch (slow)
  const [itemFilter, setItemFilter] = useState("");
  const [ministryFilter, setMinistryFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [sellerFilter, setSellerFilter] = useState("");
  const [bidRaFilter, setBidRaFilter] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  


  // ---------- AUTOSUGGEST STATE (CLEAN SINGLE SOURCE OF TRUTH) ----------

  // refs for outside-click handling
  const ministryRef = React.useRef<HTMLDivElement | null>(null);
  const departmentRef = React.useRef<HTMLDivElement | null>(null);
  const sellerRef = React.useRef<HTMLDivElement | null>(null);

  // keyboard selection indices
  const [ministryIndex, setMinistryIndex] = useState(-1);
  const [departmentIndex, setDepartmentIndex] = useState(-1);
  const [sellerIndex, setSellerIndex] = useState(-1);

  // dropdown visibility flags
  const [showMinistryList, setShowMinistryList] = useState(false);
  const [showDepartmentList, setShowDepartmentList] = useState(false);
  const [showSellerList, setShowSellerList] = useState(false);

  // Global autosuggest options loaded once from server
  const [ministryOptions, setMinistryOptions] = useState<string[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [sellerOptions, setSellerOptions] = useState<string[]>([]);

  const [previewForId, setPreviewForId] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Load filters from URL on first render
  useEffect(() => {
    const item = searchParams?.get("item") || "";
    const ministry = searchParams?.get("ministry") || "";
    const department = searchParams?.get("department") || "";
    const seller = searchParams?.get("seller") || "";
    const bidRa = searchParams?.get("bidRa") || "";
    const global = searchParams?.get("global") || "";


    // Sync BOTH input + real filters
    setItemFilterInput(item);
    setMinistryFilterInput(ministry);
    setDepartmentFilterInput(department);
    setSellerFilterInput(seller);
    setBidRaFilterInput(bidRa);
    setGlobalSearchInput(global);

    setItemFilter(item);
    setMinistryFilter(ministry);
    setDepartmentFilter(department);
    setSellerFilter(seller);
    setBidRaFilter(bidRa);
    setGlobalSearch(global);
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

  // ✅ STEP 2 — close dropdowns when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;

      if (ministryRef.current && !ministryRef.current.contains(t)) {
        setShowMinistryList(false);
        setMinistryIndex(-1);
      }

      if (departmentRef.current && !departmentRef.current.contains(t)) {
        setShowDepartmentList(false);
        setDepartmentIndex(-1);
      }

      if (sellerRef.current && !sellerRef.current.contains(t)) {
        setShowSellerList(false);
        setSellerIndex(-1);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);


  // Keep state in sync with URL
  useEffect(() => {
    const p = Number(searchParams?.get("page") ?? 1);
    if (p !== currentPage) setCurrentPage(p);
  }, [searchParams, currentPage]);


  // Clear any open PDF preview when page changes
  useEffect(() => {
    setPreviewForId(null);
    setPreviewUrl(null);
  }, [currentPage]);


  // Debounce INPUT → REAL filters (exactly like tender page)
  useEffect(() => {
    const t = setTimeout(() => {
      setItemFilter(itemFilterInput);
      setMinistryFilter(ministryFilterInput);
      setDepartmentFilter(departmentFilterInput);
      setSellerFilter(sellerFilterInput);
      setBidRaFilter(bidRaFilterInput);
      setGlobalSearch(globalSearchInput);
      setCurrentPage(1);
    }, 400);

    return () => clearTimeout(t);
  }, [
    itemFilterInput,
    ministryFilterInput,
    departmentFilterInput,
    sellerFilterInput,
    bidRaFilterInput,
    globalSearchInput,
  ]);


  // ✅ UPDATE URL WITHOUT NAVIGATION (NO REFRESH)
  useEffect(() => {
    const params = new URLSearchParams();

    params.set("page", "1");

    if (itemFilter) params.set("item", itemFilter);
    if (ministryFilter) params.set("ministry", ministryFilter);
    if (departmentFilter) params.set("department", departmentFilter);
    if (sellerFilter) params.set("seller", sellerFilter);
    if (bidRaFilter) params.set("bidRa", bidRaFilter);
    if (globalSearch) params.set("global", globalSearch);

    const newUrl = `/results?${params.toString()}`;
    window.history.replaceState(null, "", newUrl);
  }, [itemFilter, ministryFilter, departmentFilter, sellerFilter, bidRaFilter, globalSearch]);

  const openPreview = (id: number, gemUrl?: string | null) => {
    if (!gemUrl) return;

    // If clicking same card again → close preview
    if (previewForId === id) {
      closePreview();
      return;
    }

    setPreviewForId(id);
    setPreviewUrl(`/api/open-pdf?url=${encodeURIComponent(gemUrl)}`);
  };


  const closePreview = () => {
    setPreviewForId(null);
    setPreviewUrl(null);
  };


  const fetchResults = useCallback(async () => {
    setError(null);

    try {
      const { data, total } = await gemResultsClientStore.getResults({
        page: currentPage,
        limit: PAGE_SIZE,
        global: globalSearch || undefined,
        bidRa: bidRaFilter || undefined,
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
    bidRaFilter,
    globalSearch,
  ]);


  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const clearFilters = () => {
    setItemFilterInput("");
    setMinistryFilterInput("");
    setDepartmentFilterInput("");
    setSellerFilterInput("");
    setBidRaFilterInput("");
    setGlobalSearchInput("");

    setItemFilter("");
    setMinistryFilter("");
    setDepartmentFilter("");
    setSellerFilter("");
    setBidRaFilter("");
    setGlobalSearch("");
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

  const formatPriceGap = (base?: number | null, price?: number | null) => {
    if (!base || !price) return "–";
    const gap = ((price / base) - 1) * 100;
    return `${gap.toFixed(1)}%`;
  };

  const safeDate = (val?: string | null) => {
    if (!val) return "N/A";
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return val;
    return d.toLocaleDateString("en-IN", { dateStyle: "medium" });
  };

  
  if (isLoading) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="w-10 h-10 text-gray-300 animate-spin mx-auto" />
        <p className="text-gray-400 mt-3 font-medium">Loading results...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
      {/* TOP FILTER BAR — TWO ROW LAYOUT */}
      <div className="bg-white border rounded-xl shadow-sm px-4 py-3 mb-6 grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-3">

        {/* ---------- ROW 1 ---------- */}

        {/* 1) USER GUIDE TEXT — constrained width so wrap happens after "for" */}
        <div className="flex items-center text-sm text-gray-700 max-w-[200px] leading-snug">
          <Info className="w-4 h-4 mr-2 text-blue-600 flex-shrink-0" />
          <span className="font-medium">
            Customize filters for targeted results
          </span>
        </div>


        {/* BID / RA NUMBER FILTER */}
        <div className="relative">
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
            Bid / RA Number
          </label>

          <div className="relative">
            <input
              value={bidRaFilterInput}
              onChange={(e) => setBidRaFilterInput(e.target.value)}
              placeholder="Search Bid or RA Number..."
              className="w-full border rounded-lg px-3 py-2 text-sm pr-8"
            />

            {bidRaFilterInput && (
              <button
                type="button"
                onClick={() => {
                  setBidRaFilterInput("");
                  setBidRaFilter("");
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* L1 ITEM FILTER (simple text search) */}
        <div className="relative">
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
            Item Name
          </label>

          <div className="relative">
            <input
              value={itemFilterInput}
              onChange={(e) => setItemFilterInput(e.target.value)}
              placeholder="Search Item..."
              className="w-full border rounded-lg px-3 py-2 text-sm pr-8"
            />

            {itemFilterInput && (
              <button
                type="button"
                onClick={() => setItemFilterInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              >
                ✕
              </button>
            )}
          </div>
        </div>



        {/* MINISTRY AUTOSUGGEST */}
        <div className="relative">
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
            Ministry
          </label>
            <div className="relative">
              <input
                value={ministryFilterInput}
                onFocus={() => {
                  setShowMinistryList(true);
                  setMinistryIndex(-1);
                }}
                onChange={(e) => {
                  setMinistryFilterInput(e.target.value);
                  setShowMinistryList(true);
                  setMinistryIndex(-1);
                }}
                onKeyDown={(e) => {
                  const filtered = ministryOptions
                    .filter(m =>
                      m.toLowerCase().includes(ministryFilterInput.toLowerCase())
                    )
                    .slice(0, 8);

                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMinistryIndex(i => Math.min(i + 1, filtered.length - 1));
                  }

                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMinistryIndex(i => Math.max(i - 1, 0));
                  }

                  if (e.key === "Enter" && ministryIndex >= 0) {
                    e.preventDefault();
                    const picked = filtered[ministryIndex];
                    if (picked) {
                      setMinistryFilterInput(picked);
                      setShowMinistryList(false);
                    }
                  }
                }}
                placeholder="Type Ministry Name..."
                className="w-full border rounded-lg px-3 py-2 text-sm pr-8"
              />

              {ministryFilterInput && (
                <button
                  type="button"
                  onClick={() => {
                    setMinistryFilterInput("");
                    setMinistryFilter("");
                    setShowMinistryList(false);
                    setMinistryIndex(-1);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                  ✕
                </button>
              )}
            </div>


            {showMinistryList && ministryFilterInput && (
              <div
                ref={ministryRef}
                className="absolute left-0 right-0 bg-white border mt-1 rounded shadow max-h-40 overflow-auto z-10"
              >
              {ministryOptions
                .filter(m =>
                  m.toLowerCase().includes(ministryFilterInput.toLowerCase())
                )
                .slice(0, 8)
                .map((m, idx) => (
                  <div
                    key={m}
                    onMouseEnter={() => setMinistryIndex(idx)}
                    onClick={() => {
                      setMinistryFilterInput(m);
                      setShowMinistryList(false);
                    }}
                    className={`px-3 py-2 text-sm cursor-pointer ${
                      idx === ministryIndex ? "bg-blue-50" : "hover:bg-gray-100"
                    }`}
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
            <div className="relative">
              <input
                value={departmentFilterInput}
                onFocus={() => {
                  setShowDepartmentList(true);
                  setDepartmentIndex(-1);
                }}
                onChange={(e) => {
                  setDepartmentFilterInput(e.target.value);
                  setShowDepartmentList(true);
                  setDepartmentIndex(-1);
                }}
                onKeyDown={(e) => {
                  const filtered = departmentOptions
                    .filter(d =>
                      d.toLowerCase().includes(departmentFilterInput.toLowerCase())
                    )
                    .slice(0, 8);

                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setDepartmentIndex(i => Math.min(i + 1, filtered.length - 1));
                  }

                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setDepartmentIndex(i => Math.max(i - 1, 0));
                  }

                  if (e.key === "Enter" && departmentIndex >= 0) {
                    e.preventDefault();
                    const picked = filtered[departmentIndex];
                    if (picked) {
                      setDepartmentFilterInput(picked);
                      setShowDepartmentList(false);
                    }
                  }
                }}
                placeholder="Type Department Name..."
                className="w-full border rounded-lg px-3 py-2 text-sm pr-8"
              />

              {departmentFilterInput && (
                <button
                  type="button"
                  onClick={() => {
                    setDepartmentFilterInput("");
                    setDepartmentFilter("");
                    setShowDepartmentList(false);
                    setDepartmentIndex(-1);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                  ✕
                </button>
              )}
            </div>


            {showDepartmentList && departmentFilterInput && (
              <div
                ref={departmentRef}
                className="absolute left-0 right-0 bg-white border mt-1 rounded shadow max-h-40 overflow-auto z-10"
              >
              {departmentOptions
                .filter(d =>
                  d.toLowerCase().includes(departmentFilterInput.toLowerCase())
                )
                .slice(0, 8)
                .map((d, idx) => (
                  <div
                    key={d}
                    onMouseEnter={() => setDepartmentIndex(idx)}
                    onClick={() => {
                      setDepartmentFilterInput(d);
                      setShowDepartmentList(false);
                    }}
                    className={`px-3 py-2 text-sm cursor-pointer ${
                      idx === departmentIndex ? "bg-blue-50" : "hover:bg-gray-100"
                    }`}
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
            Seller Name
          </label>
            <div className="relative">
              <input
                value={sellerFilterInput}
                onFocus={() => {
                  setShowSellerList(true);
                  setSellerIndex(-1);
                }}
                onChange={(e) => {
                  setSellerFilterInput(e.target.value);
                  setShowSellerList(true);
                  setSellerIndex(-1);
                }}
                onKeyDown={(e) => {
                  const filtered = sellerOptions
                    .filter(s =>
                      s.toLowerCase().includes(sellerFilterInput.toLowerCase())
                    )
                    .slice(0, 8);

                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSellerIndex(i => Math.min(i + 1, filtered.length - 1));
                  }

                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSellerIndex(i => Math.max(i - 1, 0));
                  }

                  if (e.key === "Enter" && sellerIndex >= 0) {
                    e.preventDefault();
                    const picked = filtered[sellerIndex];
                    if (picked) {
                      setSellerFilterInput(picked);
                      setShowSellerList(false);
                    }
                  }
                }}
                placeholder="Search Seller Name..."
                className="w-full border rounded-lg px-3 py-2 text-sm pr-8"
              />

              {sellerFilterInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSellerFilterInput("");
                    setSellerFilter("");
                    setShowSellerList(false);
                    setSellerIndex(-1);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                  ✕
                </button>
              )}
            </div>


            {showSellerList && sellerFilterInput && (
              <div
                ref={sellerRef}
                className="absolute left-0 right-0 bg-white border mt-1 rounded shadow max-h-40 overflow-auto z-10"
              >
              {sellerOptions
                .filter(s =>
                  s.toLowerCase().includes(sellerFilterInput.toLowerCase())
                )
                .slice(0, 8)
                .map((s, idx) => (
                  <div
                    key={s}
                    onMouseEnter={() => setSellerIndex(idx)}
                    onClick={() => {
                      setSellerFilterInput(s);
                      setSellerFilter("");
                      setShowSellerList(false);
                      setSellerIndex(-1);
                    }}
                    className={`px-3 py-2 text-sm cursor-pointer ${
                      idx === sellerIndex ? "bg-blue-50" : "hover:bg-gray-100"
                    }`}
                  >
                    {s}
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* GLOBAL SEARCH */}
        <div className="relative">
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
            General Search
          </label>

          <div className="relative">
            <input
              value={globalSearchInput}
              onChange={(e) => setGlobalSearchInput(e.target.value)}
              placeholder="Search Everything..."
              className="w-full border rounded-lg px-3 py-2 text-sm pr-8"
            />

            {globalSearchInput && (
              <button
                type="button"
                onClick={() => {
                  setGlobalSearchInput("");
                  setGlobalSearch("");
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* ROW 2 — COLUMN 4: CLEAR ALL PILL (CENTERED) */}
        <div className="flex items-center justify-center pt-4">
          <button
            onClick={clearFilters}
            className="
              text-xs
              text-blue-700
              bg-blue-50
              border border-blue-200
              hover:bg-blue-100
              px-3 py-1
              rounded-full
              transition
              whitespace-nowrap
            "
          >
            Clear all filters
          </button>
        </div>



      </div>

      {/* Cards — TWO PER ROW */}
      {results.length === 0 ? (
        <div className="p-12 text-center bg-white border border-dashed rounded-xl">
          {/* Small illustration / visual cue */}
          <Database className="w-14 h-14 text-gray-300 mx-auto mb-4" />

          <h3 className="text-lg font-bold">No results found</h3>

          <p className="mt-2 text-sm text-gray-600">
            Try adjusting your filters or search terms.
          </p>

          {/* Reset button INSIDE the empty card */}
          <div className="mt-5">
            <button
              onClick={clearFilters}
              className="
                text-sm
                text-blue-700
                bg-blue-50
                border border-blue-200
                hover:bg-blue-100
                px-4 py-2
                rounded-lg
                transition
              "
            >
              Reset filters
            </button>
          </div>

          {error && (
            <div className="mt-4 text-xs text-red-700 font-mono">{error}</div>
          )}
        </div>
      ) : (
          <div className="grid grid-cols-1 gap-4">
            {results.map((r) => (
              <React.Fragment key={r.id ?? r.bid_number}>
              <div
                className="bg-white border rounded-xl shadow-sm p-3 hover:shadow-md transition"
              >

                <div className="grid grid-cols-2 gap-6 items-start">

                  {/* ========== LEFT COLUMN (50%) ========== */}
                  <div className="space-y-4 min-w-0">

                    {/* -------- TOP ROW: PRIMARY TITLE + DATE -------- */}
                    <div className="mb-2 flex items-start justify-between">

                      {/* LEFT: ALWAYS TWO-LINE TITLE AREA (ensures alignment) */}
                      <div className="max-w-[85%] flex flex-col">

                        {/* LINE 1 — PRIMARY TITLE (your logic) */}
                        {r.has_reverse_auction && r.ra_number ? (
                          <button
                            onClick={() => openPreview(r.id!, r.ra_detail_url)}
                            className="text-lg font-semibold text-blue-700 hover:underline block leading-tight text-left"
                          >
                            {r.ra_number}
                          </button>
                        ) : (
                          <button
                            onClick={() => openPreview(r.id!, r.bid_detail_url)}
                            className="text-lg font-semibold text-blue-700 hover:underline block leading-tight text-left"
                          >
                            {r.bid_number}
                          </button>
                        )}

                        {/* LINE 2 — REAL SECONDARY OR PURE PLACEHOLDER */}
                        {r.has_reverse_auction && r.ra_number && r.bid_number ? (
                          <button
                            onClick={() => openPreview(r.id!, r.bid_detail_url)}
                            className="text-sm text-gray-700 font-medium hover:underline block mt-1 text-left"
                          >
                            (Bid No. {r.bid_number})
                          </button>
                        ) : (
                          <div className="h-[20px]" />
                        )}

                      </div>

                      {/* RIGHT: DATE — unchanged */}
                      <div className="flex items-center gap-2 text-xs text-gray-500 whitespace-nowrap mt-0">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>
                          {safeDate(r.start_datetime)} → {safeDate(r.end_datetime)}
                        </span>
                      </div>

                    </div>

                    {/* -------- BELOW: secondary title + item (separate layer) -------- */}
                    {r.l1_item && (
                      <p
                        className="text-sm text-gray-600 mt-4 line-clamp-1 uppercase truncate"
                        title={r.l1_item}
                      >
                        {r.l1_item}
                      </p>
                    )}

                    {/* META + TECH STATS — 3 COLUMN LAYOUT (60 / 20 / 20) */}
                    <div className="grid grid-cols-[minmax(0,3fr)_auto_auto] gap-4 text-sm mb-4 mt-3 items-start">

                      {/* COLUMN 1 — MINISTRY + DEPARTMENT */}
                      <div className="flex items-start gap-2 min-w-0">
                        <Building2 className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="font-semibold truncate">
                            {r.ministry || "Ministry not specified"}
                          </p>

                          {r.department && (
                            <p className="text-sm text-gray-600 mt-0.5 truncate">
                              {r.department}
                            </p>
                          )}

                          {r.organisation_address && (
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                              {r.organisation_address}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* COLUMN 2 — PARTICIPATED */}
                      <div className="
                        w-[85px] h-[53px]
                        rounded-2xl
                        bg-[#F3F4F6] border border-gray-200
                        flex flex-col items-center justify-center shrink-0
                      ">
                        <p className="text-xs text-gray-500">Participated</p>
                        <p className="text-lg font-semibold text-gray-600">
                          {r.tech_participated ?? "N/A"}
                        </p>
                      </div>

                      {/* COLUMN 3 — QUALIFIED */}
                      <div className="
                        w-[85px] h-[53px]
                        rounded-2xl
                        bg-green-50 border border-green-200
                        flex flex-col items-center justify-center shrink-0
                      ">
                        <p className="text-xs text-green-700">Qualified</p>
                        <p className="text-lg font-semibold text-green-600">
                          {r.tech_qualified ?? "N/A"}
                        </p>
                      </div>

                    </div>
                  </div>
                  {/* ========== END LEFT COLUMN ========== */}

                  {/* ========== RIGHT COLUMN (50%) ========== */}
                  <div className="overflow-x-auto">

                    <div className="rounded-lg overflow-hidden text-xs bg-white">
                      <table className="w-full border-collapse">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium text-gray-700">
                              Rank
                            </th>
                            <th className="px-2 py-1.5 text-left font-medium text-gray-700">
                              Seller
                            </th>
                            <th className="px-2 py-1.5 text-right font-medium text-gray-700">
                              Price
                            </th>
                            <th className="px-2 py-1.5 text-right font-medium text-gray-700">
                              Price Gap %
                            </th>
                          </tr>
                        </thead>

                        <tbody className="divide-y divide-gray-200">
                          {/* L1 */}
                          <tr className="border-b border-gray-200 last:border-b-0">
                            <td className="px-2 py-2.5 font-semibold flex items-center gap-2">
                              <span>L1</span>
                              <Trophy className="w-5 h-5 text-[#FACC15]" />
                            </td>

                            <td
                              className="px-2 py-2.5 uppercase truncate max-w-[220px]"
                              title={r.l1_seller ?? "N/A"}
                            >
                              {r.l1_seller ? r.l1_seller.toUpperCase() : "N/A"}
                            </td>

                            <td className="px-2 py-2.5 text-right">
                              {formatCurrency(r.l1_price)}
                            </td>

                            <td className="px-2 py-2.5 text-right text-gray-500">–</td>
                          </tr>

                          {/* L2 */}
                          {r.l2_seller && (
                            <tr className="border-b border-gray-200 last:border-b-0">
                              <td className="px-2 py-2.5 font-semibold">L2</td>
                              <td
                                className="px-2 py-2.5 uppercase truncate max-w-[220px]"
                                title={r.l2_seller}
                              >
                                {r.l2_seller.toUpperCase()}
                              </td>
                              <td className="px-2 py-2.5 text-right">
                                {formatCurrency(r.l2_price)}
                              </td>
                              <td className="px-2 py-2.5 text-right font-medium text-gray-700">
                                {formatPriceGap(r.l1_price, r.l2_price)}
                              </td>
                            </tr>
                          )}

                          {/* L3 */}
                          {r.l3_seller && (
                            <tr className="border-b border-gray-200 last:border-b-0">
                              <td className="px-2 py-2.5 font-semibold">L3</td>
                              <td
                                className="px-2 py-2.5 uppercase truncate max-w-[220px]"
                                title={r.l3_seller}
                              >
                                {r.l3_seller.toUpperCase()}
                              </td>
                              <td className="px-2 py-2.5 text-right">
                                {formatCurrency(r.l3_price)}
                              </td>
                              <td className="px-2 py-2.5 text-right font-medium text-gray-700">
                                {formatPriceGap(r.l1_price, r.l3_price)}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                  </div>
                  {/* ========== END RIGHT COLUMN ========== */}

                </div>

              </div>
              {/* ====== INLINE PDF PREVIEW BETWEEN CARDS ====== */}
              {previewForId === r.id && previewUrl && (
                <div className="bg-white border rounded-xl shadow-sm p-3 mt-2">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-semibold">
                      Document Preview for {r.bid_number}
                    </h3>
                    <button
                      onClick={() => {
                        setPreviewForId(null);
                        setPreviewUrl(null);
                      }}
                      className="text-xs text-red-600"
                    >
                      Close ✕
                    </button>
                  </div>

                  <iframe
                    src={previewUrl}
                    className="w-full h-[650px] border rounded"
                    title="PDF Preview"
                  />
                </div>
              )}
              {/* ====== END PREVIEW ====== */}

            </React.Fragment>
            ))}
          </div>
        )} 

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
