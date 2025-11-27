// src/index.ts
import express from "express";
import extractionRoutes from "./routes/extractionRoutes";

const app = express();

// Allow JSON bodies
app.use(express.json());

// Health check (optional)
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Mount our extraction routes under /api/extractions
app.use("/api/extractions", extractionRoutes);

// Port: choose whatever you like (we used 4000 in Docker earlier)
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
