# CaptionAcc Modal Tests

This directory contains tests for the captionacc-modal package, which provides Modal serverless functions for CaptionA.cc video processing with GPU-accelerated pipelined inference.

## Quick Start

```bash
# Install dependencies
cd data-pipelines/captionacc-modal
uv pip install -e ".[dev]"

# Run tests (short video, default batch_size=64)
pytest tests/integration/test_pipelined_inference.py --run-modal

# Run with full video for performance testing
pytest --run-modal --full-video --batch-size 128

# Verbose output with logs
pytest --run-modal -vv -s
```

## Architecture Highlights

The pipelined implementation provides:
- **GPU-accelerated frame extraction** (NVDEC + CUDA cropping)
- **Parallel VP9 encoding** (4+ workers with optimized settings)
- **Parallel Wasabi uploads** (chunks upload while encoding continues)
- **Configurable batch inference** (adjust GPU memory usage)
- **Built-in performance metrics** (automatic bottleneck detection)

Expected speedup: **2.5-3x** over sequential processing

## Test Structure

```
tests/
├── __init__.py
├── conftest.py                    # Pytest configuration and fixtures
├── README.md                      # This file
└── integration/
    ├── __init__.py
    └── test_pipelined_inference.py  # Integration test for pipelined implementation
```

## Prerequisites

### Required Services
- **Modal deployment**: The Modal app must be deployed with `crop_and_infer_caption_frame_extents` function
  - Deployment URL: https://modal.com/apps (check your deployed apps)
- **Wasabi credentials**: Must be configured in your environment (see services/api/.env)
- **Test fixtures**: Videos must exist in Wasabi at:
  - `test-fixtures/videos/short-test.mp4` (18s, ~184 frames) - Quick validation
  - `test-fixtures/videos/car-teardown-comparison-08.mp4` (55.5 MB, ~9 min at 10 Hz = 5,400 frames) - Performance testing

### Installation
```bash
# Install the package with dev dependencies
cd data-pipelines/captionacc-modal
uv pip install -e ".[dev]"
```

## Running Tests

### Basic Usage

Run all tests (will skip Modal tests by default):
```bash
pytest
```

Run integration tests that require Modal:
```bash
pytest --run-modal
```

### Test Customization

The pipelined inference test supports several command-line options:

**Use full-length video** (instead of short test video):
```bash
pytest --run-modal --full-video
```

**Custom batch size** (default: 64):
```bash
pytest --run-modal --batch-size 32
```

**Combine options**:
```bash
pytest --run-modal --full-video --batch-size 16
```

### Running Specific Tests

Run only integration tests:
```bash
pytest tests/integration/
```

Run a specific test file:
```bash
pytest tests/integration/test_pipelined_inference.py --run-modal
```

Run a specific test function:
```bash
pytest tests/integration/test_pipelined_inference.py::test_pipelined_crop_and_infer --run-modal
```

## Test Markers

Tests are organized using pytest markers:

- `@pytest.mark.modal`: Tests that require Modal deployment and Wasabi
- `@pytest.mark.integration`: Integration tests that may be slower or require external services

### Skip Modal Tests
```bash
# Run all tests except Modal tests
pytest -m "not modal"
```

### Run Only Integration Tests
```bash
pytest -m "integration"
```

## Test Output

The pipelined inference test provides detailed output including:
- Configuration (video, batch size, tenant/video IDs)
- Modal function execution progress
- Performance metrics (throughput, processing duration)
- Validation results
- Label counts and database keys

Example test output:
```
================================================================================
PIPELINED IMPLEMENTATION INTEGRATION TEST
================================================================================
Configuration:
  Video: short-test.mp4
  Batch size: 64
  Tenant ID: 550e8400-e29b-41d4-a716-446655440000
  Video ID: 6ba7b810-9dad-11d1-80b4-00c04fd430c8
================================================================================

Spawning Modal function call...
Parameters: frame_rate=10.0, encoder_workers=4, inference_batch_size=64

Waiting for completion...
(Check Modal dashboard for live progress)

================================================================================
VALIDATION
================================================================================

✓ All validations passed!

Results:
  • Version: 1
  • Frame count: 184
  • Label counts: {'same': 150, 'different': 20, 'empty_empty': 10, ...}
  • Processing duration: 45.23s
  • Cropped frames prefix: .../cropped_frames_v1/
  • Caption frame extents DB: .../caption_frame_extents.db

Overall throughput: 4.1 frames/second

================================================================================
TEST COMPLETE
================================================================================
```

