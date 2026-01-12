# Prefect Infrastructure

Self-hosted Prefect deployment on Fly.io with auto-stop for cost efficiency.

## Architecture Decision

### Why Self-Hosted?

| Option | Deployments | Cost | Decision |
|--------|-------------|------|----------|
| Prefect Cloud Free | 5 | $0 | Too limited |
| Prefect Cloud Pro | 20 | $100/mo | Too expensive |
| Self-hosted (Fly.io) | Unlimited | ~$3/mo | Selected |

Self-hosted provides unlimited deployments at minimal cost with auto-stop.

## Components

```
┌─────────────────────────────────────────────────────────────────┐
│                     Fly.io Application                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────┐     ┌─────────────────────┐          │
│   │   Prefect Server    │     │   Prefect Worker    │          │
│   │   (API + UI)        │     │   (ProcessWorker)   │          │
│   │   Port 4200         │     │                     │          │
│   └──────────┬──────────┘     └──────────┬──────────┘          │
│              │                           │                      │
│              └───────────┬───────────────┘                      │
│                          │                                      │
│                          ▼                                      │
│              ┌─────────────────────┐                            │
│              │   SQLite Database   │                            │
│              │   /data/prefect.db  │                            │
│              └─────────────────────┘                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Fly.io Configuration

### fly.toml

```toml
app = "captionacc-prefect"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  PREFECT_SERVER_API_HOST = "0.0.0.0"
  PREFECT_SERVER_API_PORT = "4200"
  PREFECT_API_DATABASE_CONNECTION_URL = "sqlite+aiosqlite:////data/prefect.db"

[http_service]
  internal_port = 4200
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[mounts]
  source = "prefect_data"
  destination = "/data"

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
```

### Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install Prefect
RUN pip install prefect>=3.0.0

# Copy flow definitions
COPY flows/ /app/flows/
COPY prefect.yaml /app/

# Startup script
COPY start.sh /app/
RUN chmod +x /app/start.sh

EXPOSE 4200

CMD ["/app/start.sh"]
```

### start.sh

```bash
#!/bin/bash
set -e

# Start Prefect server in background
prefect server start --host 0.0.0.0 --port 4200 &
SERVER_PID=$!

# Wait for server to be ready
sleep 5

# Set API URL for worker
export PREFECT_API_URL="http://localhost:4200/api"

# Create work pool if it doesn't exist
prefect work-pool create captionacc-workers --type process || true

# Start worker
prefect worker start --pool captionacc-workers &
WORKER_PID=$!

# Handle shutdown
trap "kill $SERVER_PID $WORKER_PID" SIGTERM SIGINT

# Wait for either process to exit
wait -n
exit $?
```

## Work Pool Configuration

### Pool Settings

```yaml
name: captionacc-workers
type: process
concurrency_limit: 5

# Base job template
base_job_template:
  job_configuration:
    env:
      MODAL_TOKEN_ID: "{{ $MODAL_TOKEN_ID }}"
      MODAL_TOKEN_SECRET: "{{ $MODAL_TOKEN_SECRET }}"
      SUPABASE_URL: "{{ $SUPABASE_URL }}"
      SUPABASE_SERVICE_KEY: "{{ $SUPABASE_SERVICE_KEY }}"
      WASABI_ACCESS_KEY: "{{ $WASABI_ACCESS_KEY }}"
      WASABI_SECRET_KEY: "{{ $WASABI_SECRET_KEY }}"
```

### Concurrency Limits

| Resource | Limit | Rationale |
|----------|-------|-----------|
| Work pool total | 5 | Memory constraint (512MB) |
| captionacc-video-initial-processing | 3 | Background, can queue |
| captionacc-crop-and-infer-caption-frame-extents | 2 | User-blocking, priority |
| captionacc-caption-ocr | 5 | Fast, lightweight |

## Auto-Stop Behavior

Fly.io auto-stop reduces costs by stopping machines when idle.

### Configuration

```toml
[http_service]
  auto_stop_machines = true    # Stop when no requests
  auto_start_machines = true   # Start on incoming request
  min_machines_running = 0     # Allow full stop
```

### Wake-Up Triggers

1. **Webhook request** (Supabase → Prefect)
2. **API health check** (monitoring)
3. **Flow run creation** (API → Prefect)

### Wake-Up Time

- Cold start: ~5-10 seconds
- Warm (recently stopped): ~2-3 seconds

### Implications

- First flow after idle period has 5-10s delay
- Webhooks may timeout on cold start (configure retry)
- Health checks keep machine warm if frequent

## Secrets Management

### Fly.io Secrets

