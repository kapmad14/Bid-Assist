"use client";

import data from "../../data/gem_results_pilot_first25.json";
import { useState } from "react";

type GemRecord = {
  bid_number: string;
  bid_detail_url: string | null;
  ra_hover_url: string | null;
  has_reverse_auction: boolean;
  ra_number: string | null;
  item: string;
};

export default function GemPdfTestPage() {
  const [selectedBid, setSelectedBid] = useState<GemRecord | null>(null);

  const asGoogleViewer = (url: string) =>
    `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`;

  return (
    <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
      <h1>GeM Inline PDF Test Page</h1>
      <p style={{ color: "#666" }}>
        Click any bid to test <b>bid_detail_url</b> and <b>ra_hover_url</b>.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "350px 1fr", gap: "24px" }}>
        {/* LEFT: list of bids */}
        <div style={{ borderRight: "1px solid #ddd", paddingRight: "16px", maxHeight: "90vh", overflowY: "auto" }}>
          {data.slice(0, 25).map((row: GemRecord) => (
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
              {row.has_reverse_auction && (
                <div style={{ fontSize: "11px", color: "#0066cc", marginTop: "4px" }}>
                  RA: {row.ra_number}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* RIGHT: viewers */}
        <div>
          {!selectedBid && <h3>Select a bid to preview</h3>}

          {selectedBid && (
            <div>
              <h3>{selectedBid.bid_number}</h3>

              <div style={{ marginBottom: "16px" }}>
                <strong>Bid Detail PDF (bid_detail_url)</strong>
                <iframe
                  src={asGoogleViewer(selectedBid.bid_detail_url!)}
                  width="100%"
                  height="500"
                  style={{ border: "1px solid #ddd", borderRadius: "8px" }}
                />
              </div>

              {selectedBid.has_reverse_auction && selectedBid.ra_hover_url && (
                <div>
                  <strong>RA Hover / Result Page (ra_hover_url)</strong>
                  <iframe
                    src={selectedBid.ra_hover_url}
                    width="100%"
                    height="500"
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
