# Prefect Server Deployment (Future)

## Current State: Ephemeral Mode

The orchestrator currently runs Prefect in **ephemeral mode**:
- Flows are served directly via `serve_flows.py`
- No separate HTTP API server
- No persistent UI/dashboard
- Works perfectly fine for production use

## Future: Deploy Separate Prefect Server

If you want the Prefect UI, asset lineage visualization, and team collaboration features, deploy a separate Prefect server.

### Benefits of Separate Server
- 🎨 **Web UI** - Visual flow monitoring and debugging
- 📊 **Asset lineage** - Track data dependencies visually
- 👥 **Team collaboration** - Multiple users can view flows
- 📈 **Historical data** - Persistent flow run history
- 🔔 **Notifications** - Email/Slack alerts from Prefect

### Deployment Steps

1. **Create Prefect Server Fly.io App**

```bash
# Create new directory
mkdir services/prefect-service
cd services/prefect-service

# Create Dockerfile
cat > Dockerfile <<'EOF'
FROM prefecthq/prefect:2-python3.11

# Use Supabase PostgreSQL as backend
ENV PREFECT_API_DATABASE_CONNECTION_URL=${PREFECT_API_DATABASE_CONNECTION_URL}
ENV PREFECT_SERVER_API_HOST=0.0.0.0
ENV PREFECT_SERVER_API_PORT=4200

EXPOSE 4200

CMD ["prefect", "server", "start", "--host", "0.0.0.0"]
EOF

# Create fly.toml
cat > fly.toml <<'EOF'
app = "prefect"
primary_region = "ewr"

[build]
  dockerfile = "Dockerfile"

[env]
  PREFECT_SERVER_API_HOST = "0.0.0.0"
  PREFECT_SERVER_API_PORT = "4200"

[http_service]
  internal_port = 4200
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

  [[http_service.checks]]
    interval = "30s"
    timeout = "5s"
    grace_period = "60s"
    method = "GET"
    path = "/api/health"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256
EOF
```

2. **Configure Supabase Backend**

Prefect server needs a PostgreSQL database. Use your existing Supabase:

```bash
# Get connection string from Supabase dashboard
# Format: postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres

# Set as Fly secret
fly secrets set \
  PREFECT_API_DATABASE_CONNECTION_URL="postgresql://postgres:xxx@xxx.supabase.co:5432/postgres" \
  -a prefect
```

3. **Deploy Prefect Server**

```bash
fly deploy -a prefect
```

4. **Create Prefect API Key**

```bash
# SSH into the Prefect server
fly ssh console -a prefect

# Create API key
prefect cloud api-key create --name orchestrator-production

# Copy the generated key
```

5. **Update Orchestrator Configuration**

Add secrets to orchestrator:

```bash
fly secrets set \
  PREFECT_API_URL="https://prefect.fly.dev/api" \
  PREFECT_API_KEY="pnu_xxx..." \
  -a captionacc-orchestrator
```

6. **Update GitHub Secrets**

Add to repository secrets:
- `PREFECT_API_URL`: `https://prefect.fly.dev/api`
- `PREFECT_API_KEY`: The API key from step 4

7. **Redeploy Orchestrator**

```bash
# Trigger deployment
gh workflow run deploy-orchestrator.yml
```

8. **Verify Health Check**

```bash
# Should now show Prefect as "healthy"
curl https://captionacc-orchestrator.fly.dev/health | jq '.components.prefect'
```

9. **Add to Better Stack**

Create a new monitor in Better Stack:
- URL: `https://prefect.fly.dev/api/health`
- Check interval: 3 minutes

### Cost Estimate

**Prefect Server on Fly.io:**
- VM: shared-cpu-1x with 256MB RAM
- Storage: Supabase (existing, no extra cost)
- Estimated cost: **~$2/month**

**Alternative: Prefect Cloud Hobby Plan (Free)**
- Free tier: 5 deployments, 2 users, 7-day retention
- No self-hosting required
- Hosted at `https://app.prefect.cloud/`

### Migration Checklist

- [ ] Create `services/prefect-service/` directory
- [ ] Add Dockerfile and fly.toml
- [ ] Deploy Prefect server to Fly.io
- [ ] Configure Supabase connection string
- [ ] Create Prefect API key
- [ ] Update orchestrator secrets
- [ ] Update GitHub repository secrets
- [ ] Redeploy orchestrator
- [ ] Verify health checks
- [ ] Add Better Stack monitor
- [ ] Update documentation

### Rollback Plan

If issues occur:

1. **Remove Prefect credentials from orchestrator**:
   ```bash
   fly secrets unset PREFECT_API_URL PREFECT_API_KEY -a captionacc-orchestrator
   ```

2. **Orchestrator will fall back to ephemeral mode**
   - Health check shows Prefect as "not_configured"
   - Everything continues to work normally

3. **Debug Prefect server separately**
   - Check logs: `fly logs -a prefect`
   - Verify database connection
   - Ensure API key is valid

## Current Workaround: No Server Needed

Ephemeral mode works perfectly fine for production. You only need a separate server if you want:
- Web UI for monitoring
- Team collaboration features
- Persistent flow run history
- Asset lineage visualization

Until then, the current setup is production-ready and requires no additional infrastructure.

## Related Documentation

- [Health Checks](../../docs/HEALTH_CHECKS.md)
- [Orchestrator README](./README.md)
- [Prefect Server Docs](https://docs.prefect.io/latest/guides/host/)
