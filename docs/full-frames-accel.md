# GPU-Accelerated Full Frames Implementation Plan

## Overview
Create a GPU-accelerated version of the `full_frames` package that replaces FFmpeg with PyNvVideoCodec for video decoding. Uses existing OCR service infrastructure (`ocr_utils.OCRServiceAdapter`) for montage assembly and Google Vision API processing.

**Expected Performance Improvement:** 6-12x faster for frame extraction (30-60s → 5-10s)

**Note:** This is GPU-only. No CPU fallback or macOS LiveText support.

## Architecture: Shared Module Approach

### Create New Shared Package: `packages/gpu_video_utils/`

This package will contain GPU video processing primitives reusable by both `inference_pipelined` and `full_frames`:

```
packages/gpu_video_utils/
├── src/gpu_video_utils/
│   ├── __init__.py
│   ├── decoder.py          # PyNvVideoCodec wrapper
│   ├── frame_extraction.py # GPU frame extraction with precise timing
│   ├── montage.py          # Vertical montage assembly
│   └── tensor_utils.py     # DLPack/PyTorch conversion utilities
├── pyproject.toml
└── tests/
```

**Why separate package?**
- GPU operations require heavy dependencies (PyTorch, PyNvVideoCodec)
- Existing `video_utils` is CPU-only (FFmpeg), keep it lightweight
- Both `inference_pipelined` and `full_frames` can depend on this shared code
- Eliminates duplication of GPU decoder and frame extraction logic

### Update `data-pipelines/full_frames/`

Add GPU-specific modules alongside existing CPU implementation:

```
data-pipelines/full_frames/src/full_frames/
├── frames.py        # Existing CPU (FFmpeg) implementation
├── frames_gpu.py    # NEW: GPU-accelerated frame extraction
├── ocr.py           # Existing macOS LiveText OCR
├── ocr_service.py   # NEW: Google Vision API montage workflow
├── database.py      # Existing (unchanged)
└── cli.py           # Updated: add --gpu flag
```

## Implementation Steps

### Phase 1: Create Shared GPU Utilities Package

**File: `packages/gpu_video_utils/src/gpu_video_utils/decoder.py`**
- Implement `GPUVideoDecoder` class wrapping PyNvVideoCodec's `SimpleDecoder`
- Methods:
  - `get_frame_at_time(time_seconds: float) -> torch.Tensor` - Extract single frame on GPU
  - `get_frames_at_times(times: List[float]) -> List[torch.Tensor]` - Batch extraction
  - `get_video_info() -> Dict` - Video metadata (fps, duration, dimensions)
- Use precise timing from inference_pipelined: `native_frame_idx = round(target_time * native_fps)`

**File: `packages/gpu_video_utils/src/gpu_video_utils/frame_extraction.py`**
- Implement `extract_frames_gpu()`:
  - Extract frames at configurable rate (arbitrary Hz)
  - Support output formats: "tensor" (GPU), "pil" (CPU), "jpeg_bytes" (encoded)
  - Optional GPU cropping before CPU transfer
  - Progress callbacks
- Implement `extract_frames_for_montage()`:
  - Batch frames into montage-sized chunks
  - Automatically calculate max frames per montage based on 32000px height limit
  - Return batches ready for assembly

**File: `packages/gpu_video_utils/src/gpu_video_utils/montage.py`**
- Implement `calculate_montage_capacity()`:
  - Calculate max frames per montage considering ALL constraints:
    - Height limit: 50,000px
    - Total pixel limit: 50,000,000 pixels
    - File size limit: 15MB
    - Config limit: 950 frames
  - Return `min()` of all constraints (most restrictive)
  - Match logic from `services/ocr-service/app.py:calculate_capacity()`

**File: `packages/gpu_video_utils/pyproject.toml`**
- Dependencies: torch, nvidia-pynvvideocodec, pillow, numpy
- Python version: >=3.10

### Phase 2: Integrate GPU Extraction into full_frames

**File: `data-pipelines/full_frames/src/full_frames/frames_gpu.py`**
- Implement `extract_frames_gpu()`:
  - Drop-in replacement for `frames.extract_frames()`
  - Uses `GPUFrameExtractor` from gpu_video_utils
  - Saves frames to disk as `frame_NNNNNNNNNN.jpg` (same naming convention)
  - Maintains frame_index = time_in_seconds * 10 convention
- Implement `extract_frames_for_ocr_service()`:
  - Extract frames batched for Google Vision API
  - Returns `MontageBatch` objects ready for OCR processing
  - Each batch sized to fit within 32000px height limit

**File: `data-pipelines/full_frames/src/full_frames/ocr_service.py`**
- Implement `process_video_with_gpu_and_ocr_service()`:
  - End-to-end pipeline using existing `OCRServiceAdapter`:
    1. Extract frames on GPU and save to disk
    2. Use `OCRServiceAdapter.calculate_batch_size()` to determine optimal batch size
    3. Split frames into batches
    4. Use `OCRServiceAdapter.process_frames_batch()` to process each batch
       - This handles montage assembly, Google Vision API, and result distribution
    5. Write results to database
  - Progress reporting and error handling

**Note:** No need to implement montage assembly or Vision API integration - this already exists in `ocr_utils.OCRServiceAdapter` and `services/ocr-service/app.py`

