# Model Architecture System

## Overview

The caption boundaries pipeline uses a **registry pattern** for model architectures, enabling rapid experimentation while maintaining full reproducibility.

## Key Concepts

### Architecture Registry

Models are **defined in code** (not config files) and registered by name:

```python
@register_model("my_architecture")
def create_my_architecture(num_classes=5, **kwargs):
    return MyModel(num_classes=num_classes, **kwargs)
```

### Task Constraints

All models for caption boundary detection must:
- Accept 5 inputs: `ocr_viz`, `frame1`, `frame2`, `spatial_features`, `font_embedding`
- Output 5 classes: `same`, `different`, `empty_empty`, `empty_valid`, `valid_empty`
- Implement: `get_num_trainable_params()`, `get_num_total_params()`

### Configuration vs Architecture

- **Architecture** (registry): Structural design (triple backbone vs shared backbone vs ViT)
- **Model config** (JSON): Architecture-specific params (`pretrained`, `dropout`, `hidden_dim`)
- **Hyperparameters** (JSON): Training params (`lr`, `batch_size`, `epochs`)

## Available Architectures

### `triple_backbone_resnet50` (Baseline)
- **Parameters**: 78M (77,787,717)
- **Design**: Three separate ResNet50 backbones for OCR viz, frame1, frame2
- **Use case**: Maximum capacity, separate feature learning per input
- **Training**: `caption_boundaries train dataset --architecture triple_backbone_resnet50`

### `shared_backbone_resnet50`
- **Parameters**: 31M (30,771,653) - 60% smaller
- **Design**: Single ResNet50 processes all three inputs sequentially
- **Use case**: Parameter efficiency, shared visual features
- **Training**: `caption_boundaries train dataset --architecture shared_backbone_resnet50`

### `channel_fusion_lora_resnet50`
- **Parameters**: ~27M (ResNet50 + 1x1 conv + LoRA adapters)
- **Design**: 1x1 conv fuses 3 images → single backbone with LoRA
- **Use case**: Efficient fine-tuning, minimal trainable parameters
- **Training**: `caption_boundaries train dataset --architecture channel_fusion_lora_resnet50`

## Adding New Architectures

### 1. Create Model Class

```python
# models/my_architecture.py
import torch.nn as nn
from caption_boundaries.models.registry import register_model

class MyCustomModel(nn.Module):
    def __init__(self, num_classes=5, custom_param=128, **kwargs):
        super().__init__()
        self.num_classes = num_classes
        # ... define layers ...

    def forward(self, ocr_viz, frame1, frame2, spatial_features, font_embedding):
        # ... forward pass ...
        return logits  # (batch, 5)

    def get_num_trainable_params(self):
        return sum(p.numel() for p in self.parameters() if p.requires_grad)

    def get_num_total_params(self):
        return sum(p.numel() for p in self.parameters())

@register_model("my_custom_architecture")
def create_my_custom_model(num_classes=5, **kwargs):
    return MyCustomModel(num_classes=num_classes, **kwargs)
```

### 2. Register in `models/__init__.py`

```python
from caption_boundaries.models import my_architecture  # noqa: F401
```

### 3. Use It

```bash
# Training
caption_boundaries train my_dataset \
    --name exp_custom \
    --architecture my_custom_architecture \
    --pretrained

# Inference (automatically uses correct architecture from checkpoint)
caption_boundaries infer video.db --checkpoint checkpoints/best.pt
```

## Experiment Tracking

Every experiment records:

```python
experiment = Experiment(
    name="exp_lora_fusion",
    architecture_name="channel_fusion_lora_resnet50",
    model_config={"pretrained": True, "lora_rank": 16},
    hyperparameters={"lr": 1e-3, "epochs": 50},
    fontclip_model_version="openai-clip-vit-base-patch32-v1.0-fallback",
    git_commit="abc123",
    # ... metrics, checkpoints, etc.
)
```

Query experiments:
```python
with next(get_dataset_db(dataset_path)) as db:
    experiments = db.query(Experiment).all()
    for exp in experiments:
        print(f"{exp.name}: {exp.architecture_name} - F1: {exp.best_val_f1:.3f}")
```

## Checkpoints

Checkpoints contain everything needed for reproducibility:

```python
checkpoint = {
    "epoch": 50,
    "model_state_dict": {...},
    "optimizer_state_dict": {...},
    "config": {
        "architecture_name": "channel_fusion_lora_resnet50",
        "model_config": {"pretrained": True, "lora_rank": 16},
        "transform_strategy": "mirror_tile",
        "ocr_viz_variant": "boundaries",
        "use_font_embedding": True,
    },
    "metrics": {...},
}
```

Loading automatically recreates the exact architecture:
```python
predictor = BoundaryPredictor("checkpoints/best.pt")
# Reads architecture_name, creates correct model, loads weights
```

## Best Practices

### DO:
- ✅ Define architectures in Python code (not config files)
- ✅ Use meaningful names (`channel_fusion_lora` not `model_v3`)
- ✅ Document parameter counts and design rationale
- ✅ Keep task constraints (5 classes) in validation, not configuration
- ✅ Use model_config for architectural choices (dropout, LoRA rank)
- ✅ Use hyperparameters for training choices (learning rate, batch size)

### DON'T:
- ❌ Hard-code architecture in trainer (use registry)
- ❌ Store architecture definitions in JSON/YAML (use Python)
- ❌ Make num_classes configurable (it's a task constraint)
- ❌ Create registry for every minor variant (combine via config params)

## Comparing Architectures

### W&B Comparison
All experiments logged to W&B with architecture as a tag:
```python
wandb.config.update({
    "architecture_name": "channel_fusion_lora_resnet50",
    "model_config": {"pretrained": True, "lora_rank": 16},
    # ...
})
```

Filter in W&B: `architecture_name = "channel_fusion_lora_resnet50"`

### Database Queries
```python
# Find best architecture
with next(get_dataset_db(dataset_path)) as db:
    best = db.query(Experiment).order_by(Experiment.best_val_f1.desc()).first()
    print(f"Best: {best.architecture_name} (F1: {best.best_val_f1:.3f})")

# Compare architectures
    for arch_name in ["triple_backbone_resnet50", "shared_backbone_resnet50"]:
        experiments = db.query(Experiment).filter(
            Experiment.architecture_name == arch_name
        ).all()
        avg_f1 = sum(e.best_val_f1 for e in experiments) / len(experiments)
        print(f"{arch_name}: {len(experiments)} runs, avg F1: {avg_f1:.3f}")
```

## Future Architectures to Try

- **Vision Transformer (ViT)**: Replace ResNet with ViT backbone
- **EfficientNet**: More efficient backbone (EfficientNet-B3/B5)
- **Cross-attention fusion**: Attention-based fusion instead of concatenation
- **Temporal modeling**: LSTM/Transformer over frame sequence
- **Multi-task learning**: Joint boundary + caption text prediction
