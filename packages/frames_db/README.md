# frames_db

Database storage and retrieval for video frames.

## Overview

This package provides utilities for storing and retrieving video frames in SQLite databases. Frames are stored as JPEG-compressed BLOBs alongside metadata (dimensions, file size, timestamps).

## Features

- **Storage**: Write individual frames or batches to database
- **Retrieval**: Read frames by index or range
- **Conversions**: Convert frames to PIL Image, OpenCV array, or temporary files
- **Performance**: Batched writes with transactions for efficiency
- **Invalidation**: Support for crop_bounds_version tracking

## Usage

### Writing Frames

```python
from frames_db import write_frame_to_db, write_frames_batch

# Write single frame
write_frame_to_db(
    db_path=Path("captions.db"),
    frame_index=100,
    image_data=jpeg_bytes,
    width=1920,
    height=1080,
    table="full_frames"
)

# Write batch of frames
frames = [
    (0, jpeg_bytes_0, 1920, 1080),
    (100, jpeg_bytes_100, 1920, 1080),
    (200, jpeg_bytes_200, 1920, 1080),
]
write_frames_batch(
    db_path=Path("captions.db"),
    frames=frames,
    table="full_frames"
)
```

### Reading Frames

```python
from frames_db import get_frame_from_db, get_frames_range

# Get single frame
frame = get_frame_from_db(
    db_path=Path("captions.db"),
    frame_index=100,
    table="full_frames"
)

# Convert to different formats
pil_img = frame.to_pil_image()
cv2_img = frame.to_cv2_image()
temp_path = frame.to_temp_file()  # For tools requiring filesystem paths

# Get range of frames
frames = get_frames_range(
    db_path=Path("captions.db"),
    start_index=0,
    end_index=1000,
    table="full_frames"
)
```

## Database Schema

### full_frames Table (0.1Hz sampling)

```sql
CREATE TABLE full_frames (
    frame_index INTEGER PRIMARY KEY,
    image_data BLOB NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    file_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
```

## Development

```bash
# Install in development mode
cd packages/frames_db
uv pip install -e ".[dev]"

# Run tests
pytest

# Run tests with coverage
pytest --cov=frames_db --cov-report=html
```
