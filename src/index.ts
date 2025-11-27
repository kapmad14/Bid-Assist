// src/index.ts
import express from "express";
import cors from "cors";
import extractionRoutes from "./routes/extractionRoutes";
import extractDocumentsRoutes from "./routes/extractDocumentsRoutes";


const app = express();

// 🔓 Allow cross-origin requests from your frontend
// For now, allow all origins to unblock; we can tighten later.
app.use(
  cors({
    origin: "*",
  })
);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/extractions", extractionRoutes);
app.use("/api/extract-documents", extractDocumentsRoutes); // instant extraction (now)

const PORT = parseInt(process.env.PORT || "10000", 10);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on port ${PORT}`);
});
