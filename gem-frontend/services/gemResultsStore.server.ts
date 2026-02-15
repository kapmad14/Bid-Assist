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
  catalogue?: string[];
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
  catalogue,
}: GetResultsArgs): Promise<{
  data: GemResult[];
  total: number;
  isCapped: boolean;
}> {
  const supabase = await createServerSupabaseClient();

    // ✅ FAST HOMEPAGE MODE (NO FILTERS)
  const isUnfiltered =
    !bidRa &&
    !item &&
    !ministry &&
    !department &&
    !seller &&
    !global &&
    (!catalogue || catalogue.length === 0);


  // ✅ Homepage cap: latest 200 rows (10 pages)
  const CAP_LIMIT = 200;

  // If homepage → force page 1 + limit 200
  const effectiveLimit = limit; // always page size (20)
  const effectivePage = page;   // allow pagination normally


  const applyFilters = (q: any) => {
    if (item && item.trim().length >= 3) {
      q = q.ilike("l1_item", `%${item}%`);
    }
    // ✅ Catalogue Category Filter (OR match against l1_item)
    if (catalogue && catalogue.length > 0) {
      const orClause = catalogue
        .map((cat) => `l1_item.ilike.%${cat}%`)
        .join(",");

      q = q.or(orClause);
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


    // ✅ Bid/RA filter only after 7 characters
    if (bidRa && bidRa.trim().length >= 7) {
      q = q.or(
        `bid_number.ilike.%${bidRa}%,ra_number.ilike.%${bidRa}%`
      );
    }

    // ✅ Ministry filter only after 3 characters
    if (ministry && ministry.trim().length >= 3) {
      q = q.ilike("ministry", `%${ministry}%`);
    }

    // ✅ Department filter only after 3 characters
    if (department && department.trim().length >= 3) {
      q = q.ilike("department", `%${department}%`);
    }

    // ✅ Seller filter only after 3 characters
    if (seller && seller.trim().length >= 3) {
      q = q.or(
        `l1_seller.ilike.%${seller}%,l2_seller.ilike.%${seller}%,l3_seller.ilike.%${seller}%`
      );
    }

    return q;
  };

  const from = (effectivePage - 1) * effectiveLimit;
  const to = from + effectiveLimit - 1;


    // ✅ TOTAL COUNT
  let total = 0;

  if (isUnfiltered) {
    // ✅ Homepage mode: skip expensive COUNT(*)
    total = CAP_LIMIT;
  } else {
    // ✅ Filtered mode: exact count
    let countQuery = supabase
      .from("gem_results")
      .select("id", { count: "estimated" }) // ✅ faster + safer
      .eq("extraction_status", "success");


    countQuery = applyFilters(countQuery);

    const { count, error: countErr } = await countQuery;

    if (countErr) {
      throw new Error(`Count failed: ${countErr.message}`);
    }

    total = count ?? 0;
  }

  // Fetch paginated data  ✅ (FIXED ORDER)
  let dataQuery = supabase
    .from("gem_results_with_archive")
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
    total,
    isCapped: isUnfiltered,
  };
}