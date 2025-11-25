#!/usr/bin/env bash
# Runs parse_supabase_bids.py every 6 hours
# Automatically processes only new PDFs in /bids folder

set -euo pipefail
cd /app || exit 1
mkdir -p ./logs

while true; do
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) Starting BID parser ===" >> ./logs/parser_loop.log 2>&1
    
    # Run parser (non-fatal if it fails)
    python3 parse_supabase_bids.py >> ./logs/parser_loop.log 2>&1 || echo "Parser returned non-zero" >> ./logs/parser_loop.log 2>&1
    
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) Finished. Sleeping 900s (15 minutes) ===" >> ./logs/parser_loop.log 2>&1
    sleep 900

done
