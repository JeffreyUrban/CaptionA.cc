# video_utils

Shared video processing utilities using FFmpeg for the CaptionA.cc project.

## Features

- **Frame Extraction**: Extract frames from video at specified rates
- **Video Metadata**: Get video duration and dimensions
- **FFmpeg Integration**: Efficient video processing using ffmpeg-python

## Installation

This package is part of the CaptionA.cc monorepo and is automatically available to other components via the uv workspace.

## Usage

```python
from pathlib import Path
from video_utils import extract_frames, get_video_dimensions, get_video_duration

# Get video information
video_path = Path("video.mp4")
duration = get_video_duration(video_path)  # Duration in seconds
width, height = get_video_dimensions(video_path)  # Dimensions in pixels

# Extract frames at 0.1Hz (1 frame every 10 seconds)
output_dir = Path("frames")
frames = extract_frames(
    video_path,
    output_dir,
    rate_hz=0.1,
    progress_callback=lambda current, total: print(f"{current}/{total}")
)
```

## Requirements

- Python 3.14+
- FFmpeg installed on the system

## Development

```bash
# Install with dev dependencies
cd packages/video_utils
uv pip install -e ".[dev]"

# Run tests
pytest
```
