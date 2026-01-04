"""Fine-tuning Qwen2.5-VL for caption text generation with PyTorch Lightning."""

import json
from pathlib import Path
from typing import Any

import lightning as L
import torch
from torch.utils.data import DataLoader, Dataset, random_split
from transformers import AutoProcessor, AutoTokenizer
from transformers.models.qwen2_5_vl import Qwen2_5_VLForConditionalGeneration

from .training_data import TrainingSample


class CaptionTextDataset(Dataset):
    """Dataset for caption text generation training.

    Each sample contains:
    - Main image (cropped caption frame)
    - Font example image
    - OCR annotations
    - Layout priors
    - Ground truth text
    """

    def __init__(
        self,
        samples: list[TrainingSample],
        processor: Any,
        max_length: int = 512,
    ):
        """Initialize dataset.

        Args:
            samples: List of TrainingSample objects
            processor: Qwen2.5-VL processor
            max_length: Maximum sequence length
        """
        self.samples = samples
        self.processor = processor
        self.max_length = max_length

    def __len__(self) -> int:
        """Get dataset size."""
        return len(self.samples)

    def _build_prompt(self, sample: TrainingSample) -> str:
        """Build prompt for a sample."""
        layout = sample.layout_config
        img_width = layout["frame_width"]
        img_height = layout["frame_height"]
        anchor_pixel = (layout["anchor_position"], img_height // 2)
        text_height = layout["box_height"]
        justification = layout["anchor_type"]

        ocr_json = json.dumps(sample.ocr_annotations, ensure_ascii=False)

        prompt = (
            f"Task: Read text from a caption, given two images and an OCR annotation.\n"
            f"The first image ({img_width}px by {img_height}px) contains the caption and may contain distractor text.\n"
            f"The second image is a reference for the caption style, without distractor text.\n"
            f"The caption anchor point is at pixel {anchor_pixel}, {justification}-justified, "
            f"height ~{text_height}px.\n"
            f"The OCR annotation lists [(character, confidence, bounding box: [x1, y1, x2, y2])] "
            f"for characters in the first image.\n"
            f"The OCR may include distractor text. OCR errors are usually visually similar to true characters.\n"
            f"\n"
            f"OCR annotation (JSON): {ocr_json}\n"
            f"\n"
            f"Output only the valid caption text from the first image.\n"
        )

        return prompt

    def __getitem__(self, idx: int) -> dict[str, Any]:
        """Get a training sample."""
        sample = self.samples[idx]

        # Build prompt
        prompt = self._build_prompt(sample)

        # Prepare conversation format
        images = [sample.main_image, sample.font_image]
        conversation = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": images[0]},
                    {"type": "image", "image": images[1]},
                    {"type": "text", "text": prompt},
                ],
            },
            {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": sample.ground_truth_text},
                ],
            },
        ]

        # Apply chat template
        text = self.processor.apply_chat_template(conversation, tokenize=False, add_generation_prompt=False)

        # Process inputs
        inputs = self.processor(
            text=text,
            images=images,
            return_tensors="pt",
            padding="max_length",
            max_length=self.max_length,
            truncation=True,
        )

        # Flatten batch dimension (processor adds batch dim)
        for key in inputs:
            if isinstance(inputs[key], torch.Tensor) and inputs[key].dim() > 1:
                inputs[key] = inputs[key].squeeze(0)

        # Add labels (same as input_ids for causal LM)
        inputs["labels"] = inputs["input_ids"].clone()

        return inputs


