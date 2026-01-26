"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";

export default function PostCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    async function finish() {
      const { data } = await supabase.auth.getSession();

      if (data.session) {
        router.refresh();
        router.replace("/dashboard");
      } else {
        router.replace("/login");
      }
    }

    finish();
  }, [router]);

  return (
    <div className="h-screen flex items-center justify-center">
      <p className="text-lg font-semibold">Logging you in…</p>
    </div>
  );
}
