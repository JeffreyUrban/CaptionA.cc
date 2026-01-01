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
# Basic training
caption_boundaries train 1 --name exp_baseline --epochs 50

# With custom balanced sampling ratio
caption_boundaries train 1 --name exp_aggressive --epochs 50 --sampling-ratio 2.0

# Disable balanced sampling (use full dataset each epoch)
caption_boundaries train 1 --name exp_full --epochs 50 --no-balanced-sampling
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

## Training Features

### Class Imbalance Handling

The pipeline implements multiple strategies to handle class imbalance:

1. **Balanced Sampling (Default)**: Dynamically resamples majority classes each epoch
   - Different random subset of majority class each epoch
   - Configurable via `--sampling-ratio` (default: 3.0)
   - Provides training speedup while maintaining data diversity
   - Over many epochs, model sees all data

2. **Class Weights**: Inverse frequency weighting in loss function
   - Minority classes get higher loss contribution
   - Automatically computed from training data

3. **Macro F1 Metric**: Treats all classes equally regardless of size
   - Primary metric for model selection
   - Better indicator of minority class performance than weighted F1

4. **Per-Class Metrics**: Individual precision, recall, F1 for each class
   - Logged to W&B for detailed monitoring
   - Helps identify which classes need attention

### Advanced Training

- **Learning Rate Scheduler**: ReduceLROnPlateau (factor=0.5, patience=2)
- **Early Stopping**: Patience=5 epochs on validation loss
- **Differential Learning Rates**: Classifier gets 10x higher LR than feature extractor

## Development

```bash
# Run tests
pytest

# Run type checking
pyright

# Run linting
ruff check .
```
