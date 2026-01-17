"use server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { GemResult } from "@/types";

type GetResultsArgs = {
  page: number;
  limit: number;
  bidRa?: string;
  item?: string;
  ministry?: string;
  department?: string;
  seller?: string;
  global?: string;
};


export async function getGemResultsServer({
  page,
  limit,
  bidRa,
  item,
  ministry,
  department,
  seller,
  global,
}: GetResultsArgs): Promise<{
  data: GemResult[];
  total: number;
}> {
  const supabase = await createServerSupabaseClient();

  const applyFilters = (q: any) => {
    if (item) {
      q = q.ilike("l1_item", `%${item}%`);
    }

    if (global) {
      const g = `%${global}%`;

      q = q.or(
        [
          `bid_number.ilike.${g}`,
          `ra_number.ilike.${g}`,
          `l1_item.ilike.${g}`,
          `ministry.ilike.${g}`,
          `department.ilike.${g}`,
          `l1_seller.ilike.${g}`,
          `l2_seller.ilike.${g}`,
          `l3_seller.ilike.${g}`,
        ].join(",")
      );
    }


    if (bidRa) {
      q = q.or(
        `bid_number.ilike.%${bidRa}%,ra_number.ilike.%${bidRa}%`
      );
    }


    if (ministry) {
      q = q.ilike("ministry", `%${ministry}%`);
    }

    if (department) {
      q = q.ilike("department", `%${department}%`);
    }

    if (seller) {
      q = q.or(
        `l1_seller.ilike.%${seller}%,l2_seller.ilike.%${seller}%,l3_seller.ilike.%${seller}%`
      );
    }

    return q;
  };

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // Get total count of SUCCESS rows
  let countQuery = supabase
    .from("gem_results")
    .select("*", { count: "exact", head: true })
    .eq("extraction_status", "success");

  countQuery = applyFilters(countQuery);

  const { count, error: countErr } = await countQuery;


  if (countErr) {
    throw new Error(`Count failed: ${countErr.message}`);
  }

// Fetch paginated data  ✅ (FIXED ORDER)
let dataQuery = supabase
  .from("gem_results")
  .select("*")
  .eq("extraction_status", "success");

// 👉 APPLY FILTERS FIRST
dataQuery = applyFilters(dataQuery);

// 👉 THEN order + range
const { data, error } = await dataQuery
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
