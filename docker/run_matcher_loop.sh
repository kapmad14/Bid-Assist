#!/usr/bin/env bash
set -euo pipefail

# Go to app directory inside the container
cd /app || exit 1

# Ensure logs dir exists
mkdir -p ./logs

# Optional: allow overriding via env var, default 5 seconds
POLL_INTERVAL="${POLL_INTERVAL:-5}"

while true; do
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) Starting worker_matcher.py (loop) ===" >> ./logs/matcher_worker.log 2>&1

  # Run your matcher in loop mode
  python3 worker_matcher.py --worker-loop >> ./logs/matcher_worker.log 2>&1 || \
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) worker_matcher.py exited with non-zero status ===" >> ./logs/matcher_worker.log 2>&1

  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) worker_matcher.py finished, sleeping ${POLL_INTERVAL}s ===" >> ./logs/matcher_worker.log 2>&1

  sleep "${POLL_INTERVAL}"
done