## Performance Metrics

The Modal function logs include detailed performance metrics. Check the Modal dashboard logs for:

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

### Key Metrics to Monitor

1. **Extraction Throughput**: Should be 100-200 fps (GPU-accelerated NVDEC)
2. **Inference Throughput**: Depends on model complexity and batch size
3. **Encoding Throughput**: With 4 workers, should be 40-80 fps
4. **Overlap Analysis**: Tool automatically identifies bottlenecks

### Bottleneck Detection

If encoding is the bottleneck, metrics will show:
```
⚠️  BOTTLENECK: Encoding is 2.1x slower than GPU pipeline
   Consider offloading VP9 encoding to separate instances
```

**Solutions:**
- Increase `encoder_workers` to 6 or 8
- Adjust `--batch-size` for better GPU utilization
- Consider separate CPU-only Modal functions for encoding

## Debugging

### Verbose Output
```bash
pytest --run-modal -vv
```

### Show Print Statements
```bash
pytest --run-modal -s
```

### Stop on First Failure
```bash
pytest --run-modal -x
```

### Run with PDB on Failure
```bash
pytest --run-modal --pdb
```

## CI/CD Integration

For continuous integration, you can:

1. **Skip Modal tests in CI** (if Modal isn't available):
   ```bash
   pytest -m "not modal"
   ```

2. **Run Modal tests in CI** (if credentials are configured):
   ```bash
   pytest --run-modal --batch-size 64
   ```

## Troubleshooting

### Common Issues

**"Modal function not found"**
- Ensure the Modal app is deployed: `modal deploy data-pipelines/captionacc-modal/src/captionacc_modal/app.py`
- Check deployment at: https://modal.com/apps

**"Test fixture video not found"**
- Verify test fixtures exist in Wasabi:
  - `test-fixtures/videos/short-test.mp4`
  - `test-fixtures/videos/car-teardown-comparison-08.mp4`
- Upload fixtures if missing (see `TESTING_GUIDE.md` for instructions)

**"Wasabi credentials not configured"**
- Check `services/api/.env` has valid credentials:
  - `WASABI_ACCESS_KEY`
  - `WASABI_SECRET_KEY`
  - `WASABI_BUCKET`
  - `WASABI_REGION`

**Encoding is slow**
- Increase encoder workers: `pytest --run-modal --batch-size 64`
- Default is 4 workers; try 6-8 for faster encoding
- Check Modal dashboard metrics for bottleneck analysis

**GPU out of memory**
- Reduce batch size: `pytest --run-modal --batch-size 16`
- Default is 64; adjust based on GPU memory (A10G has 24GB)

## Cleanup

Tests automatically clean up Wasabi resources in the teardown fixture. This includes:
- All video chunks created during the test
- The caption frame extents database
- Layout.db files
- All files under the test tenant ID prefix

**Manual Cleanup** (if test is interrupted):
1. Find the test tenant ID in the test output
2. Delete all files with that prefix in Wasabi
3. Test fixtures (`test-fixtures/`) are permanent and should not be deleted

## Adding New Tests

1. Create test file in appropriate directory (e.g., `tests/integration/test_new_feature.py`)
2. Add appropriate markers (`@pytest.mark.modal`, `@pytest.mark.integration`)
3. Use fixtures from `conftest.py` for common setup
4. Add documentation to this README

## Alternative Testing Methods

### Manual Testing via Modal Dashboard

For quick manual testing or debugging:

1. **Open Modal Dashboard**: https://modal.com/apps → your app → `crop_and_infer_caption_frame_extents`
2. **Click "Run"** and provide parameters:
   ```json
   {
     "video_key": "test-fixtures/videos/short-test.mp4",
     "tenant_id": "test-tenant-manual",
     "video_id": "test-video-manual",
     "crop_region": {
       "crop_left": 0.1859398879,
       "crop_top": 0.8705440901,
       "crop_right": 0.8155883851,
       "crop_bottom": 0.9455909944
     },
     "frame_rate": 10.0,
     "encoder_workers": 4,
     "inference_batch_size": 32
   }
   ```
3. **Watch logs** for real-time performance metrics

### Legacy Test Script

The standalone `test_pipelined.py` script at the root is deprecated but still functional:

```bash
# Old way (deprecated)
python test_pipelined.py --full --batch-size 32

# New way (recommended)
pytest --run-modal --full-video --batch-size 32
```

The script will show a deprecation warning but continue to work for backward compatibility.
