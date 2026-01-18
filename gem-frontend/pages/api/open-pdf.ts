import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const target = req.query.url as string | undefined;

  if (!target) {
    return res.status(400).json({ error: "Missing ?url=" });
  }

  try {
    const r = await fetch(target, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
        "Accept": "application/pdf,*/*",
      },
    });

    if (!r.ok) {
      return res
        .status(500)
        .json({ error: "Upstream failed", status: r.status });
    }

    const buffer = Buffer.from(await r.arrayBuffer());

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=gem.pdf");
    res.setHeader("Cache-Control", "no-store");

    return res.send(buffer);
  } catch (err: any) {
    return res.status(500).json({
      error: "fetch failed",
      detail: String(err),
    });
  }
}
