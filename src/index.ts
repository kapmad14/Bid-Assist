// src/index.ts
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";

import extractionRoutes from "./routes/extractionRoutes";
import extractDocumentsRoutes from "./routes/extractDocumentsRoutes";
import { requireAuth } from "./middleware/auth";

const app = express();

/* ---------- CORS (MUST COME FIRST) ---------- */
app.use(
  cors({
    origin: [
      "https://tenderbot.app",
      "https://www.tenderbot.app",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Handle preflight requests
app.options("/*", cors());

/* ---------- Body parsing ---------- */
app.use(express.json());

/* ---------- Public routes ---------- */
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/* TEMP login – testing only */
app.post("/auth/login", (_req, res) => {
  const user = {
    userId: "test-user-1",
    email: "test@tenderbot.app",
    role: "user",
  };

  const token = jwt.sign(user, process.env.JWT_SECRET as string, {
    expiresIn: "1h",
  });

  res.json({ token });
});

/* ---------- Protected routes ---------- */
app.use("/api/extractions", requireAuth, extractionRoutes);
app.use("/api/extract-documents", extractDocumentsRoutes);

/* ---------- Server ---------- */
const PORT = parseInt(process.env.PORT || "10000", 10);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on port ${PORT}`);
});
