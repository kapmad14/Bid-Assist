import { GemResult } from "@/types";

type GetResultsArgs = {
  page: number;
  limit: number;
  global?: string;
  catalogue?: string[];
  bidRa?: string;
  item?: string;
  ministry?: string;
  department?: string;
  seller?: string;
};

export const gemResultsClientStore = {

  async getResults(args: GetResultsArgs): Promise<{
    data: GemResult[];
    total: number;
    isCapped: boolean;
  }> {
    const params = new URLSearchParams({
      page: String(args.page),
      limit: String(args.limit),
    });

    if (args.bidRa) params.append("bidRa", args.bidRa);
    if (args.item) params.append("item", args.item);
    if (args.ministry) params.append("ministry", args.ministry);
    if (args.department) params.append("department", args.department);
    if (args.seller) params.append("seller", args.seller);
    if (args.global) params.append("global", args.global);
    // ✅ Catalogue categories (multi)
    if (args.catalogue) {
      args.catalogue.forEach((c) => params.append("catalogue", c));
    }


    const res = await fetch(`/api/gem-results?${params.toString()}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Failed to fetch results");
    }

    return res.json();
  },

    // ✅ LIVE AUTOSUGGEST (scales to millions of rows)
  async suggest(
    type: "ministry" | "department" | "seller",
    q: string
  ): Promise<string[]> {
    // ✅ Start only after 2 characters
    if (!q || q.trim().length < 2) return [];

    const res = await fetch(
      `/api/gem-results/suggest?type=${type}&q=${encodeURIComponent(q)}`,
      {
        cache: "no-store",
      }
    );

    if (!res.ok) return [];

    const json = await res.json();
    return json.options ?? [];
  },

  async getAutosuggest(): Promise<{
    ministries: string[];
    departments: string[];
  }> {
    const res = await fetch("/api/gem-results/autosuggest", {
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Failed to fetch autosuggest");
    }

    return res.json();
  },
};
