// pages/api/open-pdf.ts

import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const gemUrl = req.query.url as string;

    if (!gemUrl) {
      return res.status(400).json({ error: "Missing url param" });
    }

    // FETCH DIRECTLY FROM GeM (this works on Vercel for many govt sites)
    const response = await fetch(gemUrl, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/pdf, */*",
      },
    });

    if (!response.ok) {
      console.error("GeM fetch failed:", response.status);
      return res.status(502).json({
        error: "GeM fetch failed",
        status: response.status,
      });
    }

    const pdfBuffer = await response.arrayBuffer();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=gem.pdf");
    res.setHeader("Cache-Control", "no-store");

    return res.send(Buffer.from(pdfBuffer));
  } catch (err: any) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "fetch failed" });
  }
}
