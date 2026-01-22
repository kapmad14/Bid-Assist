import { jobQueue } from "./jobQueue";
import type { ExtractionJob, ExtractionJobPayload } from "../types/extractionJob";
import { supabase } from "../lib/supabase";

export interface ExtractorService {
  createJob(input: {
    s3Key: string;
    tenderId: string;
    userId: string;
  }): Promise<ExtractionJob>;

  getJob(jobId: string): Promise<ExtractionJob | null>;
}

class DefaultExtractorService implements ExtractorService {
  async createJob({
    s3Key,
    tenderId,
    userId,
  }: {
    s3Key: string;
    tenderId: string;
    userId: string;
  }): Promise<ExtractionJob> {
    const jobId = crypto.randomUUID();

    // 1️⃣ Persist immediately (source of truth)
    const { error } = await supabase
      .from("extraction_jobs")
      .insert({
        job_id: jobId,
        s3_key: s3Key,
        tender_id: tenderId,
        user_id: userId,
        status: "pending",
      });

    if (error) {
      throw error;
    }

    const payload: ExtractionJobPayload = {
      jobId,
      s3Key,
      tenderId,
      userId,
    };

    // 2️⃣ Enqueue for background processing (best-effort)
    await jobQueue.enqueueExtractionJob(payload);

    return {
      ...payload,
      status: "pending",
    };
  }

  async getJob(jobId: string): Promise<ExtractionJob | null> {
    const { data, error } = await supabase
      .from("extraction_jobs")
      .select("*")
      .eq("job_id", jobId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      jobId: data.job_id,
      s3Key: data.s3_key,
      tenderId: data.tender_id,
      userId: data.user_id,
      status: data.status,
      result: data.result ?? null,
      error: data.error ?? null,
      updatedAt: data.updated_at,
    };
  }
}

export const extractorService: ExtractorService = new DefaultExtractorService();
