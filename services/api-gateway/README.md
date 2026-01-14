# API Gateway Service

A generic, multi-project Traefik-based API gateway with JWT authentication. This service is designed to be easily extracted from this monorepo and reused across multiple projects.

## Deployment Options

### ⭐ Option 1: Combined with Prefect (Recommended)
The gateway is deployed **alongside Prefect** on the same Fly.io machine for optimal performance and simplicity.

📁 **Location**: `services/prefect-service/`
📖 **Documentation**: See `services/prefect-service/README.md`

**Benefits**:
- Zero network latency (localhost routing to Prefect)
- Simpler deployment (one service)
- Lower operational complexity
- Still routes to other services on different machines

### Option 2: Standalone Gateway
Deploy the gateway as a **separate service** for maximum flexibility.

📁 **Location**: `services/api-gateway/` (this directory)
📖 **Documentation**: Continue reading below

**Benefits**:
- Independent scaling
- Maximum flexibility for multi-backend scenarios
- Clean separation of concerns

---

## Overview (Standalone Deployment)

This gateway provides:
- **JWT-based authentication** (validated locally, zero latency)
- **Multi-project routing** (route different projects to different backends)
- **Production-ready features** (health checks, metrics, access logs, HTTPS)
- **Easy to extract** (minimal dependencies, generic naming)

## Architecture

```
Client Services → API Gateway (Traefik) → Backend Services
                     ↓
              JWT Validation (local)
              No external calls
```

## Directory Structure

```
services/api-gateway/
├── traefik.yml              # Static configuration (entrypoints, logging, metrics)
├── dynamic/                 # Dynamic configurations per project
│   └── captionacc.yml      # CaptionA.cc routing rules
├── Dockerfile              # Traefik image with configs
├── fly.toml                # Fly.io deployment config
└── README.md               # This file
```

## Routing Scheme

Routes are prefixed by project name to allow multi-tenancy:

- `/captionacc/prefect/*` → `prefect-service.internal:4200`
- `/captionacc/api/*` → `captionacc-api.internal:8000` (future)
- `/otherproject/service/*` → `...` (future)

## JWT Token Format

Tokens contain these claims:
```json
{
  "jti": "unique-token-id",
  "project": "captionacc",
  "service": "prefect",
  "iat": 1234567890,
  "exp": 1234567890
}
```

**Accepted services for CaptionA.cc:**
- `prefect` - Prefect orchestration server
- `api` - CaptionA.cc API service
- `orchestrator` - Orchestrator service
- `modal` - Modal GPU workers
- `web` - Web application

## Setup

### 1. Set Fly.io Secrets

```bash
# JWT signing secret (generate a strong random secret)
fly secrets set GATEWAY_JWT_SECRET="your-secure-random-secret" -a api-gateway  # pragma: allowlist secret
```

### 2. Deploy to Fly.io

```bash
cd services/api-gateway
fly deploy
```

### 3. Generate Tokens

Use the Supabase Edge Function to generate tokens:

```bash
curl -X POST https://your-project.supabase.co/functions/v1/generate-gateway-token \
  -H "Authorization: Bearer YOUR_SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "project": "captionacc",
    "service": "modal",
    "description": "Modal GPU workers token",
    "expiresInDays": 90
  }'
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "jti": "uuid",
  "expiresAt": "2026-04-13T00:00:00Z",
  "project": "captionacc",
  "service": "modal"
}
```

### 4. Use Tokens

Clients send the token in the Authorization header:

```bash
curl https://api-gateway.fly.dev/captionacc/prefect/api/health \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

## Adding New Projects

To add a new project, create a new dynamic configuration file:

```yaml
# services/api-gateway/dynamic/newproject.yml
http:
  routers:
    newproject-service:
      rule: "PathPrefix(`/newproject/api`)"
      service: newproject-backend
      middlewares:
        - newproject-auth
        - newproject-strip-prefix
      entryPoints:
        - websecure

  middlewares:
    newproject-auth:
      plugin:
        jwt:
          signingSecret: "{{env `GATEWAY_JWT_SECRET`}}"
          customClaims:
            project:
              - newproject

    newproject-strip-prefix:
      stripPrefix:
        prefixes:
          - "/newproject/api"

  services:
    newproject-backend:
      loadBalancer:
        servers:
          - url: "http://newproject-service.internal:8000"
```

Then redeploy:
```bash
fly deploy -a api-gateway
```

## Monitoring

### Health Check
```bash
curl https://api-gateway.fly.dev/ping
```

### Metrics (Prometheus format)
```bash
curl https://api-gateway.fly.dev/metrics
```

### Access Logs
View logs via Fly.io:
```bash
fly logs -a api-gateway
```

## Token Management

### Generate Token
See "Setup" section above.

### Revoke Token
```sql
-- In Supabase SQL editor
SELECT revoke_gateway_token(
  'jwt-id-here',
  'admin-username',
  'Token compromised'
);
```

### List Active Tokens
```sql
SELECT project, service, description, created_at, expires_at
FROM gateway_tokens
WHERE is_active = true
ORDER BY created_at DESC;
```

### Cleanup Expired Tokens
```sql
SELECT cleanup_expired_revocations();
```

## Extracting to Separate Repo

This service is designed to be easily extracted:

1. **Copy directory:**
   ```bash
   cp -r services/api-gateway /path/to/new/repo/
   ```

2. **Update Fly app name:**
   Edit `fly.toml` and change `app = "api-gateway"` to your new name.

3. **Update dynamic configs:**
   Keep project-specific configs in `dynamic/` or remove them.

4. **Deploy:**
   ```bash
   fly launch # Create new app
   fly secrets set GATEWAY_JWT_SECRET="..." -a your-new-app
   fly deploy
   ```

5. **Dependencies:**
   - Supabase Edge Function: `supabase/functions/generate-gateway-token/`
   - Supabase Shared Utils: `supabase/functions/_shared/jwt.ts`
   - Supabase Migration: `supabase/migrations/20260113000000_gateway_tokens.sql`

## Security Considerations

- **Signing Secret**: Use a strong, random secret (32+ characters)
- **Token Expiration**: Default 90 days, maximum 365 days
- **Token Rotation**: Regularly rotate tokens and update clients
- **Revocation**: Use `revoke_gateway_token()` for immediate revocation
- **HTTPS Only**: Gateway forces HTTPS for all traffic
- **Audit Logging**: All token generation logged in `gateway_tokens` table

## Performance

- **Zero-latency auth**: JWT validated locally (no database lookup)
- **~1ms overhead**: Signature validation is fast
- **Scales infinitely**: No external dependencies during request handling
- **Metrics built-in**: Prometheus metrics for monitoring

## Troubleshooting

### "Invalid signature"
- Verify `GATEWAY_JWT_SECRET` matches between token generation and Traefik
- Check token hasn't expired

### "Route not found"
- Verify path prefix matches dynamic config
- Check Traefik logs: `fly logs -a api-gateway`

### "Backend unreachable"
- Verify backend service name resolves (e.g., `prefect-service.internal`)
- Check Fly.io 6PN networking is enabled
- Verify backend service is running

## Related Files

### Supabase Edge Function
- `supabase/functions/generate-gateway-token/index.ts`
- `supabase/functions/_shared/jwt.ts`

### Supabase Migration
- `supabase/migrations/20260113000000_gateway_tokens.sql`

### Client Configuration
See project-specific documentation for updating services to use the gateway.
