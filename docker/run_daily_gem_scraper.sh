#!/usr/bin/env bash
set -euo pipefail

TARGET_HOUR=12
TARGET_MINUTE=15

cd /app/gem-scraper || exit 1
mkdir -p ./logs

  # if target time already passed today → schedule for tomorrow
  if [ "$CURRENT_TIMESTAMP" -gt "$TARGET_TIMESTAMP" ]; then
      TARGET_TIMESTAMP=$(date -d "tomorrow $TARGET_HOUR:$TARGET_MINUTE" +%s)
  fi

  SECONDS_TO_WAIT=$(( TARGET_TIMESTAMP - CURRENT_TIMESTAMP ))

  echo "⏳ Waiting $SECONDS_TO_WAIT seconds until next run at $TARGET_HOUR:$TARGET_MINUTE" >> ./logs/daily_scraper.log

  sleep "$SECONDS_TO_WAIT"

  # Run job
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) Starting daily_gem_pdf_scraper.py ===" >> ./logs/daily_scraper.log 2>&1

  python3 daily_gem_pdf_scraper.py >> ./logs/daily_scraper.log 2>&1 \
    || echo "⚠️ daily_gem_pdf_scraper.py returned non-zero" >> ./logs/daily_scraper.log 2>&1

  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) Finished execution ===" >> ./logs/daily_scraper.log 2>&1

  # Loop naturally continues → next target at next 00:30
done
