#!/usr/bin/env bash
# Runs backfill daily at 07:00 IST

set -euo pipefail
cd /app || exit 1
mkdir -p ./logs

LOG="./logs/backfill_loop.log"

while true; do
    # current UTC time
    NOW_UTC=$(date -u +%s)

    # compute next 07:00 IST (= 01:30 UTC)
    TARGET_UTC=$(date -u -d "today 01:30" +%s)

    # if today's 01:30 UTC has already passed, schedule for tomorrow
    if [ "$TARGET_UTC" -le "$NOW_UTC" ]; then
        TARGET_UTC=$(date -u -d "tomorrow 01:30" +%s)
    fi

    # seconds to wait
    SLEEP_SECS=$(( TARGET_UTC - NOW_UTC ))

    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ⏳ Sleeping $SLEEP_SECS sec until next 07:00 IST" >> "$LOG"

    sleep "$SLEEP_SECS"

    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ▶ Running daily backfill" >> "$LOG"

    # Run *yesterday’s* backfill
    python3 backfill_tenders_from_storage.py >> "$LOG" 2>&1 \
        || echo "$(date -u) ❌ Backfill exited with non-zero" >> "$LOG"

done
