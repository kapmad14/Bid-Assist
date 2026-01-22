// src/types/extractionJob.ts

/**
 * NOTE:
 * - "success" is a legacy status value that may still exist in workers / DB.
 * - Prefer using "completed" for any NEW code.
 * - Do NOT remove "success" until all writers are migrated.
 */
export type ExtractionJobStatus =
  | "pending"
  | "processing"
  | "success"    // legacy
  | "completed"  // preferred going forward
  | "failed";

export interface ExtractionJobPayload {
  jobId: string;
  s3Key: string;
  tenderId: string;
  userId: string;
}

export interface ExtractionJob extends ExtractionJobPayload {
  status: ExtractionJobStatus;

  // Legacy error field (kept for backward compatibility)
  errorMessage?: string | null;

  // Newer / optional fields (safe additions)
  result?: any | null;
  error?: string | null;
  updatedAt?: string;
}
