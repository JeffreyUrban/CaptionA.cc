# Dockerfile for CaptionA.cc Orchestrator Service
# Runs both FastAPI health API and Prefect worker

FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy dependency files
COPY pyproject.toml ./

# Install Python dependencies
RUN pip install --no-cache-dir -e .

# Copy application code
COPY . .

# Expose health API port
EXPOSE 8000

# Start both health API and Prefect worker
CMD ["python", "start_all.py"]
