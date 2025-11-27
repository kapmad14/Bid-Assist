// src/index.ts
import express from "express";
import extractionRoutes from "./routes/extractionRoutes";

const app = express();

app.use(express.json());

// Simple health endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Extraction routes
app.use("/api/extractions", extractionRoutes);

// ✅ IMPORTANT: use Render's PORT env var, default 10000
const PORT = parseInt(process.env.PORT || "10000", 10);

// Bind to 0.0.0.0 so Render can reach it
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on port ${PORT}`);
});
