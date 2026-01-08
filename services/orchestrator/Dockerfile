# Dockerfile for CaptionA.cc Orchestrator Service
# Runs both FastAPI health API and Prefect worker

FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy local package dependencies from repo root
COPY packages/frames_db ./packages/frames_db
COPY packages/vp9_utils ./packages/vp9_utils

# Install local packages with VCS version override for Docker builds
# frames_db uses hatch-vcs which needs git context, so we set a pretend version
ENV SETUPTOOLS_SCM_PRETEND_VERSION_FOR_FRAMES_DB=0.1.dev0
RUN pip install --no-cache-dir ./packages/frames_db ./packages/vp9_utils
ENV SETUPTOOLS_SCM_PRETEND_VERSION_FOR_FRAMES_DB=

# Copy orchestrator code
COPY services/orchestrator/ .

# Install orchestrator dependencies (should include everything from pyproject.toml)
RUN pip install --no-cache-dir -e .

# Expose health API port
EXPOSE 8000

# Start both health API and Prefect worker
CMD ["python", "start_all.py"]
