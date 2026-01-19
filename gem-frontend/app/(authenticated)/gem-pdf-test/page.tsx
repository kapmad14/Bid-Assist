"use client";

import { useEffect, useState } from "react";

type GemRecord = {
  bid_number: string;
  bid_detail_url: string | null;
  ra_hover_url: string | null;
  has_reverse_auction: boolean;
  ra_number: string | null;
  item: string;
};

export default function GemPdfTestPage() {
  const [data, setData] = useState<GemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- PREVIEW STATE (same pattern as Results page) ---
  const [previewForId, setPreviewForId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const openPreview = (bidNumber: string, gemUrl?: string | null) => {
    if (!gemUrl) return;

    if (previewForId === bidNumber) {
      setPreviewForId(null);
      setPreviewUrl(null);
      return;
    }

    setPreviewForId(bidNumber);
    setPreviewUrl(`/api/open-pdf?url=${encodeURIComponent(gemUrl)}`);
  };

  const closePreview = () => {
    setPreviewForId(null);
    setPreviewUrl(null);
  };

  // --- LOAD CONSTANT JSON FROM public/ ---
  useEffect(() => {
    const url = `${window.location.origin}/gem_results_pilot_first25.json`;

    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((json) => {
        console.log("Loaded JSON:", json);
        setData(Array.isArray(json) ? json.slice(0, 25) : []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("JSON load failed:", err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // --- STATES ---
  if (loading) {
    return <div style={{ padding: 24 }}>Loading test data...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: "red" }}>
        <h3>Failed to load JSON</h3>
        <p>{error}</p>
        <p>Make sure: public/gem_results_pilot_first25.json exists</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <h3>No data found in JSON</h3>
      </div>
    );
  }

  // --- UI ---
  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 className="text-xl font-bold mb-4">GeM PDF Preview Test</h1>

      <div className="space-y-4">
        {data.map((row) => (
          <div key={row.bid_number}>
            {/* CARD */}
            <div
              className="bg-white border rounded-xl p-3 shadow-sm hover:shadow-md transition cursor-pointer"
              onClick={() => openPreview(row.bid_number, row.bid_detail_url)}
            >
              <div className="font-semibold text-blue-700">
                {row.bid_number}
              </div>
              <div className="text-sm text-gray-600 mt-1 line-clamp-1">
                {row.item}
              </div>
              {row.has_reverse_auction && row.ra_number && (
                <div className="text-xs text-gray-500 mt-1">
                  RA: {row.ra_number}
                </div>
              )}
            </div>

            {/* INLINE PREVIEW (same idea as Results page) */}
            {previewForId === row.bid_number && previewUrl && (
              <div className="bg-white border rounded-xl shadow-sm p-3 mt-2">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-sm font-semibold">
                    Document Preview for {row.bid_number}
                  </h3>
                  <button
                    onClick={closePreview}
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
          </div>
        ))}
      </div>
    </div>
  );
}
