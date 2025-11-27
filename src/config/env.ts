// src/config/env.ts
export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY!, // or anon if needed

  // Storage (S3 or compatible)
  STORAGE_BUCKET: process.env.STORAGE_BUCKET!,      // e.g. "gem-pdfs"
  STORAGE_BASE_URL: process.env.STORAGE_BASE_URL!,  // optional

  // Future queue (SQS)
  JOB_QUEUE_URL: process.env.JOB_QUEUE_URL || "",   // empty for now

  // App
  API_BASE_URL: process.env.API_BASE_URL || "",
};
