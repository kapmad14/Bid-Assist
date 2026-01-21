// src/index.ts
import express from "express";
import cors from "cors";
import extractionRoutes from "./routes/extractionRoutes";
import extractDocumentsRoutes from "./routes/extractDocumentsRoutes";
import { requireAuth } from "./middleware/auth";

import jwt from "jsonwebtoken";

const app = express();

app.post("/auth/login", (req, res) => {
  // TEMPORARY: hardcoded user (for testing only)
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



// 🔓 Allow cross-origin requests from your frontend
// For now, allow all origins to unblock; we can tighten later.
app.use(
  cors({
    origin: [
      "https://tenderbot.app",
      "https://www.tenderbot.app",
    ],
  })
);


app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/extractions", requireAuth, extractionRoutes);
app.use("/api/extract-documents", extractDocumentsRoutes); // instant extraction (now)

const PORT = parseInt(process.env.PORT || "10000", 10);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on port ${PORT}`);
});
