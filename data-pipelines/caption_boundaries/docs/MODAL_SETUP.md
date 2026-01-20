# Modal Setup Guide for Boundary Inference

Complete guide to deploying the boundary inference service on Modal.

## Prerequisites

- Python 3.11+
- Modal account (free tier available)
- Trained model checkpoint from W&B run `mrn0fkfd`
- Wasabi and Supabase credentials

## Step 1: Create Modal Account

1. **Sign up**: https://modal.com/signup
2. **Choose plan**: Free tier includes $30/month credits (enough for ~27 hours of A10G GPU)
3. **Verify email** and complete onboarding

## Step 2: Install Modal CLI

```bash
# Install Modal CLI globally
pip install modal

# Or with uv (in this project)
cd data-pipelines/caption_boundaries
uv pip install modal

# Verify installation
modal --version
```

## Step 3: Authenticate Modal CLI

```bash
# This will open a browser to authenticate
modal token new

# Verify authentication
modal token show
```

Expected output:
```
Token ID: tok_...
Workspace: your-workspace
Environment: main
```

## Step 4: Create Modal Secrets

Modal uses secrets to securely store credentials. Create these in the Modal dashboard or CLI:

### 4a. Wasabi Credentials

```bash
modal secret create wasabi-credentials \
  WASABI_ACCESS_KEY=your_access_key \
  WASABI_SECRET_KEY=your_secret_key \
  WASABI_BUCKET=captionacc-prod \
  WASABI_REGION=us-east-1 \
  WASABI_ENDPOINT=https://s3.us-east-1.wasabisys.com
```

### 4b. Supabase Credentials

```bash
modal secret create supabase-credentials \
  SUPABASE_URL=your_supabase_url \
  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
  SUPABASE_SCHEMA=captionacc_production
```

**Verify secrets:**
```bash
modal secret list
```

## Step 5: Create Model Volume

Modal volumes persist data across container restarts. We'll store the model checkpoint here.

```bash
# Create volume (this happens automatically on first deploy, but you can pre-create it)
modal volume create boundary-models
```

## Step 6: Upload Model Checkpoint

The model checkpoint needs to be uploaded to the Modal volume.

### Option A: Upload from Local File

```bash
cd data-pipelines/caption_boundaries

# Upload model checkpoint
python scripts/upload_model_to_modal.py \
  --checkpoint local/models/caption_boundaries/fusion_lora_spatial_mrn0fkfd.pt \
  --model-version mrn0fkfd
```

### Option B: Download from W&B and Upload

```bash
# First, download from W&B
wandb artifact get jeffreyurban-msai-deeplearning/caption-boundary-detection/model-mrn0fkfd:latest \
  --root local/models/caption_boundaries/

# Then upload to Modal
python scripts/upload_model_to_modal.py \
  --checkpoint local/models/caption_boundaries/fusion_lora_spatial_mrn0fkfd.pt \
  --model-version mrn0fkfd
```

**Verify upload:**
```bash
modal volume ls boundary-models
```

Expected output:
```
checkpoints/
  mrn0fkfd_<hash>.pt
```

## Step 7: Deploy Inference Service

```bash
cd data-pipelines/caption_boundaries

# Deploy to Modal
modal deploy src/caption_boundaries/inference/service.py
```

This will:
1. Build the Docker image with all dependencies
2. Deploy the function to Modal
3. Make it available for remote invocation

**Expected output:**
```
✓ Initialized. View run at https://modal.com/...
✓ Created objects.
├── 🔨 Created mount /Users/.../caption_boundaries/src/caption_boundaries
├── 🔨 Created image boundary-inference-image
└── 🔨 Created function run_boundary_inference_batch
✓ App deployed! 🎉

View Deployment: https://modal.com/apps/your-workspace/boundary-inference
```

## Step 8: Test Inference Service

### 8a. Test with Modal CLI

```bash
# Test the deployed function
modal run src/caption_boundaries/inference/service.py::test_inference
```

Expected output:
```
GPU: Tesla A10G (24GB VRAM)
PyTorch CUDA: Available
Cold start time: ~3-5s
```

### 8b. Test Full Inference (from Prefect)

