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
caption_boundaries create-dataset my_dataset !__local/data/_has_been_deprecated__!/*/01
```

### 2. Train Model

```bash
# Cap-based sampling (recommended for scaling - constant epoch time)
caption_boundaries train my_dataset --name exp_baseline --max-samples 10000

# Quick experiments (faster epochs)
caption_boundaries train my_dataset --name quick_test --max-samples 5000 --epochs 10

# Production training (more data per epoch)
caption_boundaries train my_dataset --name production --max-samples 20000 --epochs 50

# Ratio-based sampling (legacy - epoch time grows with data)
caption_boundaries train my_dataset --name exp_ratio --sampling-ratio 3.0 --epochs 50

# Disable balanced sampling (use full dataset each epoch)
caption_boundaries train my_dataset --name exp_full --no-balanced-sampling --epochs 50
```

### 3. Run Inference

```bash
caption_boundaries infer path/to/video/captions.db \
    --checkpoint checkpoints/best.pt \
    --version v1.0
```

### 4. Quality Analysis

```bash
caption_boundaries analyze path/to/video/captions.db
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

### Dataset Storage

Each dataset is stored in a **self-contained SQLite database** at:
```
local/models/caption_boundaries/datasets/{dataset_name}.db
```

**What's included:**
- Training samples (frame pairs with labels)
- Frame images (cropped captions as PNG blobs)
- OCR visualizations (one per video)
- Font embeddings (512-dim FontCLIP features)
- Video metadata and provenance

**Benefits:**
- ✓ Self-contained and portable
- ✓ Easy to delete/archive individual datasets
- ✓ Fast loading during training (no distributed database queries)
- ✓ Complete provenance tracking

**Note:** Font embeddings are extracted automatically during dataset creation using a fallback CLIP model (openai/clip-vit-base-patch32) if VecGlypher/fontclip_weight is not accessible.

## Training Features

### Class Imbalance Handling

The pipeline implements multiple strategies to handle class imbalance:

1. **Balanced Sampling (Default)**: Supports two modes for undersampling majority classes

   **Cap-Based (Recommended for Scaling)**:
   - Fixed absolute cap on samples per class per epoch
   - Example: `--max-samples 10000` = max 10K samples per class
   - **Constant epoch time** regardless of dataset size
   - Predictable training schedule as data grows
   - Usage: `--max-samples 10000`

   **Ratio-Based (Legacy)**:
   - Cap based on minority class size × ratio
   - Example: `--sampling-ratio 3.0` = max 3× minority class per class
   - Epoch time grows with dataset size
   - Useful for small datasets
   - Usage: `--sampling-ratio 3.0`

   **Benefits**:
   - Different random subset each epoch for data diversity
   - Model sees all data over multiple epochs
   - Significant training speedup

2. **Class Weights**: Inverse frequency weighting in loss function
   - Minority classes get higher loss contribution
   - Automatically computed from training data

3. **Macro F1 Metric**: Treats all classes equally regardless of size
   - Primary metric for model selection
   - Better indicator of minority class performance than weighted F1

4. **Per-Class Metrics**: Individual precision, recall, F1 for each class
   - Logged to W&B for detailed monitoring
   - Helps identify which classes need attention

**Recommended Settings**:
- Quick experiments: `--max-samples 5000`
- Hyperparameter tuning: `--max-samples 10000`
- Production training: `--max-samples 20000`
- See all data: `--no-balanced-sampling`

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
