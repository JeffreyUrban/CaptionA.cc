# caption_text

VLM-based caption text extraction and correction pipeline for CaptionA.cc.

## Overview

This pipeline provides automated caption text extraction using a fine-tuned Qwen2.5-VL vision-language model, with OCR comparison for auto-validation and LLM-based error correction.

## Features

- **Model Training**: Fine-tune Qwen2.5-VL on confirmed text annotations from all videos
- **VLM Inference**: Generate caption text from cropped frames using fine-tuned Qwen2.5-VL with OCR annotations and layout priors
- **OCR Comparison**: Auto-validate captions by comparing VLM predictions with OCR text
- **Text Vetting**: LLM-based error detection, word segmentation, translation, and explanation
- **Error Extraction**: Extract and review potential transcription errors with suggested corrections

## Installation

This package is part of the CaptionA.cc monorepo and uses workspace dependencies:

```bash
# From monorepo root
uv pip install -e data-pipelines/caption_text
```

## Prerequisites

### Required Data

Before running the pipeline, ensure you have:

1. **Cropped frames** in `annotations.db` (`cropped_frames` table)
2. **OCR annotations** in `annotations.db` (`cropped_frame_ocr` table with `ocr_annotations` JSON)
3. **Layout configuration** in `annotations.db` (`video_layout_config` table)
4. **Caption boundaries** in `annotations.db` (`captions` table)
5. **Font example image** (reference image showing caption font style)

### Model Checkpoint

You'll need a fine-tuned Qwen2.5-VL checkpoint (`.ckpt` file from Lightning training). The checkpoint should contain LoRA adapter weights trained for caption reading.

See the **Training** section below to train your own model.

## Usage

### 0. Training (First-Time Setup)

Train a model on all confirmed text annotations from your video library:

```bash
# Collect training data and train in one command
caption_text train local/data \\
    --output models/caption_text \\
    --epochs 3 \\
    --batch-size 4 \\
    --learning-rate 2e-4

# Or collect data first (for inspection)
caption_text collect-data local/data \\
    --output training_data \\
    --save-images  # Optional: save sample images for debugging
```

**Training collects data from all videos with:**
- Confirmed caption boundaries (`boundary_state = 'confirmed'`)
- Non-empty text annotations (`text IS NOT NULL AND text != ''`)
- Cropped frames in database
- OCR annotations
- Font example images
- Layout configuration

**Training options:**
- `--epochs, -e`: Number of training epochs (default: 3)
- `--batch-size, -b`: Batch size per device (default: 4)
- `--learning-rate, -lr`: Learning rate (default: 2e-4)
- `--val-split`: Validation split ratio (default: 0.1 = 10%)
- `--max-length`: Maximum sequence length (default: 512)
- `--accumulate`: Gradient accumulation steps (default: 4)

**Output:**
- Model checkpoints in `{output_dir}/checkpoints/`
- Best checkpoint: `qwen-caption-{epoch}-{val_loss}.ckpt`
- Training logs with Lightning

**Hardware requirements:**
- GPU with 24GB+ VRAM (RTX 4090, A100) recommended
- CPU training is very slow
- Uses 4-bit quantization to reduce memory usage

### 1. VLM Inference

Generate caption text for all captions needing annotation:

```bash
caption_text infer local/data/video_id \\
    --checkpoint models/qwen_finetuned.ckpt \\
    --font-example local/data/video_id/font_example.jpg \\
    --output vlm_results.csv
```

**Options:**
- `--checkpoint, -c`: Path to fine-tuned model checkpoint (required)
- `--font-example, -f`: Path to font example image (required)
- `--output, -o`: Output CSV file (default: `vlm_inference_results.csv`)
- `--limit, -n`: Maximum number of captions to process

**Output:**
- Updates `captions.text` in database with VLM predictions
- Writes CSV: `start_frame,end_frame,text`

### 2. OCR Comparison

Compare VLM results with OCR and auto-validate exact matches:

```bash
caption_text compare local/data/video_id \\
    --vlm-csv vlm_results.csv \\
    --auto-validate
```

**Options:**
- `--vlm-csv`: Path to VLM results CSV (default: `vlm_inference_results.csv`)
- `--auto-validate/--no-auto-validate`: Auto-validate exact matches (default: true)

**Output:**
- Updates `captions.text_pending = 0` and `text_status = 'valid_caption'` for matches
- Writes `ocr_vs_vlm_mismatches.csv` for manual review

