#!/usr/bin/env bash
# runs poll_page1.py every 10 minutes, logs to logs/poll_loop.log
set -euo pipefail

cd /app || exit 1
mkdir -p ./logs

while true; do
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) Starting poll_page1.py ===" >> ./logs/poll_loop.log 2>&1
  # run poll (non-fatal)
  python3 poll_page1.py >> ./logs/poll_loop.log 2>&1 || echo "poll_page1.py returned non-zero" >> ./logs/poll_loop.log 2>&1
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) Finished poll_page1.py. Sleeping 600s ===" >> ./logs/poll_loop.log 2>&1
  sleep 600
done
