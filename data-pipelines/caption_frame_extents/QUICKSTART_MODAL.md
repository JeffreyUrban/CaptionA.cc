# Modal Inference Quick Start

## TL;DR

Get caption frame extents inference running on Modal in 5 steps:

```bash
cd data-pipelines/caption_frame_extents

# 1. Install and authenticate Modal
pip install modal
modal token new

# 2. Create secrets (use your actual credentials)
modal secret create wasabi-credentials \
  WASABI_ACCESS_KEY=your_key \
  WASABI_SECRET_KEY=your_secret \
  WASABI_BUCKET=caption-acc-prod \
  WASABI_REGION=us-east-1

modal secret create supabase-credentials \
  SUPABASE_URL=your_url \
  SUPABASE_SERVICE_ROLE_KEY=your_key \
  SUPABASE_SCHEMA=captionacc_production

# 3. Upload model checkpoint (131MB)
python scripts/upload_model_to_modal.py \
  --checkpoint ../../models/caption_frame_extents/fusion_lora_spatial_mrn0fkfd.pt \
  --model-version mrn0fkfd

# 4. Deploy inference service
modal deploy src/caption_frame_extents/inference/service.py

# 5. Test it!
modal run src/caption_frame_extents/inference/service.py::test_inference
```

## What's Deployed

After deployment, you'll have:

- **Function**: `run_caption_frame_extents_inference_batch`
  - GPU: A10G (24GB VRAM)
  - Cost: ~$1.10/hour (only when running)
  - Timeout: 1 hour max
  - Concurrency: 5 parallel max

- **Volume**: `caption-frame-extents-models`
  - Stores model checkpoint
  - Persists across deployments

- **Secrets**: Wasabi + Supabase credentials

## Cost Estimate

| Scenario | Processing Time | Cost |
|----------|-----------------|------|
| 1 minute video (600 frames) | ~6 seconds | $0.002 |
| 10 minute video (6k frames) | ~60 seconds | $0.018 |
| 60 minute video (36k frames) | ~6 minutes | $0.11 |
| 100 videos/month (60 min avg) | ~10 hours | ~$11 |

**Free tier**: Modal includes $30/month credits = ~27 hours of A10G

## Monitoring

```bash
# View logs
modal app logs caption-frame-extents-inference

# Check usage
modal usage

# List recent runs
modal app list-runs caption-frame-extents-inference
```

## Trigger Inference

Inference is triggered automatically when:
- A video completes VP9 encoding (after layout approval)

Or manually via Prefect:
```python
from services.orchestrator.flows.caption_frame_extents_inference import caption_frame_extents_inference_flow

result = caption_frame_extents_inference_flow(
    video_id="<uuid>",
    tenant_id="<uuid>",
    cropped_frames_version=1,
    model_version="mrn0fkfd",
    priority="high"
)
```

## Where Results Go

Results are stored as SQLite databases in Wasabi:
```
videos/{tenant_id}/{video_id}/caption_frame_extents/v1_model-mrn0fkfd_run-{uuid}.db
```

Each database contains:
- 25k-36k rows (one per frame pair)
- Forward + backward predictions
- Confidence scores and probabilities
- Processing metadata

Supabase tracks:
- Completed runs (fast lookup)
- Active jobs (monitoring)
- Rejections (alerting)

## Common Issues

**"Module not found"**: Ensure Modal image has all deps
**"Model not found"**: Re-upload checkpoint
**"Wasabi auth failed"**: Update secrets with valid credentials
**"Timeout"**: Increase `MODAL_CONFIG.timeout_seconds` in config.py

See [MODAL_SETUP.md](docs/MODAL_SETUP.md) for detailed troubleshooting.

## Next Steps

1. **Sign up for Modal**: https://modal.com/signup (free tier)
2. **Run setup script**: `./scripts/setup_modal.sh`
3. **Follow prompts** to authenticate and configure
4. **Upload a test video** using the web app
5. **Watch inference run** in Modal dashboard

That's it! The complete workflow is now automated.
