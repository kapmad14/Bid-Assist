#!/usr/bin/env bash
# runs upload_pdfs_to_supabase.py every hour
set -euo pipefail

cd /app || exit 1
mkdir -p ./logs

while true; do
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) Starting upload_pdfs_to_supabase.py ===" >> ./logs/pdf_upload_loop.log 2>&1
  python3 upload_pdfs_to_supabase.py >> ./logs/pdf_upload_loop.log 2>&1 || \
    echo "upload_pdfs_to_supabase.py returned non-zero" >> ./logs/pdf_upload_loop.log 2>&1
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) Finished upload_pdfs_to_supabase.py. Sleeping 3600s ===" >> ./logs/pdf_upload_loop.log 2>&1
  sleep 3600
done
