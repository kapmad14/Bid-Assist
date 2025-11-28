// src/routes/extractDocumentsRoutes.ts
import { Router, Request, Response } from "express";
import { spawn } from "child_process";

const router = Router();

/**
 * POST /api/extract-documents
 * Body: { tenderId: number }
 *
 * Calls the Python extractor script and returns its JSON output.
 * No DB writes are performed here; everything is ephemeral.
 */
router.post("/", async (req: Request, res: Response) => {
  const { tenderId } = req.body || {};

  if (!tenderId) {
    return res.status(400).json({
      success: false,
      error: "Missing tenderId",
      logs: ["No tenderId provided in request body"],
    });
  }

  const scriptPath = "extract_document_urls.py";

  // Use python3 in Alpine; this binary definitely exists
  const child = spawn("python3", [scriptPath, "--tender-id", String(tenderId)], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on("error", (err) => {
    console.error("Failed to start extractor process:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to start extractor process",
      logs: [String(err)],
    });
  });

  child.on("close", (code) => {
    // Non-zero exit: try to forward Python's own JSON error if present
    if (code !== 0) {
      console.error("extract_document_urls.py failed:", code, stderr, stdout);

      // 1) Try to parse stdout as JSON and forward it directly
      try {
        const parsed = JSON.parse(stdout);
        return res.status(500).json(parsed);
      } catch {
        // 2) Fallback: build a simple logs array manually
        const logs: string[] = [];

        if (stderr) {
          logs.push(...stderr.split("\n").filter(Boolean));
        }
        if (stdout) {
          logs.push("stdout:");
          logs.push(stdout);
        }
        logs.push(`Exit code: ${code}`);

        return res.status(500).json({
          success: false,
          error: "Extractor failed",
          logs,
        });
      }
    }

    // Normal success path
    try {
      const parsed = JSON.parse(stdout);
      return res.json(parsed);
    } catch (e) {
      console.error("Invalid JSON from extractor:", e, stdout);
      return res.status(500).json({
        success: false,
        error: "Invalid JSON from extractor",
        logs: ["Raw output:", stdout],
      });
    }
  });
});

export default router;
