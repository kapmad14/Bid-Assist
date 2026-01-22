// src/services/extractorService.ts
import { jobQueue } from "./jobQueue";
import type { ExtractionJob, ExtractionJobPayload } from "../types/extractionJob";
// plus your Supabase client import

export interface ExtractorService {
  createJob(input: {
    s3Key: string;
    tenderId: string;
    userId: string;
  }): Promise<ExtractionJob>;

  getJob(jobId: string): Promise<ExtractionJob | null>;
}

class DefaultExtractorService implements ExtractorService {
  async createJob({ s3Key, tenderId, userId }: {
    s3Key: string;
    tenderId: string;
    userId: string;
  }): Promise<ExtractionJob> {
    const jobId = crypto.randomUUID();

    // 1. Insert into Supabase (extraction_jobs table)
    // TODO: replace with your real Supabase client call
    // await supabase.from("extraction_jobs").insert({
    //   id: jobId,
    //   s3_key: s3Key,
    //   tender_id: tenderId,
    //   user_id: userId,
    //   status: "pending",
    // });

    const payload: ExtractionJobPayload = { jobId, s3Key, tenderId, userId };

    // 2. Enqueue job (no-op or log for now, SQS later)
    await jobQueue.enqueueExtractionJob(payload);

    return {
      ...payload,
      status: "pending",
    };
  }

  async getJob(jobId: string): Promise<ExtractionJob | null> {
    // TODO: fetch from Supabase: select * from extraction_jobs where id = jobId
    return null;
  }
}

export const extractorService: ExtractorService = new DefaultExtractorService();
