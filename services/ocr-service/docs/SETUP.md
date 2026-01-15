# OCR Service Setup Guide

Complete setup guide for deploying the OCR service in the monorepo.

## Prerequisites

1. **Fly.io account**
   ```bash
   # Sign up at https://fly.io
   # Install flyctl
   curl -L https://fly.io/install.sh | sh

   # Login
   flyctl auth login
   ```

2. **Google Cloud credentials**
   - Enable Vision API in your GCP project
   - Create service account with Vision API access
   - Download JSON credentials

3. **GitHub repository access** (for auto-deployment)

## Initial Setup (One-time)

### 1. Create Fly.io App

```bash
cd services/ocr-service

# Launch app (but don't deploy yet)
./deploy.sh
# Or manually:
# flyctl launch --no-deploy

# Choose app name (e.g., "captionacc-ocr-service")
# Choose region (e.g., "ord" - Chicago)
```

This creates:
- Fly.io app
- `fly.toml` configuration

### 2. Set Google Cloud Credentials

```bash
# Set as Fly.io secret
flyctl secrets set GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat /path/to/your/gcp-credentials.json)"

# Verify
flyctl secrets list
```

### 3. Configure GitHub Actions (Optional but recommended)

For automatic deployment when service changes:

```bash
# Get your Fly.io API token
flyctl auth token

# Add to GitHub repository:
# Settings → Secrets and variables → Actions → New repository secret
# Name: FLY_API_TOKEN
# Value: <paste token>
```

### 4. First Deployment

```bash
# Deploy
./deploy.sh
# Or: flyctl deploy

# Verify
flyctl status
flyctl logs

# Test
curl https://your-app.fly.dev/
```

## Configuration

### fly.toml

Already configured with:
- Auto-scaling: 0-10 instances
- 2 CPUs, 2GB RAM
- Scale-to-zero enabled

To adjust:
```toml
[[vm]]
  cpus = 4        # Increase for large batches
  memory_mb = 4096

[http_service]
  min_machines_running = 0  # Scale to zero
```

### Environment Variables

Set via Fly.io secrets:

```bash
# Required
flyctl secrets set GOOGLE_APPLICATION_CREDENTIALS_JSON='...'

# Optional (defaults work for most cases)
flyctl secrets set HEIGHT_LIMIT=50000
flyctl secrets set FILE_SIZE_LIMIT_MB=15
```

## Testing

### Local Testing

```bash
cd services/ocr-service

# Install dependencies
pip install -r requirements.txt

# Set credentials locally
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json

# Run service
python app.py

# Test in another terminal
python test_service.py
```

### Production Testing

```bash
# Get app URL
APP_URL=$(flyctl info --json | jq -r '.Hostname')

# Health check
curl https://${APP_URL}/

# Check capacity
curl -X POST https://${APP_URL}/capacity \
  -H "Content-Type: application/json" \
  -d '{"width": 666, "height": 64}'
```

## Deployment Workflow

### Automatic (Recommended)

1. Make changes to service files
2. Commit and push to `main`
3. GitHub Actions deploys automatically
4. Monitor: `flyctl logs --app your-app-name`

**Triggers deployment:**
- Any file in `services/ocr-service/`
- `.github/workflows/deploy-ocr-service.yml`

**Does NOT trigger deployment:**
- Changes to `apps/captionacc-web/`
- Changes to other services
- README changes in root

### Manual

```bash
cd services/ocr-service

# Quick deploy
./deploy.sh

# Or with flyctl directly
flyctl deploy

# Force rebuild
flyctl deploy --no-cache
```

## Monitoring

### View Logs

```bash
# Tail logs
flyctl logs

# Filter by level
flyctl logs --filter error

# Last 100 lines
flyctl logs -n 100
```

### Check Metrics

```bash
# Status
flyctl status

# Resource usage
flyctl vm status

# Scaling status
flyctl scale show
```

### Fly.io Dashboard

Visit: https://fly.io/dashboard/your-app-name

View:
- Request metrics
- Resource usage
- Instance count (should be 0 when idle)
- Deployment history

## Scaling

### Auto-scaling (Default)

Already configured to scale 0-10 instances based on load.

### Manual Scaling

```bash
# Set minimum instances (useful for high-traffic periods)
flyctl scale count 2

# Back to auto-scaling
flyctl scale count 0

# Increase max instances
flyctl scale count --max 20
```

### Resource Scaling

```bash
# More CPU/memory for large batches
flyctl scale vm shared-cpu-4x --memory 4096

# Back to default
flyctl scale vm shared-cpu-2x --memory 2048
```

## Troubleshooting

### Deployment fails

```bash
# Check build logs
flyctl logs --app your-app-name

# Rebuild without cache
flyctl deploy --no-cache

# Check Dockerfile locally
docker build -t ocr-service .
docker run -p 8000:8000 ocr-service
```

### Service crashes

```bash
# View crash logs
flyctl logs --filter error

# Check recent restarts
flyctl vm status

# SSH into instance
flyctl ssh console
```

### Credentials not working

```bash
# Verify secret is set
flyctl secrets list

# Update secret
flyctl secrets set GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat /path/to/credentials.json)"

# Restart to pick up new secret
flyctl deploy --no-build
```

### Slow cold starts

Cold starts are normal when scaling from zero. To reduce:

```bash
# Keep 1 instance always running (costs ~$2/month)
flyctl scale count 1
```

Or increase VM size for faster startup:
```bash
flyctl scale vm performance-1x
```

## Cost Optimization

### Current Configuration

- **Idle**: $0 (scaled to zero)
- **Light usage** (100 batches/day): ~$1/month
- **Heavy usage** (1000 batches/day): ~$5/month

### Further Optimization

1. **Use smaller VM when possible**
   ```bash
   flyctl scale vm shared-cpu-1x --memory 1024
   ```

2. **Optimize batch sizes** (use `/capacity` endpoint)

3. **Monitor actual usage** and adjust resources

## Security

### API Authentication (Optional)

Currently public. To add authentication:

1. **Add API key validation** in app.py:
   ```python
   @app.middleware("http")
   async def verify_api_key(request: Request, call_next):
       api_key = request.headers.get("X-API-Key")
       if api_key != os.getenv("API_KEY"):
           return JSONResponse({"error": "Unauthorized"}, 401)
       return await call_next(request)
   ```

2. **Set API key**:
   ```bash
   flyctl secrets set API_KEY=your-secret-key
   ```

### Network Security

Restrict to specific origins:
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-app.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Maintenance

### Update Dependencies

```bash
cd services/ocr-service

# Update requirements.txt
vim requirements.txt

# Commit and push (triggers auto-deploy)
git add requirements.txt
git commit -m "deps: update packages"
git push
```

### Update Python Version

```bash
# Edit Dockerfile
vim Dockerfile
# Change: FROM python:3.11-slim
# To:     FROM python:3.12-slim

# Deploy
./deploy.sh
```

### Rollback

```bash
# List releases
flyctl releases

# Rollback to previous
flyctl releases rollback
```

## Support

- **Fly.io docs**: https://fly.io/docs/
- **Service logs**: `flyctl logs`
- **Community**: https://community.fly.io/

## Next Steps

1. ✅ Service deployed
2. ✅ Auto-scaling configured
3. ✅ Monitoring set up
4. 📝 Integrate with video processing pipeline
5. 📝 Add metrics/observability (optional)
6. 📝 Set up alerts (optional)