class QwenVLFineTuner(L.LightningModule):
    """Lightning module for fine-tuning Qwen2.5-VL with LoRA."""

    def __init__(
        self,
        model_name: str = "Qwen/Qwen2.5-VL-3B-Instruct",
        learning_rate: float = 2e-4,
        use_lora: bool = True,
        lora_r: int = 8,
        lora_alpha: int = 16,
        lora_dropout: float = 0.2,
    ):
        """Initialize Lightning module.

        Args:
            model_name: HuggingFace model name
            learning_rate: Learning rate for optimizer
            use_lora: Whether to use LoRA fine-tuning
            lora_r: LoRA rank
            lora_alpha: LoRA alpha
            lora_dropout: LoRA dropout rate
        """
        super().__init__()
        self.save_hyperparameters()
        self.learning_rate = learning_rate

        print(f"Loading model: {model_name}")

        # Quantization config for memory efficiency
        from transformers import BitsAndBytesConfig

        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
        )

        # Load base model with quantization
        self.model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            model_name,
            quantization_config=bnb_config,
            device_map="auto",
            trust_remote_code=True,
            attn_implementation="flash_attention_2" if torch.cuda.is_available() else "eager",
        )

        self.processor = AutoProcessor.from_pretrained(model_name, trust_remote_code=True)
        self.tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)

        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        # Apply LoRA if requested
        if use_lora:
            from peft import LoraConfig, TaskType, get_peft_model

            lora_config = LoraConfig(
                task_type=TaskType.CAUSAL_LM,
                r=lora_r,
                lora_alpha=lora_alpha,
                lora_dropout=lora_dropout,
                target_modules=[
                    "q_proj",
                    "v_proj",
                    "k_proj",
                    "o_proj",
                    "gate_proj",
                    "up_proj",
                    "down_proj",
                ],
                bias="none",
            )
            self.model = get_peft_model(self.model, lora_config)
            self.model.print_trainable_parameters()

    def forward(self, **batch):
        """Forward pass."""
        return self.model(**batch)

    def training_step(self, batch, batch_idx):
        """Training step."""
        outputs = self(**batch)
        loss = outputs.loss
        self.log("train_loss", loss, prog_bar=True)
        return loss

    def validation_step(self, batch, batch_idx):
        """Validation step."""
        outputs = self(**batch)
        loss = outputs.loss
        self.log("val_loss", loss, prog_bar=True)
        return loss

    def configure_optimizers(self):
        """Configure optimizer."""
        optimizer = torch.optim.AdamW(self.parameters(), lr=self.learning_rate)
        return optimizer


def train_model(
    samples: list[TrainingSample],
    output_dir: Path,
    epochs: int = 3,
    batch_size: int = 4,
    learning_rate: float = 2e-4,
    val_split: float = 0.1,
    max_length: int = 512,
    accumulate_grad_batches: int = 4,
) -> Path:
    """Train Qwen2.5-VL model on caption text data.

    Args:
        samples: List of training samples
        output_dir: Output directory for checkpoints
        epochs: Number of training epochs
        batch_size: Batch size per device
        learning_rate: Learning rate
        val_split: Validation split ratio
        max_length: Maximum sequence length
        accumulate_grad_batches: Gradient accumulation steps

    Returns:
        Path to best checkpoint
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    # Initialize model
    model = QwenVLFineTuner(learning_rate=learning_rate)

    # Create dataset
    dataset = CaptionTextDataset(
        samples=samples,
        processor=model.processor,
        max_length=max_length,
    )

    # Split into train/val
    val_size = int(len(dataset) * val_split)
    train_size = len(dataset) - val_size

    train_dataset, val_dataset = random_split(
        dataset,
        [train_size, val_size],
        generator=torch.Generator().manual_seed(42),
    )

    print(f"Training samples: {train_size}")
    print(f"Validation samples: {val_size}")

    # Create dataloaders
    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=4,
        pin_memory=torch.cuda.is_available(),
    )

    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=4,
        pin_memory=torch.cuda.is_available(),
    )

    # Configure trainer
    trainer = L.Trainer(
        default_root_dir=str(output_dir),
        max_epochs=epochs,
        accelerator="auto",
        devices=1,
        precision="bf16-mixed" if torch.cuda.is_available() else "32",
        accumulate_grad_batches=accumulate_grad_batches,
        gradient_clip_val=1.0,
        log_every_n_steps=10,
        val_check_interval=0.5,  # Validate twice per epoch
        callbacks=[
            L.pytorch.callbacks.ModelCheckpoint(  # type: ignore[attr-defined]
                dirpath=output_dir / "checkpoints",
                filename="qwen-caption-{epoch:02d}-{val_loss:.4f}",
                monitor="val_loss",
                mode="min",
                save_top_k=3,
                save_last=True,
            ),
            L.pytorch.callbacks.LearningRateMonitor(logging_interval="step"),  # type: ignore[attr-defined]
        ],
    )

    # Train
    trainer.fit(model, train_loader, val_loader)

    # Get best checkpoint path
    # Lightning type stubs don't properly expose checkpoint_callback.best_model_path
    best_ckpt = trainer.checkpoint_callback.best_model_path  # type: ignore[union-attr]
    print(f"\nBest checkpoint: {best_ckpt}")

    return Path(best_ckpt)