**File: `data-pipelines/full_frames/src/full_frames/cli.py`**
- Simplify to GPU-only:
  - Remove CPU/FFmpeg path entirely
  - Use `process_video_with_gpu_and_ocr_service()` directly
  - No conditional flags needed - always use GPU + OCR service

### Phase 3: Refactor inference_pipelined (Code Deduplication)

**File: `data-pipelines/captionacc-modal/src/captionacc_modal/inference_pipelined.py`**
- Replace inline PyNvVideoCodec code with `GPUVideoDecoder` from gpu_video_utils
- Extract frame extraction logic to use `extract_frames_gpu()`
- Remove duplicated decoder initialization and frame timing logic
- Validate performance unchanged after refactoring

### Phase 4: Testing and Optimization

**GPU Requirements:**
- NVIDIA GPU with CUDA support
- PyTorch with CUDA
- PyNvVideoCodec installed

**Memory Optimizations:**
- Batch processing: Extract frames in montage-sized batches (200-400 frames based on dimensions)
- Stream processing: Process montages as extracted (don't load entire video into memory)
- GPU→CPU transfer: Only transfer when needed (JPEG encoding happens on CPU)
- Cleanup: Delete frames from memory after montage assembly

**OCR Service Integration:**
- Use `OCRServiceAdapter.calculate_batch_size(width, height)` to query `/capacity` endpoint
- This considers all constraints: height (50,000px), pixels (50M), file size (15MB), config (950 frames)
- Example capacities from testing:
  - 666×64 frames → 757 frames per montage
  - Larger frames → proportionally fewer
- Parallel processing: Submit multiple batches to OCR service concurrently

## Critical Files to Create/Modify

**New Files:**
1. `packages/gpu_video_utils/src/gpu_video_utils/decoder.py` - Core GPU decoder wrapper
2. `packages/gpu_video_utils/src/gpu_video_utils/frame_extraction.py` - Frame extraction logic
3. `packages/gpu_video_utils/src/gpu_video_utils/montage.py` - Montage capacity calculation (matching OCR service logic)
4. `packages/gpu_video_utils/pyproject.toml` - Package configuration
5. `data-pipelines/full_frames/src/full_frames/frames_gpu.py` - GPU extraction for full_frames
6. `data-pipelines/full_frames/src/full_frames/ocr_service.py` - Integration with OCRServiceAdapter

**Modified Files:**
7. `data-pipelines/full_frames/src/full_frames/cli.py` - Simplify to GPU-only
8. `data-pipelines/captionacc-modal/src/captionacc_modal/inference_pipelined.py` - Use shared GPU utils (Phase 3)

## Performance Expectations

**Current CPU Pipeline (FFmpeg + OCR service):**
- 60-minute video @ 0.1Hz = 360 frames
- FFmpeg extraction: ~30-60 seconds
- OCR service processing: ~10-20 seconds (batched)
- **Total: ~40-80 seconds**

**GPU Pipeline (PyNvVideoCodec + OCR service):**
- 60-minute video @ 0.1Hz = 360 frames
- GPU extraction: ~5-10 seconds (6-12x faster than FFmpeg)
- OCR service processing: ~10-20 seconds (same as before, batched)
- **Total: ~15-30 seconds (2-5x speedup overall)**

**Key Improvement:** Frame extraction is the bottleneck that GPU acceleration addresses. OCR service processing time remains the same since it already uses efficient batching.

## Verification Plan

**Unit Tests:**
- Test `GPUVideoDecoder` with sample videos (various codecs, resolutions)
- Test `extract_frames_gpu()` timing accuracy (verify frame_index mapping)
- Test montage assembly with different frame counts and dimensions
- Test montage height limit enforcement (32000px)

**Integration Tests:**
- Run full_frames with `--gpu --ocr-service` on test video
- Verify database output matches existing schema
- Compare OCR results quality (GPU vs CPU paths)
- Measure end-to-end performance improvement

**End-to-End Workflow:**
```bash
# GPU-accelerated extraction + OCR service (GPU-only, no flags needed)
python -m full_frames analyze video.mp4 --frame-rate 0.1

# Verify database contents
sqlite3 output/fullOCR.db "SELECT COUNT(*) FROM full_frame_ocr;"
sqlite3 output/fullOCR.db "SELECT COUNT(*) FROM full_frames;"

# Performance comparison (against old CPU implementation)
time python -m full_frames analyze video.mp4 --frame-rate 0.1
```

## Key Design Decisions

1. **Shared module approach**: Extract GPU utilities into reusable package to avoid duplication
2. **GPU-only**: No CPU fallback or macOS LiveText support (simplifies implementation)
3. **Reuse existing OCR infrastructure**: Use `OCRServiceAdapter` instead of reimplementing montage assembly
4. **Montage capacity**: Match OCR service logic with 4 constraints (height, pixels, file size, config)
5. **Output format compatibility**: GPU path produces same database schema as current implementation
6. **Progressive enhancement**: Start with GPU extraction, integrate with OCR service, then refactor inference_pipelined

## Success Criteria

- [ ] GPU extraction 6-12x faster than FFmpeg
- [ ] End-to-end pipeline 10-20x faster than CPU baseline
- [ ] Database output identical to CPU path (same schema, same data quality)
- [ ] Code reuse: inference_pipelined uses shared GPU utilities
- [ ] Configurable frame rate (arbitrary Hz)
- [ ] Memory efficient: stream processing, no full-video loading
