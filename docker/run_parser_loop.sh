#!/usr/bin/env bash
# Runs final_update_tenders_from_pdfs.py every 8 hours
# Automatically processes only new PDFs in the tenders table

set -euo pipefail
cd /app || exit 1
mkdir -p ./logs

while true; do
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) Starting final PDF parser ===" >> ./logs/parser_loop.log 2>&1
    
    # Run parser (non-fatal if it fails)
    python3 final_update_tenders_from_pdfs.py >> ./logs/parser_loop.log 2>&1 \
        || echo "Parser returned non-zero" >> ./logs/parser_loop.log 2>&1
    
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) Finished. Sleeping 28800s (8 hours) ===" >> ./logs/parser_loop.log 2>&1
    sleep 28800  # 8 hours

done
