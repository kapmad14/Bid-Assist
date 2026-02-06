import express from "express";
import fetch from "node-fetch";

const app = express();

app.get("/open-pdf", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing url" });

  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
        "Referer": "https://bidplus.gem.gov.in/",
      },
    });

    if (!r.ok) {
      return res.status(500).json({ error: "Upstream failed", status: r.status });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=gem.pdf");

    r.body.pipe(res);
  } catch (e) {
    res.status(500).json({ error: "fetch failed", detail: String(e) });
  }
});

app.listen(4000, () => console.log("PDF proxy running on 4000"));
