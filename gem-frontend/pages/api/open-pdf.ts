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

    // 🚨 KEY CHANGE: use relay instead of direct fetch from Vercel
    const relayUrl =
      "https://api.allorigins.win/raw?url=" +
      encodeURIComponent(gemUrl);

    const response = await fetch(relayUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!response.ok) {
      console.error("Relay fetch failed:", response.status);
      return res.status(502).json({
        error: "Failed via relay",
        status: response.status,
      });
    }

    const pdfBuffer = await response.arrayBuffer();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=gem.pdf");
    res.setHeader("Cache-Control", "no-store");

    return res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "fetch failed" });
  }
}
