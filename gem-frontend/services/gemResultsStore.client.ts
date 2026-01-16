import { GemResult } from "@/types";

type GetResultsArgs = {
  page: number;
  limit: number;
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

    const res = await fetch(`/api/gem-results?${params.toString()}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Failed to fetch results");
    }

    return res.json();
  },
};
