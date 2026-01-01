# Caption Boundaries Detection

Deep learning pipeline for detecting caption boundary transitions by comparing consecutive cropped caption frames.

## Features

- **OCR Box Visualization**: Multiple visualization strategies (boundaries, centers, 3D encoding)
- **FontCLIP Integration**: Pre-trained font style embeddings for better generalization
- **Anchor-Aware Transforms**: Smart cropping and mirror-tiling based on caption anchor type
- **Comprehensive Provenance**: Track all inputs, pipeline versions, and model lineage
- **W&B Experiment Tracking**: Full MLOps integration with Weights & Biases
- **Multi-Platform**: Supports both CUDA (RTX 4090) and MPS (M2 MacBook)

## Installation

```bash
cd data-pipelines/caption_boundaries
uv sync
```

## Quick Start

### 1. Create Training Dataset

```bash
caption_boundaries create-dataset my_dataset local/data/*/01
```

### 2. Train Model

```bash
caption_boundaries train 1 --name 00_00_01_added_ocr_viz --epochs 3
```

### 3. Run Inference

```bash
caption_boundaries infer path/to/video/annotations.db \
    --checkpoint checkpoints/best.pt \
    --version v1.0
```

### 4. Quality Analysis

```bash
caption_boundaries analyze path/to/video/annotations.db
```

## Architecture

The pipeline uses a multi-frame architecture:

**Input:**
- OCR Box Visualization (spatial prior from aggregated OCR detections)
- Frame 1 (cropped caption at time t)
- Frame 2 (cropped caption at time t+1)
- Metadata: Spatial priors + FontCLIP embeddings

**Output:**
- 5-way classification: `same`, `different`, `empty_empty`, `empty_valid`, `valid_empty`

## Development

```bash
# Run tests
pytest

# Run type checking
pyright

# Run linting
ruff check .
```

## Documentation

See `/Users/jurban/.claude/plans/proud-dancing-shannon.md` for the complete implementation plan.
