# OCR Service - Quick Start

## Initial Setup (5 minutes)

```bash
cd services/ocr-service

# 1. Create Fly.io app
./deploy.sh

# 2. Set Google Cloud credentials
flyctl secrets set GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat /path/to/gcp-credentials.json)"

# 3. Done! Service is live
flyctl info
```

## Daily Usage

### Deploy Changes

**Automatic** (recommended):
```bash
git add services/ocr-service/
git commit -m "feat: your change"
git push  # Auto-deploys via GitHub Actions
```

**Manual**:
```bash
cd services/ocr-service
./deploy.sh
```

### Check Status

```bash
flyctl status          # Service status
flyctl logs           # View logs
flyctl scale show     # Current instances (should be 0 when idle)
```

### Test Locally

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
python app.py                    # Start service
python test_service.py          # Run tests
```

## API Usage

```python
from client_example import OCRServiceClient

client = OCRServiceClient("https://your-app.fly.dev")

# Check capacity for your images
capacity = client.get_capacity(width=666, height=64)
print(f"Max batch size: {capacity['max_images']}")

# Process batch
results = client.process_batch(images)
for result in results['results']:
    print(f"{result['id']}: {result['char_count']} chars")
```

## Common Tasks

| Task | Command |
|------|---------|
| Deploy | `./deploy.sh` |
| View logs | `flyctl logs` |
| Check cost | `flyctl billing` |
| Scale up | `flyctl scale count 2` |
| Scale to zero | `flyctl scale count 0` |
| Rollback | `flyctl releases rollback` |

## Important Files

- `app.py` - Main service code
- `fly.toml` - Fly.io configuration
- `SETUP.md` - Detailed setup guide
- `MONOREPO.md` - Monorepo deployment workflow
- `DEPLOYMENT.md` - Deployment options

## Monorepo Behavior

✅ Deploys when changed:
- `services/ocr-service/**`
- `.github/workflows/deploy-ocr-service.yml`

❌ Does NOT deploy when:
- `apps/captionacc-web/**` changes
- Root README changes
- Other services change

## Support

- Logs: `flyctl logs`
- Status: https://fly.io/dashboard/your-app-name
- Docs: [SETUP.md](SETUP.md)
