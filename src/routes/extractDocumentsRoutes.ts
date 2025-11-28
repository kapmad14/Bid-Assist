import { Router } from "express";
import { spawn } from "child_process";

const router = Router();

router.post("/", async (req, res) => {
  const { tenderId } = req.body || {};

  if (!tenderId) {
    return res.status(400).json({
      success: false,
      error: "Missing tenderId",
      logs: ["No tenderId provided in request body"],
    });
  }

  // 👇 Adjust this if your script lives somewhere else in the repo
  const scriptPath = "extract_document_urls.py";

  // Call: python extract_document_urls.py --tender-id <id>
  const child = spawn("python", [scriptPath, "--tender-id", String(tenderId)], {
    // Optional: set cwd if needed
    // cwd: "/app",
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.on("close", (code) => {
  // If the script failed, try to read JSON from stdout first
  if (code !== 0) {
    console.error("extract_document_urls.py failed:", code, stderr, stdout);

    // Many of our "handled" errors print JSON to stdout even with non-zero exit
    try {
      const parsed = JSON.parse(stdout);
      // Forward Python's own error object so the frontend can see it
      return res.status(500).json(parsed);
    } catch {
      // Fallback: generic error + stderr/stdout logs
      return res.status(500).json({
        success: false,
        error: "Extractor failed",
        logs: []
          .concat(stderr ? stderr.split("\n").filter(Boolean) : [])
          .concat(stdout ? ["stdout:", stdout] : [])
          .concat([`Exit code: ${code}`]),
      });
    }
  }

  // Normal success path
  try {
    const parsed = JSON.parse(stdout);
    return res.json(parsed);
  } catch (e: any) {
    console.error("Invalid JSON from extractor:", e, stdout);
    return res.status(500).json({
      success: false,
      error: "Invalid JSON from extractor",
      logs: ["Raw output:", stdout],
    });
  }
});


export default router;
