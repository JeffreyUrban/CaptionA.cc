# syntax=docker/dockerfile:1

FROM python:3.12-slim AS base

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Download CR-SQLite extension from GitHub (Wasabi mirror available as private backup)
# Source: https://github.com/superfly/cr-sqlite/releases
ARG CRSQLITE_RELEASE_TAG=prebuild-test.main-438663b8
RUN mkdir -p extensions/linux-x86_64 && \
    curl -fL -o /tmp/crsqlite.zip \
      "https://github.com/superfly/cr-sqlite/releases/download/${CRSQLITE_RELEASE_TAG}/crsqlite-linux-x86_64.zip" && \
    unzip /tmp/crsqlite.zip -d extensions/linux-x86_64/ && \
    rm /tmp/crsqlite.zip

# Install uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency files
COPY pyproject.toml ./

# Install dependencies
RUN uv pip install --system -e .

# Copy application code
COPY app ./app

# Create non-root user
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
