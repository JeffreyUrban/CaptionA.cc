FROM prefecthq/prefect:3-python3.11

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Use Supabase PostgreSQL as backend (set via environment variable)
ENV PREFECT_SERVER_API_HOST=0.0.0.0
ENV PREFECT_SERVER_API_PORT=4200
ENV PREFECT_UI_ENABLED=true

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD curl -f http://localhost:4200/api/health || exit 1

EXPOSE 4200

# Start Prefect server
CMD ["prefect", "server", "start", "--host", "0.0.0.0", "--port", "4200"]
