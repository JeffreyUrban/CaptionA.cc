# image_utils

Shared image processing utilities using Pillow.

## Features

- **Image Resizing**: Resize images to target dimensions with optional aspect ratio preservation
- **Batch Processing**: Process entire directories of images
- **High Quality**: Uses LANCZOS resampling for best quality

## Installation

```bash
cd packages/image_utils
uv pip install -e .
```

## Usage

### Resize Single Image

```python
from pathlib import Path
from image_utils import resize_image

resize_image(
    image_path=Path("input.jpg"),
    output_path=Path("output.jpg"),
    target_size=(480, 48),
    preserve_aspect=False,  # Stretch to fill
)
```

### Resize Directory

```python
from pathlib import Path
from image_utils import resize_directory

resized_files = resize_directory(
    input_dir=Path("frames/"),
    output_dir=Path("resized/"),
    target_size=(480, 48),
    pattern="*.jpg",
    preserve_aspect=False,
)
```

### With Progress Callback

```python
def on_progress(current: int, total: int) -> None:
    print(f"Processing {current}/{total}")

resize_directory(
    input_dir=Path("frames/"),
    output_dir=Path("resized/"),
    target_size=(480, 48),
    progress_callback=on_progress,
)
```

## API Reference

See function docstrings for detailed parameter documentation:

- `resize_image()` - Resize a single image
- `resize_directory()` - Batch resize all images in a directory
