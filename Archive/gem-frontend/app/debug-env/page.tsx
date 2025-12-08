// app/debug-env/page.tsx
export default function DebugEnvPage() {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL || null;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Debug Env</h1>
      <pre>{JSON.stringify({ NEXT_PUBLIC_API_BASE_URL: value }, null, 2)}</pre>
    </main>
  );
}
