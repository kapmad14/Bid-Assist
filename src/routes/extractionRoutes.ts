// src/routes/extractionRoutes.ts
import { Router } from "express";
import { extractorService } from "../services/extractorService";
import { AuthRequest } from "../middleware/auth";

const router = Router();

/**
 * POST /api/extractions
 * Create a new extraction job.
 *
 * Expected JSON body:
* {
 *   "s3Key": "bids/GEM_doc_123.pdf",
 *   "tenderId": "some-tender-id"
 * }
 *
 * userId is derived from JWT
*/
router.post("/", async (req, res) => {
  try {
    const { s3Key, tenderId } = req.body || {};
    const userId = (req as AuthRequest).user.userId;

    if (!s3Key || !tenderId) {
      return res.status(400).json({
        error: "Missing required fields: s3Key, tenderId",
      });
    }


    const job = await extractorService.createJob({ s3Key, tenderId, userId });

    return res.status(201).json(job);
  } catch (err: any) {
    console.error("Error creating extraction job:", err);
    return res.status(500).json({
      error: "Failed to create extraction job",
    });
  }
});

/**
 * GET /api/extractions/:jobId
 * Get status/details of an existing job.
 */
router.get("/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await extractorService.getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    return res.json(job);
  } catch (err: any) {
    console.error("Error fetching extraction job:", err);
    return res.status(500).json({
      error: "Failed to fetch extraction job",
    });
  }
});

export default router;
