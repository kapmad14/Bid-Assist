import type { NextApiRequest, NextApiResponse } from "next";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/114.0 Safari/537.36";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": CHROME_UA,
        "Accept": "application/pdf, */*",
        "Accept-Language": "en-IN,en;q=0.9",
        "Connection": "keep-alive",
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      return res
        .status(502)
        .json({ error: "Upstream fetch failed", status: upstream.status });
    }

    const buffer = await upstream.arrayBuffer();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="gem.pdf"');
    res.setHeader("Cache-Control", "no-store");

    res.send(Buffer.from(buffer));
  } catch (err: any) {
    console.error("open-pdf error:", err);
    res.status(500).json({
      error: "fetch failed",
      detail: err?.message ?? String(err),
    });
  }
}
