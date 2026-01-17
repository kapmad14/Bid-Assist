import { GemResult } from "@/types";

type GetResultsArgs = {
  page: number;
  limit: number;
  item?: string;
  ministry?: string;
  department?: string;
  seller?: string;
};

export const gemResultsClientStore = {

  async getResults(args: GetResultsArgs): Promise<{
    data: GemResult[];
    total: number;
  }> {
    const params = new URLSearchParams({
      page: String(args.page),
      limit: String(args.limit),
    });

    if (args.item) params.append("item", args.item);
    if (args.ministry) params.append("ministry", args.ministry);
    if (args.department) params.append("department", args.department);
    if (args.seller) params.append("seller", args.seller);

    const res = await fetch(`/api/gem-results?${params.toString()}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Failed to fetch results");
    }

    return res.json();
  },
  async getAutosuggest(): Promise<{
    ministries: string[];
    departments: string[];
    sellers: string[];
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
