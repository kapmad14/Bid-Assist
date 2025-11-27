// src/services/jobQueue.ts
import type { ExtractionJobPayload } from "../types/extractionJob";

export interface JobQueue {
  enqueueExtractionJob(payload: ExtractionJobPayload): Promise<void>;
}

class NoopJobQueue implements JobQueue {
  async enqueueExtractionJob(payload: ExtractionJobPayload): Promise<void> {
    // For now, just log it.
    // Later we replace this with SQS or another real queue.
    console.log("[JobQueue] enqueueExtractionJob called", payload);
  }
}

// Export a default instance for now
export const jobQueue: JobQueue = new NoopJobQueue();
