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

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.on("close", (code) => {
    if (code !== 0) {
      console.error("extract_document_urls.py failed:", code, stderr);
      return res.status(500).json({
        success: false,
        error: "Extractor failed",
        logs: stderr
          .split("\n")
          .filter(Boolean)
          .concat([`Exit code: ${code}`]),
      });
    }

    try {
      const parsed = JSON.parse(stdout);

      // We expect the Python script to return:
      // { success: true, documents: [...], logs: [...] }
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
});

export default router;
