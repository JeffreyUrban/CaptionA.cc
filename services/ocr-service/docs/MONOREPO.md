# Monorepo Deployment Guide

This OCR service is part of a monorepo and has independent deployment.

## Architecture

```
project-root/
├── apps/
│   └── captionacc-web/          # Main web application
├── services/
│   └── ocr-service/             # This service (independent)
└── .github/
    └── workflows/
        ├── deploy-ocr-service.yml   # Deploys only when service changes
        └── deploy-web.yml            # Deploys only when web changes
```

## Key Principles

1. **Independent Deployment**: OCR service only deploys when its files change
2. **Path-based Triggers**: GitHub Actions uses path filters
3. **Separate Fly Apps**: Each service is a separate Fly.io app

## Setup

### 1. Create Fly.io App (One-time)

```bash
cd services/ocr-service

# Create app (don't deploy yet)
flyctl launch --no-deploy

# Set secrets
flyctl secrets set GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat /path/to/credentials.json)"
```

### 2. Configure GitHub Actions (One-time)

Add Fly.io token to GitHub secrets:

```bash
# Get your Fly.io token
flyctl auth token

# Add to GitHub:
# Settings → Secrets → Actions → New repository secret
# Name: FLY_API_TOKEN
# Value: <your token>
```

### 3. Deploy

**Automatic (recommended):**
```bash
# When you push changes to services/ocr-service/, GitHub Actions deploys automatically
git add services/ocr-service/
git commit -m "Update OCR service"
git push origin main
```

**Manual:**
```bash
cd services/ocr-service
flyctl deploy
```

## How It Works

### GitHub Actions Path Filter

The workflow only triggers when OCR service files change:

```yaml
on:
  push:
    paths:
      - 'services/ocr-service/**'
      - '.github/workflows/deploy-ocr-service.yml'
```

**Examples:**

| Change | OCR Deploys? | Web Deploys? |
|--------|--------------|--------------|
| `apps/captionacc-web/src/App.tsx` | ❌ No | ✅ Yes |
| `services/ocr-service/app.py` | ✅ Yes | ❌ No |
| `README.md` (root) | ❌ No | ❌ No |
| Both changed | ✅ Yes | ✅ Yes |

### Docker Context

The Dockerfile builds from the service directory context only:

```dockerfile
# .dockerignore ensures we only include service files
# Not the entire monorepo
```

## Development Workflow

### Local Development

```bash
cd services/ocr-service

# Run locally
python app.py

# Test
python test_service.py
```

### Making Changes

1. **Edit service files**
   ```bash
   vim services/ocr-service/app.py
   ```

2. **Test locally**
   ```bash
   cd services/ocr-service
   python test_service.py
   ```

3. **Commit and push**
   ```bash
   git add services/ocr-service/
   git commit -m "feat: improve OCR accuracy"
   git push origin main
   ```

4. **GitHub Actions deploys automatically**
   - Watch deployment: `Actions` tab on GitHub
   - Or deploy manually: `cd services/ocr-service && flyctl deploy`

### Updating Dependencies

```bash
cd services/ocr-service

# Add dependency
echo "new-package>=1.0.0" >> requirements.txt

# Commit (triggers deployment)
git add requirements.txt
git commit -m "deps: add new-package"
git push
```

## Multiple Services Pattern

If you add more services later:

```
services/
├── ocr-service/
│   ├── fly.toml            # App: ocr-service
│   └── app.py
├── video-processor/
│   ├── fly.toml            # App: video-processor
│   └── app.py
└── notification-service/
    ├── fly.toml            # App: notification-service
    └── app.py
```

Each service:
- Has its own `fly.toml` and Fly.io app
- Has its own GitHub Actions workflow with path filter
- Deploys independently

## Troubleshooting

### Service deploys when it shouldn't

Check GitHub Actions path filter:
```yaml
paths:
  - 'services/ocr-service/**'  # Should only match this service
```

### Can't deploy manually

```bash
cd services/ocr-service
flyctl auth login
flyctl deploy
```

### Need to redeploy without code changes

```bash
# Option 1: Manual deploy
cd services/ocr-service
flyctl deploy

# Option 2: Trigger GitHub Actions manually
# GitHub → Actions → Deploy OCR Service → Run workflow
```

## Best Practices

1. **Keep services independent**: Don't share code between services via imports
2. **Version APIs carefully**: OCR service API is a contract with other services
3. **Test before pushing**: Always test locally first
4. **Use semantic commits**: `feat:`, `fix:`, `deps:` for clear history
5. **Monitor deployments**: Check Fly.io dashboard after auto-deployments
