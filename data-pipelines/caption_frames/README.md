# caption_frames

Extract and process video frames for caption regions.

## Overview

This pipeline provides tools for extracting frames from videos with intelligent cropping based on subtitle region analysis, and resizing those frames for processing (e.g., OCR, model training).

Supports both **streaming** (recommended) and **batch** processing modes:
- **Streaming**: Extract and resize frames in one pass with parallel processing (faster, more efficient)
- **Batch**: Extract all frames first, then resize separately (simpler workflow, uses more disk)

## Features

- **Streaming Pipeline**: Extract and resize in one pass with parallel processing
- **Smart Frame Extraction**: FFmpeg cropping based on subtitle_analysis.txt from caption_layout
- **Frame Resizing**: High-quality LANCZOS resampling to fixed dimensions
- **Progress Tracking**: Rich progress bars for all operations
- **Flexible Storage**: Keep both cropped and resized frames for ongoing work

## Installation

```bash
cd data-pipelines/caption_frames
uv pip install -e .
```

## Prerequisites

This pipeline requires:
- `caption_layout` pipeline output: `subtitle_analysis.txt` file
- Shared packages: `video_utils`, `image_utils`, `caption_models`
- FFmpeg installed (for frame extraction)

## Commands

### extract-and-resize (RECOMMENDED)

Extract and resize frames in one streaming pass - combines extraction and resizing for efficiency.

Output directories are automatically created based on parameters:
- **Cropped**: `{rate}Hz_cropped_frames` (e.g., `10Hz_cropped_frames`)
- **Resized**: `{rate}Hz_{width}x{height}_frames` (e.g., `10Hz_480x48_frames`)

By default, outputs to the same directory as the video. Use `--output-dir` to specify a different location.

```bash
caption_frames extract-and-resize <video_path>
```

**Required:**
- `video_path`: Path to video file

**Optional:**
- `--output-dir`, `-o`: Output directory for frame subdirectories (default: same directory as video)
- `--analysis`, `-a`: Analysis filename in same directory as video (default: `subtitle_analysis.txt`)
- `--rate-hz`, `-r`: Frame sampling rate in Hz (default: 10.0)
- `--width`, `-w`: Target width in pixels (default: 480)
- `--height`: Target height in pixels (default: 48)
- `--preserve-aspect/--stretch`: Preserve aspect ratio with padding (default: stretch)
- `--keep-cropped/--delete-cropped`: Keep intermediate cropped frames (default: keep both)
- `--max-workers`: Parallel resize workers (default: 4)

**Example:**
```bash
# Extract and resize to 480x48 at 10Hz
# Creates: 10Hz_cropped_frames/ and 10Hz_480x48_frames/ next to video
caption_frames extract-and-resize /path/to/videos/episode.mp4

# Custom output directory
caption_frames extract-and-resize /path/to/videos/episode.mp4 \
  --output-dir /path/to/frames

# Custom rate and dimensions
# Creates: 5Hz_cropped_frames/ and 5Hz_640x64_frames/
caption_frames extract-and-resize /path/to/videos/show.mkv \
  --rate-hz 5 \
  --width 640 --height 64

# Delete intermediate cropped frames to save disk space
caption_frames extract-and-resize /path/to/videos/episode.mp4 \
  --delete-cropped
```

**Input:**
- `video_path` - Video file (e.g., `/path/to/videos/episode.mp4`)
- `subtitle_analysis.txt` - Subtitle region analysis from caption_layout (same directory as video)

**Output:**
- `{output_dir}/{rate}Hz_cropped_frames/frame_*.jpg` - Cropped frames (intermediate)
- `{output_dir}/{rate}Hz_{width}x{height}_frames/frame_*.jpg` - Resized frames (final)

Where `{output_dir}` is the same directory as the video by default, or the directory specified with `--output-dir`.

**Benefits:**
- ✅ Faster: Parallel resize during extraction
- ✅ Efficient: Single progress bar
- ✅ Flexible: Optional cleanup of intermediate frames
- ✅ Storage: Keeps both sets for ongoing work by default

---

### extract-frames (Batch Mode)

Extract frames only - use when you want to inspect cropped frames before resizing.

```bash
caption_frames extract-frames <episode_dir> --video <video_filename>
```

**Required:**
- `episode_dir`: Directory containing video and subtitle_analysis.txt
- `--video`, `-v`: Video filename in episode directory

**Optional:**
- `--analysis`, `-a`: Subtitle analysis filename (default: `subtitle_analysis.txt`)
- `--output-subdir`, `-o`: Output subdirectory name (default: `10Hz_cropped_frames`)
- `--rate-hz`, `-r`: Frame sampling rate in Hz (default: 10.0)

**Output:**
- `episode_dir/10Hz_cropped_frames/frame_*.jpg` - Extracted frames cropped to subtitle region

---

### resize-frames (Batch Mode)

Resize existing frames - use when you want different sizes from the same cropped frames.

```bash
caption_frames resize-frames <episode_dir> --output-subdir <output_name>
```

