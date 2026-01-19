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
  const [selectedBid, setSelectedBid] = useState<GemRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  
  const asGoogleViewer = (url: string) =>
    `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`;

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
      console.log("Loaded JSON:", json);   // <-- IMPORTANT
      setData(Array.isArray(json) ? json.slice(0, 25) : []);
      setLoading(false);
    })
    .catch((err) => {
      console.error("JSON load failed:", err);
      setError(err.message);
      setLoading(false);
    });
}, []);


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


  return (
    <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
      <h1>GeM Inline PDF Test Page</h1>

      <div style={{ display: "grid", gridTemplateColumns: "350px 1fr", gap: "24px" }}>
        {/* LEFT LIST */}
        <div style={{ borderRight: "1px solid #ddd", paddingRight: "16px", maxHeight: "90vh", overflowY: "auto" }}>
          {data.map((row) => (
            <div
              key={row.bid_number}
              onClick={() => setSelectedBid(row)}
              style={{
                padding: "10px",
                borderBottom: "1px solid #eee",
                cursor: "pointer",
                background: selectedBid?.bid_number === row.bid_number ? "#f0f4ff" : "white",
              }}
            >
              <div><strong>{row.bid_number}</strong></div>
              <div style={{ fontSize: "12px", color: "#555", marginTop: "4px" }}>
                {row.item}
              </div>
            </div>
          ))}
        </div>

        {/* RIGHT PREVIEW */}
        <div>
          {!selectedBid && <h3>Select a bid to preview</h3>}

          {selectedBid && (
            <div>
              <h3>{selectedBid.bid_number}</h3>

              <div style={{ marginBottom: "16px" }}>
                <strong>Bid Detail PDF</strong>
                <iframe
                  src={asGoogleViewer(selectedBid.bid_detail_url!)}
                  width="100%"
                  height="600"
                  style={{ border: "1px solid #ddd", borderRadius: "8px" }}
                />
              </div>

              {selectedBid.has_reverse_auction && selectedBid.ra_hover_url && (
                <div>
                  <strong>RA Hover Page</strong>
                  <iframe
                    src={selectedBid.ra_hover_url}
                    width="100%"
                    height="600"
                    style={{ border: "1px solid #ddd", borderRadius: "8px" }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
