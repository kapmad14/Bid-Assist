"use client";

import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import { gemResultsClientStore } from "@/services/gemResultsStore.client";

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

  catalogueCategories: string[];
  setCatalogueCategories: (v: string[]) => void;
  catalogueOptions: string[];

  // --- SETTERS ---
  setItemFilterInput: (v: string) => void;
  setMinistryFilterInput: (v: string) => void;
  setDepartmentFilterInput: (v: string) => void;
  setSellerFilterInput: (v: string) => void;
  setBidRaFilterInput: (v: string) => void;
  setGlobalSearchInput: (v: string) => void;

  // --- CLEAR ---
  clearFilters: () => void;

  // --- RESULTS COUNT ---
  totalResults: number;

  // --- AUTOSUGGEST OPTIONS ---
  ministryOptions: string[];
  departmentOptions: string[];

  // --- DROPDOWN VISIBILITY ---
  showMinistryList: boolean;
  setShowMinistryList: (v: boolean) => void;
  showDepartmentList: boolean;
  setShowDepartmentList: (v: boolean) => void;
  showSellerList: boolean;
  setShowSellerList: (v: boolean) => void;

  // --- REFS FOR OUTSIDE-CLICK ---
  ministryRef: React.MutableRefObject<HTMLDivElement | null>;
  departmentRef: React.MutableRefObject<HTMLDivElement | null>;
  sellerRef: React.MutableRefObject<HTMLDivElement | null>;

  // --- KEYBOARD INDICES ---
  ministryIndex: number;
  setMinistryIndex: React.Dispatch<React.SetStateAction<number>>;
  departmentIndex: number;
  setDepartmentIndex: React.Dispatch<React.SetStateAction<number>>;
  sellerIndex: number;
  setSellerIndex: React.Dispatch<React.SetStateAction<number>>;
}) {

  // ================== 🔹 ADD THIS DESTRUCTURING HERE 🔹 ==================
  const {
    itemFilterInput,
    ministryFilterInput,
    departmentFilterInput,
    sellerFilterInput,
    bidRaFilterInput,
    globalSearchInput,

    catalogueCategories,
    setCatalogueCategories,
    catalogueOptions,

    setItemFilterInput,
    setMinistryFilterInput,
    setDepartmentFilterInput,
    setSellerFilterInput,
    setBidRaFilterInput,
    setGlobalSearchInput,

    clearFilters,
    totalResults,

    ministryOptions,
    departmentOptions,

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

  // ✅ Live seller autosuggest (fetched on demand)
  const [sellerLiveOptions, setSellerLiveOptions] = useState<string[]>([]);
  const [sellerLoading, setSellerLoading] = useState(false);

  // ✅ Step 3: Detect if any filter is active
  const hasActiveFilters =
    itemFilterInput.trim() !== "" ||
    ministryFilterInput.trim() !== "" ||
    departmentFilterInput.trim() !== "" ||
    sellerFilterInput.trim() !== "" ||
    bidRaFilterInput.trim() !== "" ||
    globalSearchInput.trim() !== "";

const hasCatalogueActive = catalogueCategories.length > 0;

  // ✅ Ranked + limited dropdown options (Ministry & Department)
const rankedMinistries = ministryOptions
  .filter((m) =>
    m.toLowerCase().includes(ministryFilterInput.toLowerCase())
  )
  .sort((a, b) => {
    const q = ministryFilterInput.toLowerCase();

    const aStarts = a.toLowerCase().startsWith(q);
    const bStarts = b.toLowerCase().startsWith(q);

    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;

    return a.localeCompare(b);
  })
  .slice(0, 8);

const rankedDepartments = departmentOptions
  .filter((d) =>
    d.toLowerCase().includes(departmentFilterInput.toLowerCase())
  )
  .sort((a, b) => {
    const q = departmentFilterInput.toLowerCase();

    const aStarts = a.toLowerCase().startsWith(q);
    const bStarts = b.toLowerCase().startsWith(q);

    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;

    return a.localeCompare(b);
  })
  .slice(0, 8);

  // ✅ Debounce timer holder (so we cancel old requests)
  const sellerDebounceRef = React.useRef<NodeJS.Timeout | null>(null);

  const [showCatalogueList, setShowCatalogueList] = useState(false);
  const [catalogueSearch, setCatalogueSearch] = useState("");
  const [catalogueIndex, setCatalogueIndex] = useState(-1);
  const catalogueWrapperRef = React.useRef<HTMLDivElement | null>(null);

  // ✅ Close catalogue dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;

      if (
        catalogueWrapperRef.current &&
        !catalogueWrapperRef.current.contains(t)
      ) {
        setShowCatalogueList(false);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!showCatalogueList) {
      setCatalogueSearch("");
      setCatalogueIndex(-1);
    }
  }, [showCatalogueList]);

  // ✅ Filtered catalogue categories (search inside dropdown)
  const filteredCatalogueOptions =
    catalogueSearch.trim().length === 0
      ? catalogueOptions
      : catalogueOptions.filter((c) =>
          c.toLowerCase().includes(catalogueSearch.toLowerCase())
        );


  return (
    <div className="bg-white border rounded-xl shadow-sm px-4 py-4 mb-6
        grid grid-cols-1
        md:grid-cols-[30%_30%_30%_10%]
        gap-x-4 gap-y-4">
      
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
                const filtered = rankedMinistries;

                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMinistryIndex((i) => Math.min(i + 1, filtered.length - 1));
                }

                if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMinistryIndex((i) => Math.max(i - 1, 0));
                }

                if (e.key === "Enter" && ministryIndex >= 0) {
                    e.preventDefault();
                    const picked = filtered[ministryIndex];
                    if (picked) {
                    setMinistryFilterInput(picked);
                    setShowMinistryList(false);
                    setMinistryIndex(-1);
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
                {rankedMinistries.map((m, idx) => (
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

        {/* ✅ Clear Filters Button (Aligned to Inputs) */}
        <div className="flex items-end justify-start">
        <button
            onClick={clearFilters}
            className={`
            h-[35px] w-[52px]
            flex items-center justify-center
            rounded-xl
            border
            transition
            ${
                hasActiveFilters
                ? "bg-black border-black"
                : "bg-[#F6D36B] border-[#F1C94A]"
            }
            `}
        >
            <X
            className={`w-5 h-5 ${
                hasActiveFilters ? "text-white" : "text-black"
            }`}
            strokeWidth={3}
            />
        </button>
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
                const filtered = rankedDepartments;

                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setDepartmentIndex((i) => Math.min(i + 1, filtered.length - 1));
                }

                if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setDepartmentIndex((i) => Math.max(i - 1, 0));
                }

                if (e.key === "Enter" && departmentIndex >= 0) {
                    e.preventDefault();
                    const picked = filtered[departmentIndex];
                    if (picked) {
                    setDepartmentFilterInput(picked);
                    setShowDepartmentList(false);
                    setDepartmentIndex(-1);
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
                {rankedDepartments.map((d, idx) => (
                <div
                    key={d}
                    onMouseEnter={() => setDepartmentIndex(idx)}
                    onClick={() => {
                    setDepartmentFilterInput(d);
                    setShowDepartmentList(false);
                    setDepartmentIndex(-1);
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
            const val = e.target.value;
            setSellerFilterInput(val);
            setSellerIndex(-1);

            // ✅ Only start after 2 characters
            if (val.trim().length < 2) {
                setSellerLiveOptions([]);
                setShowSellerList(false);
                return;
            }

            setSellerLoading(true);
            setShowSellerList(true);

            // ✅ Cancel previous scheduled request
            if (sellerDebounceRef.current) {
            clearTimeout(sellerDebounceRef.current);
            }

            // ✅ Schedule a new request
            sellerDebounceRef.current = setTimeout(async () => {
            const opts = await gemResultsClientStore.suggest("seller", val);
            setSellerLiveOptions(opts);
            setSellerLoading(false);
            }, 250);
            }}


            onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                e.preventDefault();
                setSellerIndex((i) =>
                    Math.min(i + 1, sellerLiveOptions.length - 1)
                );
                }

                if (e.key === "ArrowUp") {
                e.preventDefault();
                setSellerIndex((i) => Math.max(i - 1, 0));
                }

                if (e.key === "Enter" && sellerIndex >= 0) {
                e.preventDefault();
                const picked = sellerLiveOptions[sellerIndex];
                if (picked) {
                    setSellerFilterInput(picked);
                    setShowSellerList(false);
                    setSellerIndex(-1);
                }
                }
            }}
            placeholder="Search Seller Name..."
            className="w-full border rounded-lg px-3 py-2 text-sm pr-8"
            />

            {/* Clear button */}
            {sellerFilterInput && (
            <button
                type="button"
                onClick={() => {
                // ✅ Cancel pending API debounce
                if (sellerDebounceRef.current) {
                    clearTimeout(sellerDebounceRef.current);
                    sellerDebounceRef.current = null;
                }

                // ✅ Reset everything
                setSellerFilterInput("");
                setSellerLiveOptions([]);
                setSellerLoading(false);
                setShowSellerList(false);
                setSellerIndex(-1);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
            >
                ✕
            </button>
            )}

        </div>

        {/* ✅ Dropdown */}
        {showSellerList && sellerFilterInput.trim().length >= 2 && (
            <div
            ref={sellerRef}
            className="absolute left-0 right-0 bg-white border mt-1 rounded shadow max-h-40 overflow-auto z-10"
            >
            {/* Loading */}
            {sellerLoading && (
                <div className="px-3 py-2 text-xs text-gray-400">
                Loading...
                </div>
            )}

            {/* No matches */}
            {!sellerLoading && sellerLiveOptions.length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-400">
                No matches found
                </div>
            )}

            {/* Suggestions */}
            {sellerLiveOptions.map((s, idx) => (
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

                {/* ✅ CATALOGUE FILTER (Category Multi-Select) */}
        <div ref={catalogueWrapperRef} className="relative">
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
            Catalogue
          </label>

          <input
            readOnly
            value={
              catalogueCategories.length === 0
                ? ""
                : catalogueCategories.length === catalogueOptions.length
                ? "All Items Selected"
                : catalogueCategories.length === 1
                ? catalogueCategories[0]
                : "Multiple Items Selected"
            }
            placeholder="Select My Items"
            onClick={() => {
              setShowCatalogueList((v) => !v);
              setCatalogueIndex(-1);
            }}
            onKeyDown={(e) => {
                if (!showCatalogueList && e.key === "ArrowDown") {
                setShowCatalogueList(true);
                setCatalogueIndex(-1);
                return;
                }

                if (e.key === "Escape") {
                setShowCatalogueList(false);
                }

                if (e.key === "ArrowDown") {
                e.preventDefault();
                setCatalogueIndex((i) =>
                    Math.min(i + 1, filteredCatalogueOptions.length - 1)
                );
                }

                if (e.key === "ArrowUp") {
                e.preventDefault();
                setCatalogueIndex((i) => Math.max(i - 1, -1));
                }

                if (e.key === "Enter") {
                e.preventDefault();

                // ✅ Case 1: Select All row
                if (catalogueIndex === -1) {
                    if (catalogueCategories.length === catalogueOptions.length) {
                    setCatalogueCategories([]);
                    } else {
                    setCatalogueCategories([...catalogueOptions]);
                    }
                    return;
                }

                // ✅ Case 2: Category rows
                if (catalogueIndex >= 0) {
                    const picked = filteredCatalogueOptions[catalogueIndex];
                    if (!picked) return;

                    if (catalogueCategories.includes(picked)) {
                    setCatalogueCategories(
                        catalogueCategories.filter((c) => c !== picked)
                    );
                    } else {
                    setCatalogueCategories([...catalogueCategories, picked]);
                    }
                }
                }
            }}

            className={`
              w-full border rounded-lg px-3 py-2 text-sm pr-8
              cursor-pointer
              transition
              ${
                hasCatalogueActive
                  ? "bg-yellow-50 border-yellow-300"
                  : "bg-white border-gray-300"
              }
            `}
          />

          {/* Dropdown caret */}
          <span className="absolute right-3 top-[34px] text-gray-400 pointer-events-none">
            ▾
          </span>

            {showCatalogueList && (
            <div
                className="absolute left-0 right-0 bg-white border mt-1 rounded shadow max-h-60 overflow-auto z-20"
            >
            {/* ✅ Search box (only when >10 categories) */}
            {catalogueOptions.length > 10 && (
            <div className="p-2 border-b">
                <input
                value={catalogueSearch}
                onChange={(e) => setCatalogueSearch(e.target.value)}
                placeholder="Search catalogue..."
                className="w-full border rounded-md px-2 py-1 text-sm"
                />
            </div>
            )}

            {/* Select All */}
            {catalogueOptions.length > 0 && (
              <div
                className={`px-3 py-2 border-b ${
                    catalogueIndex === -1 ? "bg-yellow-100" : ""
                }`}
              >

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={
                      catalogueCategories.length === catalogueOptions.length
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setCatalogueCategories([...catalogueOptions]);
                      } else {
                        setCatalogueCategories([]);
                      }
                    }}
                  />
                  Select All
                </label>
              </div>
            )}

            {/* Categories */}
            {filteredCatalogueOptions.map((cat, idx) => (
              <label
                key={cat}
                className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer
                ${idx === catalogueIndex ? "bg-yellow-100" : "hover:bg-gray-50"}
                `}
              >
                <input
                  type="checkbox"
                  checked={catalogueCategories.includes(cat)}
                  onChange={() => {
                    if (catalogueCategories.includes(cat)) {
                      setCatalogueCategories(
                        catalogueCategories.filter((c) => c !== cat)
                      );
                    } else {
                      setCatalogueCategories([...catalogueCategories, cat]);
                    }
                  }}
                />
                {cat}
              </label>
            ))}
          </div>
          )}
        </div>
        

        {/* GLOBAL SEARCH (HIDDEN FOR NOW) */}
        {false && (
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
         )}
         
        {/* ✅ Result Count (Bottom Right Cell) */}
        {hasActiveFilters && totalResults !== undefined && (
        <div className="mt-6 flex items-center justify-left font-small text-gray-700">
            <span className="leading-tight text-right">
            <div>{totalResults.toLocaleString()}</div>
            <div className="text-xs text-gray-500">results</div>
            </span>
        </div>
        )}
    </div>
  );
}