**Required:**
- `episode_dir`: Episode directory containing frames subdirectory
- `--output-subdir`, `-o`: Output subdirectory name (e.g., `10Hz_480x48_frames`)

**Optional:**
- `--input-subdir`, `-i`: Input subdirectory with frames to resize (default: `10Hz_cropped_frames`)
- `--width`, `-w`: Target width in pixels (default: 480)
- `--height`, `-h`: Target height in pixels (default: 48)
- `--preserve-aspect`: Maintain aspect ratio with padding (default: stretch to fill)

**Output:**
- `episode_dir/10Hz_480x48_frames/frame_*.jpg` - Resized frames

## Typical Workflow

This pipeline fits into the broader caption extraction workflow:

### Streaming Workflow (Recommended)

1. **caption_layout analyze** - Analyze video to find subtitle region
   - Output: `subtitle_analysis.txt`

2. **caption_frames extract-and-resize** - Extract and resize in one pass
   - Input: video file, `subtitle_analysis.txt`
   - Output: `10Hz_cropped_frames/`, `10Hz_480x48_frames/`

3. **ocr_utils run** - Run OCR on frames
   - Input: `10Hz_cropped_frames/` or `10Hz_480x48_frames/`
   - Output: `OCR.jsonl`

### Batch Workflow (Alternative)

1. **caption_layout analyze** - Analyze video to find subtitle region
   - Output: `subtitle_analysis.txt`

2. **caption_frames extract-frames** - Extract frames cropped to subtitle region
   - Input: video file, `subtitle_analysis.txt`
   - Output: `10Hz_cropped_frames/`

3. **caption_frames resize-frames** - Resize to fixed dimensions (if needed)
   - Input: `10Hz_cropped_frames/`
   - Output: `10Hz_480x48_frames/`

4. **ocr_utils run** - Run OCR on frames
   - Input: frame directory
   - Output: `OCR.jsonl`

## Python API

### Streaming API (Recommended)

```python
from pathlib import Path
from caption_frames import stream_extract_and_resize

# Extract and resize in one streaming pass
num_frames = stream_extract_and_resize(
    video_path=Path("/path/to/episode/video.mp4"),
    analysis_path=Path("/path/to/episode/subtitle_analysis.txt"),
    cropped_dir=Path("/path/to/episode/10Hz_cropped_frames"),
    resized_dir=Path("/path/to/episode/10Hz_480x48_frames"),
    rate_hz=10.0,
    target_width=480,
    target_height=48,
    preserve_aspect=False,
    keep_cropped=True,  # Keep both directories
    max_workers=4,
)
```

### Batch API (Alternative)

```python
from pathlib import Path
from caption_frames import extract_frames_from_episode, resize_frames_in_directory

# Extract frames with cropping
output_dir, num_frames = extract_frames_from_episode(
    episode_dir=Path("/path/to/episode"),
    video_filename="episode.mp4",
    analysis_filename="subtitle_analysis.txt",
    output_subdir="10Hz_cropped_frames",
    rate_hz=10.0,
)

# Resize frames separately
output_dir, num_frames = resize_frames_in_directory(
    episode_dir=Path("/path/to/episode"),
    input_subdir="10Hz_cropped_frames",
    output_subdir="10Hz_480x48_frames",
    target_width=480,
    target_height=48,
    preserve_aspect=False,
)
```

## Technical Details

### Streaming Pipeline

The `extract-and-resize` command uses an efficient streaming architecture:

1. **FFmpeg Background Process**: Runs asynchronously extracting frames with crop filter
2. **Frame Monitor**: Polls for new frames as they're written to disk
3. **Worker Pool**: ThreadPoolExecutor (default: 4 workers) processes frames in parallel
4. **Resize Pipeline**: Each worker resizes a frame using high-quality LANCZOS resampling
5. **Optional Cleanup**: Deletes intermediate cropped frames after resizing (if requested)

**Benefits**:
- Lower peak disk usage (frames processed as extracted, not all at once)
- Faster overall (parallelized resize during extraction)
- Progress tracking for entire pipeline

### Frame Extraction

- Uses FFmpeg's crop filter for efficient cropping during extraction (not post-processing)
- Converts fractional crop bounds from subtitle_analysis.txt to pixel coordinates
- Naming pattern: `frame_0000000001.jpg`, `frame_0000000002.jpg`, etc.
- JPEG quality: 2 (FFmpeg scale, high quality)
- Async execution with `.run_async()` for streaming

### Frame Resizing

- Uses Pillow with LANCZOS resampling for high quality
- Default mode: stretch to fill (useful for fixed-size model input)
- Optional: preserve aspect ratio with padding (black background)
- Parallel processing with ThreadPoolExecutor
- Progress tracking via callback

## See Also

- `caption_layout` - Analyze subtitle region layout (prerequisite)
- `ocr_utils` - Run OCR on extracted frames (next step)
- `video_utils` - Shared video processing utilities
- `image_utils` - Shared image processing utilities
- `caption_models` - Data models for caption processing
