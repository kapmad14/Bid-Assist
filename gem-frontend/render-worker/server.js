import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/pdf", async (req, res) => {
  const bidUrl = req.query.url;

  if (!bidUrl) {
    return res.status(400).json({ error: "Missing ?url=" });
  }

  console.log("Fetching PDF from:", bidUrl);

  try {
    const r = await fetch(bidUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/114.0 Safari/537.36",
      }
    });

    if (!r.ok) {
      throw new Error(`GeM returned ${r.status}`);
    }

    const pdfBuffer = await r.arrayBuffer();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=gem.pdf",
      "Cache-Control": "no-store",
    });

    return res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      error: "fetch failed",
      detail: err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Render PDF worker running on port ${PORT}`);
});
