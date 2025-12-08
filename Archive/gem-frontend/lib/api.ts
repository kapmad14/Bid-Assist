// lib/api.ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

if (!API_BASE_URL) {
  // This runs at build time (server-side), helpful if env var is missing
  // eslint-disable-next-line no-console
  console.warn("NEXT_PUBLIC_API_BASE_URL is not set");
}

export async function pingBackend() {
  if (!API_BASE_URL) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");
  }

  const res = await fetch(`${API_BASE_URL}/health`, {
    // Ensure it works in the browser
    method: "GET",
  });

  if (!res.ok) {
    throw new Error(`Backend health check failed with status ${res.status}`);
  }

  return res.json(); // should be { status: "ok" }
}
