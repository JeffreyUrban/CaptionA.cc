# OCR Box Model

OCR bounding box classification model with Bayesian incremental learning.

## Overview

This package provides functionality to classify OCR character bounding boxes as caption text or non-caption noise, using:

1. **Spatial heuristics** (bootstrap before annotations exist)
2. **Bayesian logistic regression** (learns from user annotations)

## Features

- Feature extraction from box spatial properties
- Spatial heuristics using SubtitleRegion analysis as Bayesian priors
- Incremental model training from user annotations
- Confidence scoring for predictions
- Support for absolute pixel coordinates

## Usage

### Feature Extraction

```python
from ocr_box_model.features import extract_box_features
from caption_models import BoundingBox, CropBounds

# Box and layout configuration
box = BoundingBox(left=960, top=918, right=998, bottom=972)
crop_bounds = CropBounds(left=0, top=723, right=1920, bottom=1080)

# Layout parameters from SubtitleRegion analysis
layout_params = {
    'vertical_position': 945,  # Mode vertical center
    'vertical_std': 12.0,
    'box_height': 54,  # Mode box height
    'box_height_std': 5.0,
    'anchor_type': 'left',
    'anchor_position': 960,
}

# Extract features
features = extract_box_features(
    box=box,
    frame_width=1920,
    frame_height=1080,
    crop_bounds=crop_bounds,
    layout_params=layout_params,
)
```

### Spatial Heuristics Prediction

```python
from ocr_box_model.predict import predict_with_heuristics

# Predict box labels before any annotations exist
predictions = predict_with_heuristics(
    boxes=[box1, box2, box3],
    frame_width=1920,
    frame_height=1080,
    crop_bounds=crop_bounds,
    layout_params=layout_params,
)

# predictions = [
#     {'label': 'in', 'confidence': 0.85},
#     {'label': 'out', 'confidence': 0.92},
#     {'label': 'in', 'confidence': 0.45},  # Uncertain
# ]
```

## Development

Install development dependencies:

```bash
cd packages/ocr_box_model
uv pip install -e ".[dev]"
```

Run tests:

```bash
uv run pytest
```

## Package Structure

```
ocr_box_model/
├── src/ocr_box_model/
│   ├── __init__.py       # Public API
│   ├── features.py       # Feature extraction
│   └── predict.py        # Heuristics and model prediction
└── tests/
    ├── test_features.py  # Feature extraction tests
    └── test_predict.py   # Prediction tests
```
