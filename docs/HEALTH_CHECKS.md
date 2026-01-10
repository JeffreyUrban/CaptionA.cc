# Health Checks & Monitoring

This document describes the health check system for CaptionA.cc infrastructure.

## Overview

The system uses a multi-layer monitoring approach:

1. **Fly.io Internal Health Checks** - Auto-restart unhealthy machines
2. **GitHub Actions Daily Monitoring** - Keep-alive + health verification + restart detection
3. **Manual Health Checks** - On-demand verification during deployments

## Health Check Endpoints

### Web App: `/health`

**URL**: `https://captionacc-web.fly.dev/health`

**Checks**:
- ✅ Supabase connectivity (production schema)
- ✅ Wasabi readonly credentials
- ✅ Application uptime

**Response Codes**:
- `200 OK` - All systems healthy
- `503 Service Unavailable` - Critical system failure

**Example Response**:
```json
{
  "status": "healthy",
  "timestamp": "2026-01-07T12:00:00Z",
  "environment": "production",
  "version": "1.2.3",
  "response_time_ms": 145,
  "components": {
    "supabase": {
      "status": "healthy",
      "response_ms": 45
    },
    "wasabi": {
      "status": "healthy",
      "response_ms": 98
    }
  }
}
```

### Orchestrator: `/health`

**URL**: `https://captionacc-orchestrator.fly.dev/health`

**Checks**:
- ✅ Supabase connectivity
- ✅ Wasabi readwrite credentials
- ℹ️ Prefect API connectivity (optional, not configured in ephemeral mode)
- ✅ Server uptime

**Note**: Prefect health check currently shows "not_configured" because Prefect runs in ephemeral mode (no separate HTTP API server). If you deploy a separate Prefect server in the future, add `PREFECT_API_URL` and `PREFECT_API_KEY` secrets to enable Prefect health monitoring.

**Response Codes**:
- `200 OK` - All critical systems healthy
- `503 Service Unavailable` - Critical system failure

**Component Status Values**:
- `healthy` - Component functioning normally
- `degraded` - Component has issues but not critical (e.g., Prefect API slow)
- `unhealthy` - Component failed (e.g., invalid credentials)

## Fly.io Internal Health Checks

Configured in `fly.toml` for both apps.

**Configuration**:
```toml
[[http_service.checks]]
  interval = "30s"         # Check every 30 seconds
  timeout = "5s"           # Fail if no response in 5s
  grace_period = "60s"     # Allow startup time
  method = "GET"
  path = "/health"
```

