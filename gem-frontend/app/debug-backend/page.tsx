"use client";

import { useEffect, useState } from "react";

// Read the env at build time
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

export default function DebugBackendPage() {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log("DebugBackendPage apiBaseUrl =", apiBaseUrl);

    if (!apiBaseUrl) {
      setError(
        "API base URL missing. Value of process.env.NEXT_PUBLIC_API_BASE_URL is: " +
          String(apiBaseUrl)
      );
      setLoading(false);
      return;
    }

    // Make sure we are calling a valid absolute URL
    const url = `${apiBaseUrl.replace(/\/+$/, "")}/health`;
    console.log("Fetching:", url);

    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Status ${res.status}`);
        }
        const data = await res.json();
        setResult(data);
        setError(null);
      })
      .catch((err: any) => {
        console.error("Fetch error in debug-backend:", err);
        setError(err?.message || "Unknown error");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Backend Debug</h1>

      <h2>API base URL seen in this page</h2>
      <pre>{JSON.stringify({ apiBaseUrl }, null, 2)}</pre>

      {loading && <p>Loading...</p>}

      {!loading && (
        <>
          <h2>Result</h2>
          <pre>{JSON.stringify(result, null, 2)}</pre>

          <h2>Error</h2>
          <pre>{error}</pre>
        </>
      )}
    </main>
  );
}
