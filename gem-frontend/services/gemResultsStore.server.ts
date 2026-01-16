"use server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { GemResult } from "@/types";

type GetResultsArgs = {
  page: number;
  limit: number;
};

export async function getGemResultsServer({
  page,
  limit,
}: GetResultsArgs): Promise<{
  data: GemResult[];
  total: number;
}> {
  const supabase = await createServerSupabaseClient();

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // Get total count of SUCCESS rows
  const { count, error: countErr } = await supabase
    .from("gem_results")
    .select("*", { count: "exact", head: true })
    .eq("extraction_status", "success");

  if (countErr) {
    throw new Error(`Count failed: ${countErr.message}`);
  }

  // Fetch paginated data
  const { data, error } = await supabase
    .from("gem_results")
    .select("*")
    .eq("extraction_status", "success")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    throw new Error(`Results fetch failed: ${error.message}`);
  }

  return {
    data: (data ?? []) as GemResult[],
    total: count ?? 0,
  };
}
