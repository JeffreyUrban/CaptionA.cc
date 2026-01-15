# crop_frames

Extract and process video frames with cropping and optional resizing.

## Overview

This pipeline provides tools for extracting frames from videos with cropping and optional resizing for downstream processing (e.g., OCR, model training).

**Key Features:**
- Extract frames with FFmpeg-based cropping at specified frame rate
- Optional integrated resizing with high-quality LANCZOS resampling
- Parallel processing for efficient throughput
- Progress tracking with rich progress bars
- Generic interface - works with any video and crop coordinates

## Installation

```bash
cd data-pipelines/crop_frames
uv pip install -e .
```

## Prerequisites

- FFmpeg installed (for frame extraction)
- Shared packages: `video_utils`, `image_utils`

## Commands

### extract-frames

Extract frames from video with cropping and optional resizing.

```bash
crop_frames extract-frames <video_path> <output_dir> --crop "left,top,right,bottom"
```

**Required Arguments:**
- `video_path`: Path to video file
- `output_dir`: Output directory for frames
- `--crop`, `-c`: Crop bounds as 'left,top,right,bottom' in pixels (e.g., "100,200,700,250")

**Optional Arguments:**
- `--rate`, `-r`: Frame sampling rate in Hz (default: 10.0)
- `--resize-width`: Resize extracted frames to this width (requires --resize-height)
- `--resize-height`: Resize extracted frames to this height (requires --resize-width)
- `--preserve-aspect/--stretch`: Preserve aspect ratio when resizing (default: stretch)

**Examples:**

```bash
# Extract frames only (no resizing)
crop_frames extract-frames video.mp4 ./frames \
  --crop "100,200,700,250"

# Extract and resize in one pass
crop_frames extract-frames video.mp4 ./frames \
  --crop "100,200,700,250" \
  --resize-width 480 --resize-height 48

# Custom frame rate
crop_frames extract-frames video.mp4 ./frames \
  --crop "100,200,700,250" \
  --rate 5
```

**Output:**
- Without resizing: `output_dir/frame_*.jpg` - Cropped frames
- With resizing: `output_dir/cropped/frame_*.jpg` and `output_dir/resized/frame_*.jpg`

**Benefits:**
- ✅ Generic interface - works with any video and crop coordinates
- ✅ Efficient - optional integrated resizing with parallel processing
- ✅ Flexible - resize is optional

---

### resize-frames

Batch resize existing frames to fixed dimensions.

```bash
crop_frames resize-frames <input_dir> <output_dir> --width <w> --height <h>
```

**Required Arguments:**
- `input_dir`: Directory containing frames to resize
- `output_dir`: Output directory for resized frames
- `--width`, `-w`: Target width in pixels
- `--height`, `-h`: Target height in pixels

**Optional Arguments:**
- `--preserve-aspect/--stretch`: Preserve aspect ratio with padding (default: stretch)

**Examples:**

```bash
# Resize frames with stretching (default)
crop_frames resize-frames ./cropped ./resized \
  --width 480 --height 48

# Resize with aspect ratio preservation
crop_frames resize-frames ./cropped ./resized \
  -w 480 -h 48 --preserve-aspect
```

**Output:**
- `output_dir/frame_*.jpg` - Resized frames

## Typical Workflows

### Workflow 1: Extract Only

Use when you only need cropped frames (e.g., for OCR at original resolution).

```bash
# 1. Extract frames with cropping
crop_frames extract-frames video.mp4 ./frames \
  --crop "100,200,700,250" \
  --rate 10

# 2. Process frames (e.g., OCR)
ocr_utils run ./frames
```

### Workflow 2: Extract and Resize

Use when you need resized frames (e.g., for fixed-size model input).

```bash
# 1. Extract and resize in one pass
crop_frames extract-frames video.mp4 ./frames \
  --crop "100,200,700,250" \
  --resize-width 480 --resize-height 48

# 2. Process resized frames
ocr_utils run ./frames/resized
```

### Workflow 3: Batch Resize Multiple Sizes

Use when you need the same frames at different resolutions.

```bash
# 1. Extract frames once
crop_frames extract-frames video.mp4 ./frames \
  --crop "100,200,700,250"

# 2. Resize to multiple sizes
crop_frames resize-frames ./frames ./frames_480x48 -w 480 -h 48
crop_frames resize-frames ./frames ./frames_640x64 -w 640 -h 64
crop_frames resize-frames ./frames ./frames_320x32 -w 320 -h 32
```

## Python API

```python
from pathlib import Path
from crop_frames import extract_frames, resize_frames

# Extract frames with cropping (no resizing)
output_dir, num_frames = extract_frames(
    video_path=Path("video.mp4"),
    output_dir=Path("./frames"),
    crop_box=(100, 200, 600, 50),  # (x, y, width, height)
    rate_hz=10.0,
)

# Extract and resize in one pass
output_dir, num_frames = extract_frames(
    video_path=Path("video.mp4"),
    output_dir=Path("./frames"),
    crop_box=(100, 200, 600, 50),
    rate_hz=10.0,
    resize_to=(480, 48),  # (width, height)
    preserve_aspect=False,
)

# Batch resize existing frames
output_dir, num_frames = resize_frames(
    input_dir=Path("./frames"),
    output_dir=Path("./frames_resized"),
    target_width=480,
    target_height=48,
    preserve_aspect=False,
)
```

## Technical Details

### Frame Extraction

- Uses FFmpeg's crop filter for efficient cropping during extraction
- Crop coordinates are in pixel coordinates: `(x, y, width, height)`
- Frame naming pattern: `frame_0000000001.jpg`, `frame_0000000002.jpg`, etc.
- JPEG quality: 2 (FFmpeg scale, high quality)
- Streaming extraction with progress monitoring

### Frame Resizing

- Uses Pillow with LANCZOS resampling for high quality
- Default mode: stretch to fill (useful for fixed-size model input)
- Optional: preserve aspect ratio with padding (black background)
- Parallel processing with ThreadPoolExecutor
- Progress tracking via callback

### Integrated Extract + Resize

When both extraction and resizing are requested:
1. **FFmpeg Process**: Runs asynchronously extracting cropped frames
2. **Frame Monitor**: Polls for new frames as they're written
3. **Worker Pool**: ThreadPoolExecutor processes frames in parallel
4. **Resize Pipeline**: Each worker resizes using LANCZOS resampling
5. **Output**: Both cropped and resized frames preserved

**Benefits:**
- Parallel processing during extraction
- Progress tracking for entire pipeline
- Keeps both versions for flexibility

## Determining Crop Coordinates

Crop coordinates must be provided as pixel coordinates. To determine them:

1. **Manual inspection**: Use video player or image viewer to identify subtitle region
2. **full_frames pipeline**: Analyzes videos to automatically detect subtitle regions
3. **FFplay preview**: Test crop coordinates before extraction:
   ```bash
   ffplay -i video.mp4 -vf "crop=w:h:x:y"
   ```

The `full_frames` pipeline is recommended for automated subtitle region detection.

## See Also

- `full_frames` - Automated subtitle region detection
- `ocr_utils` - OCR processing for extracted frames
- `video_utils` - Shared video processing utilities
- `image_utils` - Shared image processing utilities
