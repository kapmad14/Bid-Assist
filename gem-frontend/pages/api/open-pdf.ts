// gem-frontend/pages/api/open-pdf.ts

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

    // Use direct fetch (works better in pages router on Vercel)
    const response = await fetch(gemUrl, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/pdf",
      },
    });

    if (!response.ok) {
      console.error("GeM fetch failed:", response.status);
      return res.status(502).json({
        error: "Failed to fetch from GeM",
        status: response.status,
      });
    }

    const pdfBuffer = await response.arrayBuffer();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "inline; filename=gem_document.pdf"
    );
    res.setHeader("Cache-Control", "no-store");

    return res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "fetch failed" });
  }
}
