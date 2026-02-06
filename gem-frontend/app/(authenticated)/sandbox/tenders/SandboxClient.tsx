"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase-client";
import TendersExplorerSandbox from "@/app/(authenticated)/_components/tenders/TendersExplorer.sandbox";

export default function SandboxClient() {
  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();

      if (data?.user) setIsAuthed(true);

      setLoading(false);
    }

    checkAuth();
  }, []);

  if (loading) {
    return <p className="text-sm text-gray-500">Checking authentication…</p>;
  }

  if (!isAuthed) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
        <h2 className="text-lg font-bold">Login Required</h2>
        <p className="text-sm text-gray-600 mt-2">
          Sandbox tender explorer requires you to be signed in.
        </p>

        <Link
          href="/login"
          className="inline-block mt-4 px-4 py-2 rounded-lg bg-black text-white font-semibold"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return <TendersExplorerSandbox mode="all" />;
}
