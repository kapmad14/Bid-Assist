"use client";

import { useEffect, useState } from "react";
import { pingBackend } from "@/lib/api";

export default function DebugBackendPage() {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    pingBackend()
      .then((data) => {
        setResult(data);
        setError(null);
      })
      .catch((err: any) => {
        setError(err?.message || "Unknown error");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Backend Debug</h1>

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
