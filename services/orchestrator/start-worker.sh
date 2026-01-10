#!/bin/bash

# Load environment variables
set -a
source /Users/jurban/PycharmProjects/CaptionA.cc/.env
set +a

# Set Prefect API URL and enable debug logging
export PREFECT_API_URL=https://prefect-service.fly.dev/api
export PREFECT_LOGGING_LEVEL=DEBUG

# Start the worker
echo "Starting Prefect worker with environment variables loaded..."
echo "Work pool: captionacc-workers"
echo "Prefect API: $PREFECT_API_URL"
echo "Logging level: DEBUG"
echo ""

prefect worker start --pool captionacc-workers
