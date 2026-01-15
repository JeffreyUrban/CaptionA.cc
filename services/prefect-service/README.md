# Prefect Server - Scale-to-Zero Deployment

Lightweight Prefect server that coordinates workflows across all projects.

## Architecture

- **Instance Size**: 512MB RAM, shared-cpu-1x
- **Scaling**: 0-1 instances (auto-start on HTTP requests)
- **Backend**: Embedded SQLite (Supabase PostgreSQL optional)
- **Cost**: $0 when idle, ~$4/month if running 24/7

## Deployment

### 1. Create Fly.io App

```bash
cd services/prefect-service
fly apps create prefect --org personal
```

### 2. Configure Supabase Backend

Get your Supabase connection string with `postgres` role (not `pgbouncer`):

```
postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

Set as Fly secret:

```bash
fly secrets set \
  PREFECT_API_DATABASE_CONNECTION_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres" \
  -a prefect
```

### 3. Deploy

```bash
fly deploy -a prefect
```

### 4. Verify

```bash
# Check health
curl https://prefect.fly.dev/api/health

# View Prefect UI
open https://prefect.fly.dev/
```

## Connecting Flow Server

The flow server runs locally and connects to the Prefect server on Fly.io:

```bash
# Configure Prefect to use self-hosted server
prefect profile create self-hosted
prefect profile use self-hosted
prefect config set PREFECT_API_URL="https://prefect-service.fly.dev/api"

# Start the flow server (registers deployments and executes flows)
cd /Users/jurban/PycharmProjects/CaptionA.cc-claude3
uv run python services/orchestrator/serve_flows.py
```

The `serve_flows.py` script:
1. Registers all flow deployments with the Prefect server
2. Runs a worker process that executes flows when triggered
3. Must stay running to process flow executions

## Architecture Notes

- **No Work Pools Needed**: The `serve()` approach combines deployment registration + worker execution in one process
- **Simple Setup**: Just run `serve_flows.py` - it handles both registration and execution
- **Multi-Project Usage**: Each project can run its own `serve_flows.py` connected to the same Prefect server
- **Flow Isolation**: Use tags to organize flows by project (e.g., `tags=["captionacc", "upload"]`)

## Monitoring

- **Prefect UI**: https://prefect.fly.dev/
- **Fly.io Dashboard**: https://fly.io/apps/prefect
- **Logs**: `fly logs -a prefect`

## Scaling Configuration

```toml
# Current: Scale to zero
min_machines_running = 0

# To keep always-on (instant response):
min_machines_running = 1
```

## Cost Analysis

**With auto-scale (0-1 instances, 512MB):**
- Idle (powered down): $0/month
- Light usage (2 hours/day): ~$0.50/month
- Medium usage (8 hours/day): ~$2/month
- Always-on (24/7): ~$4/month

**Cold start:** ~2-5 seconds when waking from sleep

## Troubleshooting

### Server Won't Start

Check database connection:
```bash
fly ssh console -a prefect
prefect config view
```

### Workers Can't Connect

Verify PREFECT_API_URL is set correctly:
```bash
fly ssh console -a captionacc-orchestrator
echo $PREFECT_API_URL
# Should be: https://prefect.fly.dev/api
```

### Memory Issues (OOM)

If server crashes with 256MB, increase memory:
```bash
fly scale memory 512 -a prefect
```
