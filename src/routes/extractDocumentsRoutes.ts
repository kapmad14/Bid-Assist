// src/routes/extractDocumentsRoutes.ts
import { Router } from "express";

const router = Router();

// POST /api/extract-documents
router.post("/", async (req, res) => {
  const { tenderId } = req.body || {};

  if (!tenderId) {
    return res.status(400).json({
      success: false,
      error: "Missing tenderId",
      logs: ["No tenderId provided in request body"],
    });
  }

  // For now: return demo documents only (no Python, no DB writes)
  const documents = [
    {
      order: 0,
      filename: "Sample-Additional-Doc-1.pdf",
      url: "https://www.example.com/sample-doc-1.pdf",
      size: 123456,
    },
    {
      order: 1,
      filename: "Sample-Additional-Doc-2.xlsx",
      url: "https://www.example.com/sample-doc-2.xlsx",
      size: 98765,
    },
  ];

  const logs = [
    `Demo extraction for tender ${tenderId}`,
    `Returning ${documents.length} mock document(s) from backend only.`,
    "No data was written to Supabase. This is a stateless preview.",
  ];

  return res.json({
    success: true,
    documents,
    logs,
  });
});

export default router;
