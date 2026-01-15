# Prefect Service with Integrated Traefik API Gateway

**Combined deployment**: Traefik API Gateway + Prefect Server on a single Fly.io machine.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  banchelabs-gateway.fly.dev (1GB Fly.io machine)               │
│                                                              │
│  ┌────────────────────────────────────────┐                 │
│  │ Traefik Gateway (supervisor process 1) │                 │
│  │ - Port 8080 (HTTP → HTTPS redirect)    │ ← Public        │
│  │ - Port 8443 (HTTPS)                    │ ← Public        │
│  │ - JWT authentication                   │                 │
│  │ - Routes:                               │                 │
│  │   /prefect/* → localhost:4200            │                 │
│  │   /captionacc/api/* → api.internal:8000 │ (future)       │
│  └────────────────┬───────────────────────┘                 │
│                   │ (localhost)                             │
│                   ▼                                          │
│  ┌────────────────────────────────────────┐                 │
│  │ Prefect Server (supervisor process 2)  │                 │
│  │ - Port 4200 (internal only)            │                 │
│  │ - Orchestration engine                 │                 │
│  │ - Web UI                                │                 │
│  └────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

## Why Combined?

### ✅ Benefits
- **Zero network latency**: Traefik → Prefect uses localhost
- **Simplified deployment**: One Fly.io app instead of two
- **Lower operational complexity**: Single service to monitor
- **Still routes to other services**: Can proxy to API, orchestrator, etc. on other machines
- **Cost effective**: ~$6/month for gateway + orchestration

### ✅ Still Generic
- Traefik can route to services on other Fly.io machines via internal DNS
- Gateway configuration is in `gateway/dynamic/*.yml` files
- Easy to add new routes for other projects or services

## Directory Structure

```
infrastructure/banchelabs-gateway/
├── Dockerfile.combined         # Multi-stage: Traefik + Prefect
├── supervisord.conf           # Process manager (runs both)
├── fly.toml                   # Fly.io deployment config
├── gateway/                   # Traefik configuration
│   ├── traefik.yml           # Static config
│   └── dynamic/
│       └── captionacc.yml    # CaptionA.cc routes
├── docker-compose.yml        # Local development (optional)
└── README.md                 # This file
```

## Deployment

### 1. Set Secrets

```bash
# Generate a strong JWT signing secret
SECRET=$(openssl rand -base64 32)

# Set Fly.io secrets
fly secrets set \
  TRAEFIK_JWT_SECRET="$SECRET" \
  PREFECT_API_DATABASE_CONNECTION_URL="your-supabase-postgres-url" \
  -a banchelabs-gateway
```

**Important**: Use the same `TRAEFIK_JWT_SECRET` in your Supabase Edge Function!

### 2. Deploy to Fly.io

```bash
cd infrastructure/banchelabs-gateway

# Deploy
fly deploy -a banchelabs-gateway

# Verify deployment
curl https://banchelabs-gateway.fly.dev/ping
# Should return: OK
```

### 3. Generate Service Tokens

Use the Supabase Edge Function to generate JWT tokens:

```bash
# Set environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"  # pragma: allowlist secret

# Generate tokens (use the helper script from api-gateway service)
python ../api-gateway/generate-token.py \
  --project captionacc \
  --service modal \
  --description "Modal GPU workers"

python ../api-gateway/generate-token.py \
  --project captionacc \
  --service api \
  --description "CaptionA.cc API service"
```

### 4. Use the Gateway

**Access Prefect via gateway:**
```bash
curl https://banchelabs-gateway.fly.dev/prefect/api/health \
  -H "Authorization: Bearer <your-jwt-token>"
```

**Client configuration:**
```bash
# For services that need to access Prefect
export PREFECT_API_URL="https://banchelabs-gateway.fly.dev/prefect/api"
export PREFECT_AUTH_TOKEN="<your-jwt-token>"
```

## Local Development

For local testing, you can use Docker Compose:

```bash
# Set environment variables
export TRAEFIK_JWT_SECRET="your-secret"  # pragma: allowlist secret
export PREFECT_API_DATABASE_CONNECTION_URL="sqlite+aiosqlite:////data/prefect.db"

# Start both services
docker-compose up

# Access locally
curl http://localhost:8080/api/health \
  -H "Authorization: Bearer <token>"
```

## Adding Routes to Other Services

To route to services on other Fly.io machines, edit `gateway/dynamic/captionacc.yml`:

```yaml
http:
  routers:
    # New route to API service (different machine)
    captionacc-api:
      rule: "PathPrefix(`/captionacc/api`)"
      service: captionacc-api-service
      middlewares:
        - captionacc-api-auth
        - captionacc-api-strip-prefix
      entryPoints:
        - websecure

  middlewares:
    captionacc-api-auth:
      plugin:
        jwt:
          Keys:
            - "{{env `TRAEFIK_JWT_SECRET`}}"
          Required: true
          PayloadFields: [exp, iat, jti, project, service]

    captionacc-api-strip-prefix:
      stripPrefix:
        prefixes: ["/captionacc/api"]

  services:
    # API service on different Fly.io machine
    captionacc-api-service:
      loadBalancer:
        servers:
          - url: "http://captionacc-api.internal:8000"  # Fly.io 6PN
```

Then redeploy:
```bash
fly deploy -a banchelabs-gateway
```

## Monitoring

### Health Check
```bash
curl https://banchelabs-gateway.fly.dev/ping
```

### Logs
```bash
# View combined logs (both Traefik and Prefect)
fly logs -a banchelabs-gateway

# Filter by service
fly logs -a banchelabs-gateway | grep traefik
fly logs -a banchelabs-gateway | grep prefect
```

### Metrics (Prometheus)
```bash
curl https://banchelabs-gateway.fly.dev/metrics
```

## Scaling

The combined service can still scale to zero when idle:

```toml
# In fly.toml
[http_service]
  min_machines_running = 0  # Scale to zero
  auto_stop_machines = true
  auto_start_machines = true
```

Prefect workers (API service) can wake this machine via HTTP requests.

## Resource Usage

Expected memory usage on 1GB machine:
- **Traefik**: ~150-200MB
- **Prefect**: ~300-500MB
- **System**: ~100MB
- **Total**: ~600-800MB (comfortable margin)

## Troubleshooting

### "Connection refused" to Prefect
- Check both processes are running: `fly ssh console -a banchelabs-gateway`
- Inside container: `supervisorctl status`
- Should see: `traefik RUNNING` and `prefect RUNNING`

### "401 Unauthorized"
- Verify JWT token is valid
- Check `TRAEFIK_JWT_SECRET` matches between Supabase and Fly.io
- Generate new token if needed

### "502 Bad Gateway"
- Prefect might be starting up (can take 30-60s on cold start)
- Check Prefect health: `curl http://localhost:4200/api/health` (from inside container)

### High memory usage
- Check `fly status -a banchelabs-gateway`
- Consider increasing to 2GB if needed: Edit `fly.toml` → `memory = "2048mb"`

## Cost

**Expected cost**: ~$6-7/month

- 1GB shared-cpu-1x: ~$6/month running 24/7
- With scale-to-zero: ~$3-4/month (if mostly idle)
- Egress: Minimal (internal Fly.io traffic is free)

## Extracting to Separate Services Later

If you need to separate Traefik and Prefect in the future:

1. Copy `gateway/` directory to new `services/api-gateway/`
2. Create new `api-gateway` Fly.io app
3. Update `gateway/dynamic/captionacc.yml` to use `http://banchelabs-gateway.internal:4200`
4. Deploy both separately
5. Update client URLs to point to new `api-gateway.fly.dev`

The configuration is designed to make this easy!

## Related Documentation

- **Supabase Edge Function**: `supabase/functions/generate-gateway-token/`
- **Supabase Migration**: `supabase/migrations/20260113000000_gateway_tokens.sql`
- **Token Generation Script**: `services/api-gateway/generate-token.py`
- **API Gateway Documentation**: `services/api-gateway/README.md` (standalone deployment)

## Security

- **JWT Authentication**: All routes require valid JWT token
- **Token Validation**: Local (no database round-trip, ~1ms overhead)
- **Token Audit**: All issued tokens logged in Supabase `gateway_tokens` table
- **HTTPS Only**: Force HTTPS enabled
- **Secrets Management**: Via Fly.io secrets (never in code)

## Support

For issues:
1. Check logs: `fly logs -a banchelabs-gateway`
2. Check process status: `fly ssh console -a banchelabs-gateway` → `supervisorctl status`
3. Verify secrets are set: `fly secrets list -a banchelabs-gateway`
4. Test gateway health: `curl https://banchelabs-gateway.fly.dev/ping`
