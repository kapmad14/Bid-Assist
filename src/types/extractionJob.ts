// src/types/extractionJob.ts
export type ExtractionJobStatus = "pending" | "processing" | "success" | "failed";

export interface ExtractionJobPayload {
  jobId: string;
  s3Key: string;
  tenderId: string;
  userId: string;
}

export interface ExtractionJob extends ExtractionJobPayload {
  status: ExtractionJobStatus;
  errorMessage?: string | null;
}
