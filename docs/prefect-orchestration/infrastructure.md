# Prefect Infrastructure

Self-hosted Prefect server on Fly.io with auto-stop for cost efficiency.

---

## Why Self-Hosted?

| Option | Deployments | Cost | Decision |
|--------|-------------|------|----------|
| Prefect Cloud Free | 5 | $0 | Too limited |
| Prefect Cloud Pro | 20 | $100/mo | Too expensive |
| Self-hosted (Fly.io) | Unlimited | ~$3/mo | **Selected** |

Self-hosted provides unlimited deployments at minimal cost with auto-stop.

---

## Deployment Architecture

```
┌────────────────────────────────────┐
│     Fly.io: traefik-prefect        │
├────────────────────────────────────┤
│  Prefect Server (API + UI)         │
│  Port: 4200                         │
│  Database: SQLite (/data/prefect.db)│
│  Auto-stop: Yes                     │
└────────────────────────────────────┘
            ↕
┌────────────────────────────────────┐
│     API Service (local/Fly.io)     │
├────────────────────────────────────┤
│  Prefect Worker (subprocess)       │
│  Polls work pool: captionacc-workers│
│  Executes flows locally            │
└────────────────────────────────────┘
```

**Key Point:** Prefect server only coordinates. API service owns and executes flows.

---

## Fly.io Configuration

### Auto-Stop Settings

```toml
[http_service]
  auto_stop_machines = true    # Stop when no requests
  auto_start_machines = true   # Start on incoming request
  min_machines_running = 0     # Allow full stop
```

### Wake-Up Triggers
- Webhook request (Supabase → API → Prefect)
- API health check
- Flow run creation

### Wake-Up Time
- Cold start: ~5-10 seconds
- Warm (recently stopped): ~2-3 seconds

**Implication:** First flow after idle has 5-10s delay. Supabase webhooks may timeout on cold start (configure retry).

---

## Work Pool Configuration

**Name:** `captionacc-workers`
**Type:** `process`
**Concurrency:** 5 (total)

### Per-Flow Concurrency

| Flow | Max Concurrent | Rationale |
|------|----------------|-----------|
| video-initial-processing | 5 | Modal scales, background job |
| crop-and-infer | 2 | Expensive GPU, user-blocking |
| caption-ocr | 10 | Fast, lightweight |

---

## Secrets Management

### Required Secrets

**For Prefect Server (Fly.io):**
```bash
fly secrets set MODAL_TOKEN_ID=xxx
fly secrets set MODAL_TOKEN_SECRET=xxx
fly secrets set SUPABASE_URL=xxx
fly secrets set SUPABASE_SERVICE_KEY=xxx
fly secrets set WASABI_ACCESS_KEY=xxx
fly secrets set WASABI_SECRET_KEY=xxx
fly secrets set WEBHOOK_SECRET=xxx
```

**For API Service (.env):**
```bash
PREFECT_API_URL=https://traefik-prefect.fly.dev/api
WEBHOOK_SECRET=xxx
SUPABASE_URL=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
WASABI_ACCESS_KEY_READWRITE=xxx
WASABI_SECRET_KEY_READWRITE=xxx
WASABI_BUCKET=caption-acc-prod
```

---

## Deployment Commands

### Initial Setup

```bash
# Create app
fly apps create traefik-prefect

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

# Rollback
fly releases
fly deploy --image registry.fly.io/traefik-prefect:v123
```

---

## Health Checks

### Prefect Server
```bash
curl https://traefik-prefect.fly.dev/api/health
# Expected: {"status": "ok"}
```

### Worker Status
Check via Prefect UI:
- Work Pools → captionacc-workers → Workers
- Should show active worker from API service

---

## Monitoring

### Fly.io Metrics
```bash
fly status        # CPU/Memory usage
fly logs          # Recent logs
```

### Prefect UI
- **URL:** https://traefik-prefect.fly.dev
- Monitor: Flow runs, work pool health, task logs

### Key Metrics
- Flow execution time per type
- Flow success rate
- Lock contention rate
- Worker health and uptime

---

## Cost Estimation

### Fly.io Pricing (2026)

| Resource | Allocation | Cost/Month |
|----------|------------|------------|
| Shared CPU | 1 vCPU | ~$1.94 |
| Memory | 512 MB | ~$0.60 |
| Volume | 1 GB | ~$0.15 |
| **Total** | | **~$2.70** |

**With auto-stop:**
- Active 10% of time: ~$0.30/mo
- Active 50% of time: ~$1.35/mo
- Active 100% of time: ~$2.70/mo

Actual cost depends on usage patterns.

---

## Troubleshooting

### Worker Not Connecting

```bash
# Check API service logs for worker output
# Look for: "[Worker] Connecting to Prefect server..."

# Verify PREFECT_API_URL is set
echo $PREFECT_API_URL

# Test connection
curl https://traefik-prefect.fly.dev/api/health
```

### Flow Runs Stuck in "Scheduled"

**Cause:** Worker not polling or crashed

**Solution:**
```bash
# Check if worker is running
ps aux | grep "prefect worker"

# Restart API service
# Worker starts automatically with API
```

### Machine Not Auto-Starting

**Cause:** Webhook timeout too short

**Solution:** Configure Supabase webhook with longer timeout (30s) and retry policy.

### SQLite Database Corruption

**Cause:** Machine terminated during write

**Solution:**
```bash
fly ssh console --app traefik-prefect

# Backup and recreate
cp /data/prefect.db /data/prefect.db.bak
rm /data/prefect.db

# Restart (will recreate database)
fly apps restart traefik-prefect
# Note: Loses flow run history
```

---

## Related Documentation

- [Architecture & Design](./ARCHITECTURE.md) - Design decisions and rationale
- [Operations](./operations.md) - Monitoring and recovery procedures
- [Quick Start](./QUICKSTART.md) - Getting started guide
