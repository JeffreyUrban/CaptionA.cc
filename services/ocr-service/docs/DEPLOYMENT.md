# Deployment Guide

## Deployment Options

Both Fly.io and Google Cloud Run support true scale-to-zero and work well for this service.

### Fly.io (Recommended if already using it)

**Advantages:**
- **Familiar platform**: Same as your websites
- **Unified management**: One platform for everything
- **True scale-to-zero**: $0 when idle
- **Simple deployment**: `flyctl deploy`

**Considerations:**
- Egress charges to GCP Vision API (minimal for most workloads)
- 60s default timeout (can increase to 300s)

### Google Cloud Run (Recommended if not on Fly.io)

**Advantages:**
- **Same network as Vision API**: Lower latency, no egress charges
- **High timeout limits**: Up to 3600s for large batches
- **Free tier**: 2M requests/month
- **Auto-scaling**: Handles traffic spikes automatically

**Considerations:**
- Another platform to manage if not already on GCP

### Prerequisites

```bash
# Install Google Cloud SDK
# https://cloud.google.com/sdk/docs/install

# Authenticate
gcloud auth login

# Set project
gcloud config set project YOUR_PROJECT_ID

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable vision.googleapis.com
```

### Deploy to Cloud Run

**Option 1: Automated script**
```bash
chmod +x deploy-cloudrun.sh
./deploy-cloudrun.sh
```

**Option 2: Manual deployment**
```bash
# Build and push
docker build -t gcr.io/YOUR_PROJECT_ID/ocr-service .
docker push gcr.io/YOUR_PROJECT_ID/ocr-service

# Deploy
gcloud run deploy ocr-service \
  --image gcr.io/YOUR_PROJECT_ID/ocr-service \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300s \
  --min-instances 0 \
  --max-instances 10
```

**Option 3: Cloud Build (CI/CD)**
```bash
# Submit build
gcloud builds submit --config cloudbuild.yaml

# Triggers automatic deployment on code changes
```

### Configuration

**Memory & CPU:**
- Default: 2Gi memory, 2 CPU
- For larger batches: Increase to 4Gi, 4 CPU
- Adjust based on usage patterns

**Scaling:**
- `min-instances: 0` - Scales to zero when idle (saves costs)
- `max-instances: 10` - Limits maximum concurrent instances
- `concurrency: 10` - Requests per instance

**Timeout:**
- Default: 300s (5 minutes)
- Max: 3600s (60 minutes)
- Adjust based on batch sizes

### Cost Estimation

**Cloud Run Pricing (us-central1):**
- CPU: $0.00002400/vCPU-second
- Memory: $0.00000250/GiB-second
- Requests: $0.40/million

**Example scenarios:**

**Light usage (100 batches/day):**
- 100 batches × 5s avg × 30 days = 15,000 CPU-seconds
- 2 vCPU × 15,000s × $0.000024 = $0.72/month
- 2Gi × 15,000s × $0.0000025 = $0.08/month
- **Total: ~$1/month**

**Heavy usage (1000 batches/day):**
- 1000 batches × 5s avg × 30 days = 150,000 CPU-seconds
- 2 vCPU × 150,000s × $0.000024 = $7.20/month
- 2Gi × 150,000s × $0.0000025 = $0.75/month
- **Total: ~$8/month**

**Free tier:** 2M requests, 360,000 vCPU-seconds, 180,000 GiB-seconds per month

### Authentication

**Public (development):**
```bash
--allow-unauthenticated
```

**Private (production):**
```bash
--no-allow-unauthenticated
```

Then use service account authentication:
```python
import google.auth.transport.requests
import google.oauth2.id_token

request = google.auth.transport.requests.Request()
token = google.oauth2.id_token.fetch_id_token(request, SERVICE_URL)

headers = {"Authorization": f"Bearer {token}"}
requests.post(SERVICE_URL, headers=headers, json=data)
```

### Monitoring

**View logs:**
```bash
gcloud run logs tail ocr-service --region us-central1
```

**Metrics:**
- Cloud Console → Cloud Run → ocr-service → Metrics
- View: Request count, latency, CPU/memory usage, instance count

## Deploy to Fly.io

**Prerequisites:**
```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
flyctl auth login
```

**Set Google Cloud credentials as secret:**
```bash
# Store credentials as Fly.io secret
flyctl secrets set GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat /path/to/credentials.json)"
```

**Deploy:**
```bash
# First time - creates app
flyctl launch --no-deploy

# Update fly.toml with the provided configuration

# Deploy
flyctl deploy

# View service URL
flyctl info
```

**Monitor:**
```bash
# View logs
flyctl logs

# Check status
flyctl status

# Scale manually if needed
flyctl scale count 2  # Set min instances
flyctl scale count 0  # Back to scale-to-zero
```

**Cost on Fly.io:**
- Free tier: 3 shared-cpu VMs
- Scale-to-zero: $0 when idle
- When running: ~$0.01/hour for shared-cpu-2x with 2GB RAM
- Typical monthly: $1-5 depending on usage

## Final Recommendation

**Use Fly.io** if you're already using it for your websites - the scale-to-zero works great, costs are comparable, and you get unified platform management.

**Use Cloud Run** if you need:
- Very large batch processing (>300s timeouts)
- Lowest possible latency to Vision API
- You're already heavily invested in GCP

Both platforms work well for this service!