### 3. Text Vetting

Vet caption text for transcription errors using LLM:

```bash
# Using Anthropic Claude API
caption_text vet local/data/video_id \\
    --model claude-sonnet-4-5 \\
    --output vetting_results.jsonl

# Using Ollama (local)
caption_text vet local/data/video_id \\
    --ollama \\
    --model qwen3:14b \\
    --output vetting_results.jsonl
```

**Options:**
- `--model, -m`: LLM model name (default: `claude-sonnet-4-5`)
- `--ollama`: Use Ollama instead of Anthropic API
- `--output, -o`: Output JSONL file (default: `caption_vetting_results.jsonl`)
- `--context`: Number of captions before/after for context (default: 5)

**Output JSONL format:**
```json
{
  "caption_id": 123,
  "start_frame": 1000,
  "end_frame": 1050,
  "caption_text": "中国 多样的地理环境和气候",
  "has_error": false,
  "corrected": null,
  "word_segmentation": ["中国", "多样的", "地理环境", "和", "气候"],
  "translation": "China's diverse geographical environment and climate",
  "explanation": "China has a varied geography and climate..."
}
```

### 4. Extract Errors

Extract captions with detected errors for review:

```bash
caption_text extract-errors vetting_results.jsonl \\
    --output caption_errors.csv
```

**Output CSV format:**
```csv
caption_id,start_frame,end_frame,original_text,corrected_text
```

## Pipeline Workflow

**Complete workflow (including training):**

```bash
# Step 0: Train model on all confirmed annotations (first-time only)
caption_text train local/data \\
    --output models/caption_text \\
    --epochs 3 \\
    --batch-size 4

# Step 1: Generate caption text with fine-tuned VLM
caption_text infer local/data/video_id \\
    -c models/caption_text/checkpoints/best.ckpt \\
    -f local/data/video_id/font_example.jpg

# Step 2: Compare with OCR and auto-validate matches
caption_text compare local/data/video_id --auto-validate

# Step 3: Vet remaining captions for errors
caption_text vet local/data/video_id --model claude-sonnet-4-5

# Step 4: Extract errors for manual review
caption_text extract-errors caption_vetting_results.jsonl -o errors.csv

# Step 5: Review and apply corrections manually
# (Use web app or direct database updates)
```

## Database Schema

### Captions Table (Text Fields)

```sql
-- Text annotation fields in captions table
text TEXT,                 -- NULL = not annotated, '' = no caption
text_pending INTEGER,      -- 0 or 1
text_status TEXT,          -- 'valid_caption', 'ocr_error', etc.
text_notes TEXT,           -- Annotation notes
text_ocr_combined TEXT,    -- Cached OCR result
text_updated_at TEXT       -- Timestamp of last text update
```

### Cropped Frame OCR Table

```sql
CREATE TABLE cropped_frame_ocr (
    frame_index INTEGER PRIMARY KEY,
    ocr_text TEXT,
    ocr_annotations TEXT,  -- JSON: [[char, conf, [x, y, w, h]], ...]
    ocr_confidence REAL,
    crop_bounds_version INTEGER,
    created_at TEXT
);
```

## Model Architecture

The VLM inference uses:

- **Base model**: Qwen2.5-VL-3B-Instruct
- **Quantization**: 4-bit NF4 with double quantization
- **LoRA adapters**: r=8, alpha=16, dropout=0.2
- **Target modules**: q_proj, v_proj, k_proj, o_proj, gate_proj, up_proj, down_proj

## Dependencies

**Core:**
- `torch>=2.1.0` - PyTorch
- `transformers>=4.40.0` - Hugging Face transformers (Qwen2.5-VL)
- `peft>=0.10.0` - LoRA/PEFT
- `pillow>=10.0.0` - Image processing

**Optional:**
- `anthropic` - For Claude API (text vetting)
- `ollama` - For Ollama (local text vetting)

**Workspace:**
- `frames_db` - Frame storage/retrieval
- `caption_models` - Caption data models
- `image_utils`, `video_utils` - Utilities

## Development

### Running Tests

```bash
pytest data-pipelines/caption_text/tests/
```

### Code Quality

```bash
# Format
ruff format data-pipelines/caption_text/

# Lint
ruff check data-pipelines/caption_text/

# Type check
pyright data-pipelines/caption_text/
```

See [LICENSE.md](../../LICENSE.md) in the monorepo root.
