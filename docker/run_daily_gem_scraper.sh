#!/usr/bin/env bash
set -euo pipefail

TARGET_TIME="13:15"   # IST time
cd /app/gem-scraper || exit 1
mkdir -p ./logs

while true; do
  # current time in IST
  CURRENT_TIMESTAMP=$(TZ="Asia/Kolkata" date +%s)

  # target timestamp for today in IST
  TARGET_TIMESTAMP=$(TZ="Asia/Kolkata" date -d "$(date +%Y-%m-%d) $TARGET_TIME" +%s)

  # if current time already passed → move target to tomorrow
  if [ "$CURRENT_TIMESTAMP" -gt "$TARGET_TIMESTAMP" ]; then
    TARGET_TIMESTAMP=$(TZ="Asia/Kolkata" date -d "tomorrow $TARGET_TIME" +%s)
  fi

  SECONDS_TO_WAIT=$(( TARGET_TIMESTAMP - CURRENT_TIMESTAMP ))

  echo "⏳ Waiting $SECONDS_TO_WAIT seconds until next run at $TARGET_TIME IST" \
    >> ./logs/daily_scraper.log

  sleep "$SECONDS_TO_WAIT"

  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) Starting daily_gem_pdf_scraper.py ===" \
    >> ./logs/daily_scraper.log

  python3 daily_gem_pdf_scraper.py >> ./logs/daily_scraper.log 2>&1 \
    || echo "⚠️ daily_gem_pdf_scraper.py returned non-zero" \
    >> ./logs/daily_scraper.log

  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) Finished execution ===" \
    >> ./logs/daily_scraper.log

done
