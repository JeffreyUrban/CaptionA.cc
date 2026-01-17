#!/usr/bin/env bash
#
# Start script for CaptionA.cc API
# Runs both the FastAPI server and Supercronic scheduler
#

set -euo pipefail

echo "=== Starting CaptionA.cc API ==="

# Start Supercronic in the background for scheduled tasks
if [ -f /app/crontab ]; then
    echo "Starting Supercronic scheduler..."
    supercronic /app/crontab &
    SUPERCRONIC_PID=$!
    echo "Supercronic started (PID: $SUPERCRONIC_PID)"
else
    echo "Warning: crontab file not found, scheduled tasks will not run"
fi

# Start the FastAPI application (foreground)
echo "Starting FastAPI server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