**Behavior**:
- Runs **only when machine is awake** (doesn't prevent auto-sleep)
- Restarts machine after **3 consecutive failures** (90s downtime)
- Prevents restart loops by requiring multiple failures

**Check Status**:
```bash
# View health check status
fly status -a captionacc-web
fly status -a captionacc-orchestrator

# View recent logs
fly logs -a captionacc-web
fly logs -a captionacc-orchestrator
```

## GitHub Actions Daily Monitoring

**Workflow**: `.github/workflows/health-check-and-keepalive.yml`

**Schedule**: Daily at 03:47 UTC (random off-peak time)

**Actions**:
1. ✅ Supabase keep-alive query (prevent free tier hibernation)
2. ✅ Check web app health
3. ✅ Check orchestrator health
4. ✅ Detect restart loops (>3 restarts)
5. ✅ Ping Better Stack heartbeat (confirms workflow ran)

**Manual Trigger**:
```bash
# Trigger workflow manually
gh workflow run health-check-and-keepalive.yml
```

**Notifications**:
- **Recommended**: Use Better Stack for alerts (see [Better Stack Setup](./BETTERSTACK_SETUP.md))
- Provides email, phone, and Slack notifications
- Better incident management than GitHub email notifications
- Free tier is sufficient for this use case

## Sleep Behavior

### Web App (`captionacc-web`)
- **Auto-stops when idle** (`auto_stop_machines = 'stop'`)
- **No minimum running machines** (`min_machines_running = 0`)
- Wakes automatically on incoming requests
- **Cost**: Only pays when running (ideal for free tier)

**Impact of Monitoring**:
- Fly.io health checks: ✅ Don't prevent sleep (internal only)
- GitHub Actions: ✅ Once daily, allows 23+ hours of sleep
- External monitoring services: ❌ Would prevent sleep (not recommended)

### Orchestrator (`captionacc-orchestrator`)
- **Always running** (`auto_stop_machines = false`)
- **Required for Prefect worker** (polls for jobs)
- Continuous monitoring is safe (already always-on)

## Restart Loop Detection

The system monitors for restart loops using multiple signals:

### GitHub Actions Detection
Runs daily, checks machine restart events:
```bash
flyctl machine status <machine-id> -a captionacc-web
```

Alerts if >3 restart events detected.

### Manual Check
```bash
# Check machine status
fly status -a captionacc-web

# Look for "Restarts" column - should be 0-1
# Multiple restarts = potential loop

# Check recent logs for crashes
fly logs -a captionacc-web --since 1h
```

### Common Restart Loop Causes
1. **Invalid credentials** - Health check fails immediately
2. **Missing dependencies** - Crash on startup
3. **Port binding issues** - Can't listen on required port
4. **Resource exhaustion** - OOM, CPU throttling
5. **Database connection pool exhaustion** - Supabase connection limits

## Manual Health Checks

### Quick Check (Both Apps)
```bash
# Web app
curl https://captionacc-web.fly.dev/health | jq '.'

# Orchestrator
curl https://captionacc-orchestrator.fly.dev/health | jq '.'
```

### Detailed Status
```bash
# Machine status
fly status -a captionacc-web
fly status -a captionacc-orchestrator

# Recent logs
fly logs -a captionacc-web --since 10m
fly logs -a captionacc-orchestrator --since 10m

# Machine metrics (CPU, memory)
fly dashboard -a captionacc-web
fly dashboard -a captionacc-orchestrator
```

## Troubleshooting

### Health Check Returns 503

**Supabase Component Unhealthy**:
```bash
# Check Supabase status
curl ${SUPABASE_URL}/rest/v1/ \
  -H "apikey: ${SUPABASE_ANON_KEY}"

# Verify schema in secrets
fly secrets list -a captionacc-web
# Should have VITE_SUPABASE_SCHEMA=captionacc_production
```

**Wasabi Component Unhealthy**:
```bash
# Check credentials are set
fly secrets list -a captionacc-web
# Should have WASABI_ACCESS_KEY_READONLY, WASABI_SECRET_KEY_READONLY

# Test credentials locally
aws s3 ls s3://caption-acc-prod \
  --endpoint-url https://s3.us-east-1.wasabisys.com \
  --profile wasabi-readonly
```

### Machine Stuck in Restart Loop

1. **Check logs immediately**:
   ```bash
   fly logs -a captionacc-web --since 30m
   ```

2. **Look for error patterns**:
   - "Connection refused" → Port binding issue
   - "Invalid credentials" → Secrets problem
   - "ECONNREFUSED" → Dependency unreachable
   - "Out of memory" → Resource limits

3. **Stop restart loop**:
   ```bash
   # Scale to 0 to stop loop
   fly scale count 0 -a captionacc-web

   # Fix issue (update secrets, code, etc.)

   # Scale back up
   fly scale count 1 -a captionacc-web
   ```

### GitHub Actions Workflow Failing

1. **Check secrets are configured**:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `FLY_API_TOKEN`

2. **View workflow logs**:
   - Go to GitHub Actions tab
   - Click on failed workflow run
   - Review each step's output

3. **Test workflow manually**:
   ```bash
   gh workflow run health-check-and-keepalive.yml
   gh workflow view health-check-and-keepalive.yml
   ```

## Best Practices

### For Development
- ✅ Test health endpoints locally before deploying
- ✅ Verify all environment variables are set
- ✅ Check health after every deployment
- ✅ Monitor logs during rollout

### For Production
- ✅ Always check health before and after credential rotation
- ✅ Keep GitHub Actions workflow enabled
- ✅ Review weekly for degraded components
- ✅ Set up additional email alerts if needed

### Cost Optimization
- ✅ Use daily (not continuous) external monitoring for web app
- ✅ Rely on Fly.io internal health checks for auto-restart
- ✅ Allow web app to sleep when idle
- ❌ Don't add external monitoring services that ping frequently

## Better Stack Integration (Recommended)

For comprehensive monitoring with email/phone alerts, set up Better Stack:

1. **Create Better Stack account** (free tier)
2. **Monitor orchestrator health endpoint** (continuous, 3-minute intervals)
3. **Monitor GitHub Actions workflow** (heartbeat, daily verification)
4. **Configure notifications** (email, phone, Slack)

**Full setup guide**: [Better Stack Setup](./BETTERSTACK_SETUP.md)

**Why Better Stack?**
- ✅ Purpose-built for uptime monitoring
- ✅ Free tier includes phone call alerts
- ✅ Incident management (groups related failures)
- ✅ Historical uptime data
- ✅ No complex SMTP/webhook setup

## Next Steps

### Immediate
1. ✅ Health endpoints implemented
2. ✅ Fly.io health checks configured
3. ✅ GitHub Actions workflow created
4. ✅ Documentation complete
5. 🔲 **Set up Better Stack monitoring** (see [guide](./BETTERSTACK_SETUP.md))

### Future Enhancements
- 📊 **Add metrics collection** (response times, error rates)
- 🧹 **Scheduled cleanup tasks** (orphaned Wasabi files, old databases)
- 🔐 **Automatic credential rotation** (with verification)
- 📄 **Public status page** (via Better Stack)
- 🔧 **Deploy separate Prefect server** (currently ephemeral mode)
  - Add Prefect server as separate Fly.io service
  - Configure `PREFECT_API_URL` and `PREFECT_API_KEY` secrets
  - Enable Prefect health monitoring in orchestrator

## Related Documentation

- [Better Stack Setup Guide](./BETTERSTACK_SETUP.md) ⭐ **Start here for notifications**
- [Key Rotation Process](./KEY_ROTATION.md)
- [Fly.io Deployment](../README.md#deployment)
- [Wasabi Storage](data-architecture/archive-revise-or-remove/WASABI_ARCHITECTURE.md)
