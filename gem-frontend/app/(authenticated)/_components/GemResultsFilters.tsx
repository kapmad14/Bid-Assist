"use client";

import React from "react";
import { Info } from "lucide-react";

/**
 * Reusable filter container that renders the full
 * Results-page filter bar.
 *
 * NOTE: All state lives in the parent page —
 * this component is purely presentational.
 */
export function GemResultsFilters(props: {
  // --- INPUT VALUES ---
  itemFilterInput: string;
  ministryFilterInput: string;
  departmentFilterInput: string;
  sellerFilterInput: string;
  bidRaFilterInput: string;
  globalSearchInput: string;

  // --- SETTERS ---
  setItemFilterInput: (v: string) => void;
  setMinistryFilterInput: (v: string) => void;
  setDepartmentFilterInput: (v: string) => void;
  setSellerFilterInput: (v: string) => void;
  setBidRaFilterInput: (v: string) => void;
  setGlobalSearchInput: (v: string) => void;

  // --- CLEAR ---
  clearFilters: () => void;

  // --- AUTOSUGGEST OPTIONS ---
  ministryOptions: string[];
  departmentOptions: string[];
  sellerOptions: string[];

  // --- DROPDOWN VISIBILITY ---
  showMinistryList: boolean;
  setShowMinistryList: (v: boolean) => void;
  showDepartmentList: boolean;
  setShowDepartmentList: (v: boolean) => void;
  showSellerList: boolean;
  setShowSellerList: (v: boolean) => void;

  // --- REFS FOR OUTSIDE-CLICK ---
  ministryRef: React.RefObject<HTMLDivElement>;
  departmentRef: React.RefObject<HTMLDivElement>;
  sellerRef: React.RefObject<HTMLDivElement>;

  // --- KEYBOARD INDICES ---
  ministryIndex: number;
  setMinistryIndex: (n: number) => void;
  departmentIndex: number;
  setDepartmentIndex: (n: number) => void;
  sellerIndex: number;
  setSellerIndex: (n: number) => void;
}) {

  // ================== 🔹 ADD THIS DESTRUCTURING HERE 🔹 ==================
  const {
    itemFilterInput,
    ministryFilterInput,
    departmentFilterInput,
    sellerFilterInput,
    bidRaFilterInput,
    globalSearchInput,

    setItemFilterInput,
    setMinistryFilterInput,
    setDepartmentFilterInput,
    setSellerFilterInput,
    setBidRaFilterInput,
    setGlobalSearchInput,

    clearFilters,

    ministryOptions,
    departmentOptions,
    sellerOptions,

    showMinistryList,
    setShowMinistryList,
    showDepartmentList,
    setShowDepartmentList,
    showSellerList,
    setShowSellerList,

    ministryRef,
    departmentRef,
    sellerRef,

    ministryIndex,
    setMinistryIndex,
    departmentIndex,
    setDepartmentIndex,
    sellerIndex,
    setSellerIndex,
  } = props;
  // ======================================================================

  return (
    <div className="bg-white border rounded-xl shadow-sm px-4 py-3 mb-6 grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-3">
      
      {/* ====== USER GUIDE ====== */}
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
  );
}
