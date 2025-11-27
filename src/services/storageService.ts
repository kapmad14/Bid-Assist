// src/services/storageService.ts

export interface StorageService {
  uploadObject(params: {
    key: string;          // "bids/GEM_doc_123.pdf"
    contentType: string;  // "application/pdf"
    body: Buffer;         // or Readable stream if you prefer
  }): Promise<{ url: string }>;

  getPublicUrl(key: string): string;

  // Future option:
  // getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

// TEMPORARY placeholder implementation (MVP phase)
export const storageService: StorageService = {
  async uploadObject({ key, contentType, body }) {
    // Later: replace with S3 or Supabase upload
    console.warn("⚠ storageService.uploadObject called — not implemented yet");
    throw new Error("storageService.uploadObject not implemented yet");
  },

  getPublicUrl(key: string): string {
    // Change to real public URL once storage is wired
    return key;
  },
};
