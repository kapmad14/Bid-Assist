"use client";

import { useState } from "react";

export function AnalyticsFilters({
  ministry,
  setMinistry,
  department,
  setDepartment,
  seller,
  setSeller,
  bidRa,
  setBidRa,

  ministryOptions,
  departmentOptions,
  sellerOptions,
}: {
  ministry: string;
  setMinistry: (v: string) => void;
  department: string;
  setDepartment: (v: string) => void;
  seller: string;
  setSeller: (v: string) => void;
  bidRa: string;
  setBidRa: (v: string) => void;

  ministryOptions: string[];
  departmentOptions: string[];
  sellerOptions: string[];
}) {
  /* ---------------- LOCAL UI STATE ---------------- */
  const [showMinistryList, setShowMinistryList] = useState(false);

  /* ---------------- DEBUG (safe to remove later) ---------------- */
  console.log("🔥 AnalyticsFilters rendered");
  console.log("Ministry options:", ministryOptions);

  return (
    <div className="bg-black rounded-xl p-4 border border-gray-800 space-y-4">
      <div className="text-white font-semibold">Filters</div>

      {/* ---------------- BID / RA ---------------- */}
      <input
        value={bidRa}
        onChange={(e) => setBidRa(e.target.value)}
        placeholder="Search Bid or RA..."
        className="w-full bg-gray-900 border border-gray-800 text-white px-3 py-2 rounded-lg text-sm"
      />

      {/* ---------------- MINISTRY AUTOSUGGEST ---------------- */}
      <div className="relative">
        <input
          value={ministry}
          onChange={(e) => {
            setMinistry(e.target.value);
            setShowMinistryList(true);
          }}
          onFocus={() => setShowMinistryList(true)}
          placeholder="Type ministry..."
          className="w-full bg-gray-900 border border-gray-800 text-white px-3 py-2 rounded-lg text-sm"
        />

        {showMinistryList && ministry && ministryOptions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full bg-black border border-gray-700 rounded-lg max-h-40 overflow-auto">
            {ministryOptions
              .filter((m) =>
                m.toLowerCase().includes(ministry.toLowerCase())
              )
              .slice(0, 8)
              .map((m) => (
                <div
                  key={m}
                  onClick={() => {
                    setMinistry(m);
                    setShowMinistryList(false);
                  }}
                  className="px-3 py-2 text-sm text-white cursor-pointer hover:bg-gray-700"
                >
                  {m}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* ---------------- DEPARTMENT (PLAIN INPUT FOR NOW) ---------------- */}
      <input
        value={department}
        onChange={(e) => setDepartment(e.target.value)}
        placeholder="Type department..."
        className="w-full bg-gray-900 border border-gray-800 text-white px-3 py-2 rounded-lg text-sm"
      />

      {/* ---------------- SELLER (PLAIN INPUT FOR NOW) ---------------- */}
      <input
        value={seller}
        onChange={(e) => setSeller(e.target.value)}
        placeholder="Search seller..."
        className="w-full bg-gray-900 border border-gray-800 text-white px-3 py-2 rounded-lg text-sm"
      />
    </div>
  );
}
