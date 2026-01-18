import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).send("Missing url");
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept": "application/pdf",
        "Referer": "https://bidplus.gem.gov.in/",
      },
    });

    if (!upstream.ok) {
      return res
        .status(500)
        .send(`Upstream error: ${upstream.status}`);
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "inline; filename=gem_document.pdf"
    );
    res.setHeader("Cache-Control", "no-store");

    return res.send(buffer);
  } catch (err) {
    console.error("PDF proxy failed:", err);
    return res.status(500).send("Failed to fetch PDF");
  }
}
