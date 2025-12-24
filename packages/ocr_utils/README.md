# ocr_utils

Shared OCR processing utilities using macOS LiveText for the CaptionA.cc project.

## Features

- **Retry Logic**: OCR with timeout protection and exponential backoff
- **Batch Processing**: Process directories of frames with worker pools
- **Visualization**: Create visual summaries of detected text regions
- **Streaming**: Memory-efficient JSONL streaming for large datasets

## Installation

This package is part of the CaptionA.cc monorepo and is automatically available to other components via the uv workspace.

## Usage

```python
from pathlib import Path
from ocr_utils import process_frame_ocr_with_retry, process_frames_directory, create_ocr_visualization

# Process a single frame with retry logic
image_path = Path("frame.jpg")
result = process_frame_ocr_with_retry(
    image_path,
    language="zh-Hans",
    timeout=10,
    max_retries=3
)

# Process a directory of frames
frames_dir = Path("frames")
output_file = Path("ocr_results.jsonl")
process_frames_directory(
    frames_dir,
    output_file,
    language="zh-Hans",
    progress_callback=lambda current, total: print(f"{current}/{total}"),
    keep_frames=False,  # Delete frames after processing
    max_workers=1  # macOS OCR works best with single worker
)

# Create visualization
create_ocr_visualization(
    ocr_file=Path("ocr_results.jsonl"),
    output_image=Path("ocr_boxes.png"),
    width=1920,
    height=1080
)
```

## Requirements

- Python 3.14+
- macOS with LiveText API support
- ocrmac library

## Development

```bash
# Install with dev dependencies
cd packages/ocr_utils
uv pip install -e ".[dev]"

# Run tests
pytest
```
