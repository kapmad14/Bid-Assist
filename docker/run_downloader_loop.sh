#!/usr/bin/env bash
# runs download_from_db.py every hour
set -euo pipefail

cd /app || exit 1
mkdir -p ./logs

while true; do
  echo "=== $(date -u) Starting download_from_db.py ===" >> ./logs/download_loop.log 2>&1
  python3 download_from_db.py --limit 50 >> ./logs/download_loop.log 2>&1 || echo "download_from_db.py returned non-zero" >> ./logs/download_loop.log 2>&1
  echo "=== $(date -u) Finished download_from_db.py. Sleeping 3600s ===" >> ./logs/download_loop.log 2>&1
  sleep 3600
done
