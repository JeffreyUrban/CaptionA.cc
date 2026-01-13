# Testing the Pipelined Implementation

## What We've Accomplished

✅ **Pipelined implementation created** (`inference_pipelined.py`)
- GPU-accelerated frame extraction (NVDEC + CUDA)
- Streaming inference (no disk I/O between extraction→inference)
- Parallel VP9 encoding (4 workers with optimized settings)
- Built-in performance instrumentation

✅ **Modal app updated** to use pipelined version
✅ **Test fixture uploaded** to Wasabi: `test-fixtures/videos/car-teardown-comparison-08.mp4` (55.5 MB)
✅ **Deployed to Modal**: https://modal.com/apps/jeffreyurban/main/deployed/captionacc-processing

## Testing the Pipelined Function

### Option 1: Manual Test via Modal Dashboard (Recommended)

1. **Open Modal Dashboard**: https://modal.com/apps/jeffreyurban/main/deployed/captionacc-processing

2. **Navigate to** `crop_and_infer_caption_frame_extents` function

3. **Click "Run"** and provide these parameters:
   ```json
   {
     "video_key": "test-fixtures/videos/car-teardown-comparison-08.mp4",
     "tenant_id": "test-tenant-001",
     "video_id": "test-video-001",
     "crop_region": {
       "crop_left": 0.0,
       "crop_top": 0.85,
       "crop_right": 1.0,
       "crop_bottom": 1.0
     },
     "frame_rate": 10.0,
     "encoder_workers": 4
   }
   ```

4. **Watch the logs** for real-time progress and performance metrics!

### Option 2: Call from Your Application

Once you integrate with your Prefect flows, the function will be called automatically:

```python
from captionacc_modal.app import crop_and_infer_caption_frame_extents
from captionacc_modal.models import CropRegion

result = crop_and_infer_caption_frame_extents.remote(
    video_key="test-fixtures/videos/car-teardown-comparison-08.mp4",
    tenant_id="your-tenant-id",
    video_id="your-video-id",
    crop_region=CropRegion(
        crop_left=0.0,
        crop_top=0.85,
        crop_right=1.0,
        crop_bottom=1.0,
    ),
    frame_rate=10.0,
    encoder_workers=4,
)
```

## What to Look For in the Logs

The pipelined implementation prints detailed performance metrics:

```
================================================================================
PERFORMANCE METRICS
================================================================================
Extraction:
  • Time: 45.2s
  • Frames: 5400
  • Throughput: 119.5 fps

Inference:
  • Time: 52.8s
  • Pairs: 5399
  • Throughput: 102.3 pairs/sec

Encoding:
  • Time: 68.4s
  • Chunks: 126
  • Throughput: 78.9 fps

Overlap Analysis:
  • Inference wait for extraction: 0.0s
  ✓ Encoding throughput is adequate (1.3x GPU pipeline time)
================================================================================
```

### Key Metrics to Watch:

1. **Extraction Throughput**: Should be 100-200 fps (GPU-accelerated)
2. **Inference Throughput**: Depends on model complexity
3. **Encoding Throughput**: With 4 workers, should be 40-80 fps
4. **Bottleneck Analysis**: The tool automatically tells you if encoding is the bottleneck

### If Encoding is the Bottleneck:

The metrics will show:
```
⚠️  BOTTLENECK: Encoding is 2.1x slower than GPU pipeline
   Consider offloading VP9 encoding to separate instances
```

**Solutions:**
1. Increase `encoder_workers` to 6 or 8
2. Implement encoding offload (separate CPU-only Modal functions)

## Expected Performance Gains

For the car-teardown video (55.5 MB, ~9 minutes at 10 Hz = 5,400 frames):

| Stage | Sequential | Pipelined | Speedup |
|-------|-----------|-----------|---------|
| Extraction | ~90s | ~45s (GPU) | 2x |
| Inference | ~100s | Overlapped | ∞ |
| Encoding | ~180s | ~70s (4x parallel) | 2.5x |
| **Total** | **~370s** | **~120-150s** | **2.5-3x** |

## Test Fixture Details

**Location**: `test-fixtures/videos/car-teardown-comparison-08.mp4`
**Size**: 55.5 MB
**Purpose**: Persistent test video for performance testing
**Notes**: This fixture will remain in Wasabi for future tests

## Next Steps After Testing

1. **Review Performance Metrics**: Check if GPU or encoding is the bottleneck
2. **Tune Workers**: Adjust `encoder_workers` based on results
3. **Compare Costs**: Modal A10G with faster processing vs. longer runs
4. **Integration**: Update Prefect flows to use pipelined implementation
5. **Monitor Production**: Watch for performance improvements in real workloads

## Cleanup

Test outputs are scoped to tenant IDs, so cleanup is automatic when testing through the app. The test fixture itself (`test-fixtures/videos/car-teardown-comparison-08.mp4`) is permanent and doesn't need cleanup.

## Troubleshooting

### "Model checkpoint not found"
Expected! The function will use mock predictions without the actual ML model. The pipelined architecture still runs and shows performance metrics.

### "layout.db not found"
Run `extract_frames_and_ocr` first to generate layout.db, or the function will use mock predictions.

### Encoding is slow
Increase `encoder_workers` from 4 to 6 or 8 to utilize more CPU cores.

## Questions?

Check the implementation: `inference_pipelined.py`
Or review the plan: `PIPELINED_IMPLEMENTATION.md`