```bash
# Set secrets
fly secrets set MODAL_TOKEN_ID=xxx
fly secrets set MODAL_TOKEN_SECRET=xxx
fly secrets set SUPABASE_URL=https://xxx.supabase.co
fly secrets set SUPABASE_SERVICE_KEY=xxx
fly secrets set WASABI_ACCESS_KEY=xxx
fly secrets set WASABI_SECRET_KEY=xxx
```

### Required Secrets

| Secret | Purpose                  |
|--------|--------------------------|
| `MODAL_TOKEN_ID` | Modal API authentication |
| `MODAL_TOKEN_SECRET` | Modal API authentication |
| `WEBHOOK_SECRET` | TODO: write description  |
| `SUPABASE_URL` | Supabase project URL     |
| `SUPABASE_SERVICE_KEY` | Supabase admin access    |
| `WASABI_ACCESS_KEY` | Wasabi S3 access         |
| `WASABI_SECRET_KEY` | Wasabi S3 secret         |

## Deployment

### Initial Setup

```bash
# Create app
fly apps create captionacc-prefect

# Create volume for SQLite
fly volumes create prefect_data --size 1 --region iad

# Set secrets
fly secrets set MODAL_TOKEN_ID=xxx ...

# Deploy
fly deploy
```

### Updates

```bash
# Deploy new version
fly deploy

# View logs
fly logs

# SSH into machine
fly ssh console
```

### Rollback

```bash
# List releases
fly releases

# Rollback to previous
fly deploy --image registry.fly.io/captionacc-prefect:v123
```

## Webhook Endpoint

Supabase webhooks trigger flows via HTTP POST.

### Endpoint Configuration

```
URL: https://captionacc-prefect.fly.dev/webhooks/supabase
Method: POST
Headers:
  Authorization: Bearer {webhook_secret}
  Content-Type: application/json
```

### Webhook Handler

The Prefect service includes a FastAPI app for webhook handling:

```python
# webhook_server.py
from fastapi import FastAPI, Request, HTTPException
from prefect.client import get_client
import os

app = FastAPI()

WEBHOOK_SECRET = os.environ["WEBHOOK_SECRET"]

@app.post("/webhooks/supabase")
async def handle_supabase_webhook(request: Request):
    # Verify authorization
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {WEBHOOK_SECRET}":
        raise HTTPException(401, "Unauthorized")

    payload = await request.json()

    if payload.get("table") == "videos" and payload.get("type") == "INSERT":
        record = payload["record"]
        async with get_client() as client:
            deployment = await client.read_deployment_by_name(
                "captionacc-video-initial-processing"
            )
            await client.create_flow_run_from_deployment(
                deployment.id,
                parameters={
                    "video_id": record["id"],
                    "tenant_id": record["tenant_id"],
                    "storage_key": record["storage_key"]
                }
            )

    return {"status": "accepted"}
```

## Health Checks

### Fly.io Health Check

```toml
[[services.http_checks]]
  interval = 30000        # 30 seconds
  timeout = 5000          # 5 seconds
  grace_period = "10s"
  method = "GET"
  path = "/api/health"
```

### Prefect Server Health

```bash
# Check server status
curl https://captionacc-prefect.fly.dev/api/health

# Expected response
{"status": "ok"}
```

### Worker Health

Workers report health via Prefect server. Monitor via:
- Prefect UI: Work Pools → captionacc-workers
- API: `GET /api/work_pools/captionacc-workers/workers`

## Monitoring

### Fly.io Metrics

```bash
# CPU/Memory usage
fly status

# Recent logs
fly logs --app captionacc-prefect
```

### Prefect UI

Access at: `https://captionacc-prefect.fly.dev`

- Flow runs and status
- Work pool health
- Task execution logs

### Alerts

Configure via Fly.io or external monitoring:

```bash
# Example: Alert on machine restart
fly monitoring alerts create \
  --type machine_restart \
  --threshold 3 \
  --window 1h
```

## Cost Estimation

### Fly.io Pricing (as of 2026)

| Resource | Allocation | Cost/Month |
|----------|------------|------------|
| Shared CPU | 1 vCPU | ~$1.94 |
| Memory | 512 MB | ~$0.60 |
| Volume | 1 GB | ~$0.15 |
| **Total** | | **~$2.70** |

With auto-stop, actual costs depend on uptime:
- Active 10% of time: ~$0.30/mo
- Active 50% of time: ~$1.35/mo
- Active 100% of time: ~$2.70/mo

## Related Documentation

- [README](./README.md) - Architecture overview
- [Flows](./flows.md) - Flow specifications
- [Operations](./operations.md) - Operational procedures
