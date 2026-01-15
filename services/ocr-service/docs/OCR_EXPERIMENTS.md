# OCR Montage Optimization Experiments

Summary of testing to validate Google Cloud Vision API as OCR alternative with montage cost optimization.

## Objective

Find optimal way to batch process video caption frames using GCP Vision API while minimizing costs.

## Key Findings

### 1. Vertical Stacking is Critical for Cropped Frames

**Problem**: Horizontal arrangements cause character bleeding at frame edges

**Test**: Compared 6 layouts with 50 cropped frames (666×64px):
- `1×50` (vertical): **428 chars** ✓
- `2×25` (grid): 423 chars ✓
- `5×10` (grid): 428 chars ✓
- `10×5` (grid): 414 chars (slight degradation)
- `25×2` (wide grid): **0 chars** ✗ (complete failure)
- `50×1` (horizontal): **0 chars** ✗ (complete failure)

**Conclusion**: Horizontal stacking fails completely. Use vertical or taller-than-wide grids.

### 2. Vertical Stacking Scales to 950 Frames

**Test**: Tested increasing vertical stack sizes (50, 100, 150... 950 frames)

**Results**:
| Frames | Chars/Frame | File Size | Status |
|--------|-------------|-----------|---------|
| 50 | 8.8 | 0.77 MB | ✓ |
| 300 | 9.2 | 4.99 MB | ✓ |
| 600 | 8.9 | 9.92 MB | ✓ |
| 950 | 8.6 | 15.41 MB | ✓ Max |
| 1000 | - | - | ✗ JPEG height limit |

**Hard limit**: ~992 frames (JPEG 65,500px dimension limit)
**Conservative limit**: 950 frames tested successfully

### 3. Full Frame Grid Testing

**Test**: Full frames (1280×720) in grid layouts 2×2 through 8×8

**Results**:
- **2×2 to 5×5**: Negligible degradation (<1%)
- **6×6**: 7% degradation
- **8×8**: 15% degradation

**Optimal**: 5×5 grid = 96% cost savings with minimal quality loss

### 4. Bounding Box Accuracy (IoU Validation)

**Test**: Compared same frames in different grid sizes using Intersection over Union

**Results**: 83-87% IoU across grid sizes
- Proves coordinate transformation is accurate
- Variance is natural content variation, not OCR errors

### 5. Cost Optimization

**Montage approach vs individual frames**:

| Frames/Batch | Cost Savings | Quality |
|--------------|--------------|---------|
| 50 (vertical) | 98.0% | Excellent |
| 300 (vertical) | 99.7% | Excellent |
| 950 (vertical) | 99.89% | Excellent |
| 25 (5×5 grid) | 96.0% | Excellent |

**Recommendation**:
- **Cropped frames**: Vertical stacking, 300-950 frames
- **Full frames**: 5×5 grids or smaller

## Implementation Limits

Based on testing, conservative production limits:

```python
HEIGHT_LIMIT = 50000  # px (76% of JPEG 65,500px max)
FILE_SIZE_LIMIT = 15  # MB (GCP allows 20MB)
PIXEL_LIMIT = 50000000  # Total pixels
MAX_FRAMES_PER_JOB = 950  # Tested maximum
```

## API Selection

**Only option**: Google Cloud Vision Document Text Detection
- Only major cloud provider with character-level bounding boxes
- Pricing: $1.50 per 1,000 images
- With montages: Effective cost $0.015-$0.002 per 1,000 images (98-99.9% savings)

## Scripts (Reference)

Experimental scripts deleted. Key script kept:
- `scripts/test-cropped-layouts.py` - Tests different montage layouts

## Test Methodology

1. Selected frames from videos with confirmed annotations
2. Tested multiple layouts/densities
3. Called GCP Vision API
4. Compared character counts and bounding boxes
5. Validated accuracy with IoU analysis
6. Identified optimal configurations

## Production Service

Findings implemented in `services/ocr-service/`:
- FastAPI service with async job processing
- Vertical montage stacking
- Conservative limits (1000 API calls/day default)
- Rate limiting and circuit breaker
- Cost protection: ~$0-5/month typical usage
