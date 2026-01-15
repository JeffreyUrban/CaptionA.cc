# caption_models

Shared data models and analysis functions for caption processing pipelines in the CaptionA.cc project.

## Features

- **SubtitleRegion Model**: Dataclass for subtitle region characteristics
- **Analysis Functions**: Convert OCR bounding boxes to subtitle region statistics
- **I/O Functions**: Load/save OCR annotations and analysis results
- **Visualization**: Create visual representations of analysis results

## Installation

This package is part of the CaptionA.cc monorepo and is automatically available to other components via the uv workspace.

## Usage

```python
from pathlib import Path
from caption_models import (
    SubtitleRegion,
    load_ocr_annotations,
    analyze_subtitle_region,
    save_analysis_text,
    create_analysis_visualization,
)

# Load OCR results
ocr_file = Path("OCR.jsonl")
annotations = load_ocr_annotations(ocr_file)

# Analyze subtitle region
region = analyze_subtitle_region(
    annotations,
    width=1920,
    height=1080,
    min_overlap=0.75
)

# Save analysis
save_analysis_text(region, Path("subtitle_analysis.txt"))

# Create visualization
create_analysis_visualization(
    region,
    annotations,
    Path("subtitle_analysis.png")
)

# Access region properties
print(f"Crop coordinates: [{region.crop_left}, {region.crop_top}, "
      f"{region.crop_right}, {region.crop_bottom}]")
print(f"Anchor type: {region.anchor_type}")
print(f"Anchor position: {region.anchor_position}")
```

## Requirements

- Python 3.14+
- opencv-python (for visualization only)

## Development

```bash
# Install with dev dependencies
cd packages/caption_models
uv pip install -e ".[dev]"

# Run tests
pytest
```