```bash
cd services/orchestrator

# Test boundary inference flow
uv run python << 'EOF'
from flows.boundary_inference import boundary_inference_flow

# Test with a video (this will be created in the next step)
result = boundary_inference_flow(
    video_id="test-video-uuid",
    tenant_id="test-tenant-uuid",
    cropped_frames_version=1,
    model_version="mrn0fkfd",
    priority="high",
    skip_if_exists=False
)

print(f"Status: {result['status']}")
if result['status'] == 'success':
    print(f"Run ID: {result['run_id']}")
    print(f"Storage: {result['storage_key']}")
    print(f"Pairs: {result['successful']}/{result['total_pairs']}")
EOF
```

## Step 9: Monitor & Debug

### View Logs

```bash
# Real-time logs
modal app logs boundary-inference

# Function-specific logs
modal app logs boundary-inference --function run_boundary_inference_batch
```

### Dashboard

Visit Modal dashboard: https://modal.com/apps

You can see:
- Function invocations
- Execution time and cost
- GPU utilization
- Error logs

### Debug Failed Jobs

```bash
# List recent runs
modal app list-runs boundary-inference

# Get logs for specific run
modal app logs boundary-inference --run-id <run-id>
```

## Cost Monitoring

### Set Spending Limits

```bash
# Set monthly spending cap (via dashboard or CLI)
modal config set-spending-limit 100  # $100/month

# Set budget alerts
modal config set-budget-alert 50    # Alert at $50/month
modal config set-budget-alert 75    # Alert at $75/month
```

### Monitor Usage

```bash
# View current month usage
modal usage

# Detailed breakdown
modal usage --detailed
```

**Expected costs:**
- A10G GPU: $1.10/hour
- Typical video (60 min, 36k frames): ~$0.08-0.10
- 100 videos/month: ~$10-15/month

## Troubleshooting

### Issue: "Module not found" errors

**Solution**: Ensure all dependencies are in `pyproject.toml` and the Modal image includes them:

```python
# In service.py
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        "torchvision",
        # ... all required packages
    )
)
```

### Issue: Model checkpoint not found

**Solution**: Verify volume mount and checkpoint path:

```bash
# Check volume contents
modal volume ls boundary-models

# Re-upload if needed
python scripts/upload_model_to_modal.py --checkpoint <path>
```

### Issue: Wasabi authentication failed

**Solution**: Update secrets:

```bash
# Delete old secret
modal secret delete wasabi-credentials

# Create new secret with updated credentials
modal secret create wasabi-credentials WASABI_ACCESS_KEY=... WASABI_SECRET_KEY=...
```

### Issue: Out of memory on GPU

**Solution**: Reduce batch size in `config.py`:

```python
MODAL_CONFIG.inference_batch_size = 32  # Down from 64
```

### Issue: Timeout errors

**Solution**: Increase timeout in `config.py`:

```python
MODAL_CONFIG.timeout_seconds = 7200  # 2 hours instead of 1
```

## Production Checklist

Before going live:

- [ ] Set spending limits in Modal dashboard
- [ ] Configure budget alerts ($25, $50, $75)
- [ ] Test with multiple videos of different lengths
- [ ] Verify Supabase rejection logging works
- [ ] Set up monitoring alerts (Prefect + Modal)
- [ ] Document model version and checkpoint hash
- [ ] Test failure scenarios (bad video, network error, etc.)
- [ ] Verify cleanup (no orphaned containers)
- [ ] Load test with concurrent jobs
- [ ] Review Modal logs for errors

## Updating the Service

When you need to update the inference service:

```bash
# 1. Make code changes
# 2. Deploy new version
modal deploy src/caption_boundaries/inference/service.py

# 3. Test new version
modal run src/caption_boundaries/inference/service.py::test_inference

# 4. If needed, upload new model checkpoint
python scripts/upload_model_to_modal.py --checkpoint <new_checkpoint>
```

## Next Steps

Once Modal is set up:
1. Upload a test video using the web app
2. Verify cropped frames are created in Wasabi
3. Trigger boundary inference (auto or manual)
4. Check results in Wasabi and Supabase
5. Monitor costs and performance

## Support

- Modal Documentation: https://modal.com/docs
- Modal Discord: https://discord.gg/modal
- Modal Support: support@modal.com

## Cost Calculator

Use this to estimate costs:

```
Video length (minutes) × 10 fps = frames
Frames - 1 = frame pairs
Processing time = pairs / 100 pairs/sec
Cost = (processing time / 3600) × $1.10/hr

Example:
60 min × 10 fps = 36,000 frames
35,999 pairs / 100 = 360 seconds
360s / 3600 × $1.10 = $0.11
```
