"""Training loop for caption boundary detection model.

Implements training with W&B experiment tracking, validation metrics,
and checkpoint management.
"""

import json
import random
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
import wandb
from rich.console import Console
from rich.progress import track
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from torch.utils.data import DataLoader, Sampler

from caption_boundaries.data.dataset import CaptionBoundaryDataset
from caption_boundaries.data.transforms import ResizeStrategy
from caption_boundaries.database import Experiment, TrainingDataset, get_training_db
from caption_boundaries.models.architecture import create_model

console = Console(stderr=True)


class BalancedBatchSampler(Sampler):
    """Sampler that undersamples majority classes each epoch for training efficiency.

    Each epoch samples:
    - All samples from minority classes
    - Random subset from majority classes (controlled by ratio)
    - Different subset each epoch for better data coverage

    This improves training efficiency by reducing redundant majority class examples
    while ensuring the model still sees all data over multiple epochs.

    Args:
        dataset: CaptionBoundaryDataset to sample from
        majority_ratio: Max ratio of majority to minority class size (default: 3.0)
                       Higher = more majority samples per epoch (slower but more data)
                       Lower = fewer majority samples per epoch (faster but less data)

    Example:
        With minority class of 6,364 samples and ratio=3.0:
        - Minority classes: all 6,364 samples per epoch
        - Majority classes: max 19,092 samples per epoch (random subset)
    """

    def __init__(self, dataset: CaptionBoundaryDataset, majority_ratio: float = 3.0):
        self.dataset = dataset
        self.majority_ratio = majority_ratio

        # Group indices by label (access samples directly, don't call __getitem__)
        self.label_to_indices = defaultdict(list)
        for idx, sample in enumerate(dataset.samples):
            self.label_to_indices[sample.label].append(idx)

        # Find minority class size and set threshold
        self.class_sizes = {label: len(indices) for label, indices in self.label_to_indices.items()}
        self.min_class_size = min(self.class_sizes.values())
        self.max_samples_per_class = int(self.min_class_size * majority_ratio)

        # Calculate epoch size
        self.epoch_size = sum(
            min(len(indices), self.max_samples_per_class) for indices in self.label_to_indices.values()
        )

    def __iter__(self):
        """Sample indices for this epoch."""
        epoch_indices = []

        for label, indices in self.label_to_indices.items():
            if len(indices) <= self.max_samples_per_class:
                # Use all samples for minority/medium classes
                epoch_indices.extend(indices)
            else:
                # Random subset for majority classes (different each epoch!)
                epoch_indices.extend(random.sample(indices, self.max_samples_per_class))

        # Shuffle the combined indices
        random.shuffle(epoch_indices)
        return iter(epoch_indices)

    def __len__(self):
        return self.epoch_size


class CaptionBoundaryTrainer:
    """Trainer for caption boundary detection model.

    Handles training loop, validation, metrics tracking, and checkpointing.

    Args:
        dataset_id: Training dataset ID
        experiment_name: Name for this experiment (for W&B)
        training_db_path: Path to training database
        transform_strategy: Transform strategy for variable-sized crops
        ocr_viz_variant: OCR visualization variant to use
        use_font_embedding: Whether to use font embeddings
        epochs: Number of training epochs
        batch_size: Training batch size
        lr_features: Learning rate for feature extractor
        lr_classifier: Learning rate for classifier head
        device: Device to train on ('cuda', 'mps', 'cpu', or None for auto-detect)
        wandb_project: W&B project name
        checkpoint_dir: Directory to save checkpoints
        save_every_n_epochs: Save checkpoint every N epochs
        balanced_sampling: Whether to use balanced sampling
        sampling_ratio: Max ratio of majority to minority class size
    """

    def __init__(
        self,
        dataset_id: int,
        experiment_name: str,
        training_db_path: Path | None = None,
        transform_strategy: ResizeStrategy = ResizeStrategy.MIRROR_TILE,
        ocr_viz_variant: str = "boundaries",
        use_font_embedding: bool = True,
        epochs: int = 50,
        batch_size: int = 32,
        lr_features: float = 1e-3,
        lr_classifier: float = 1e-2,
        device: str | None = None,
        wandb_project: str = "caption-boundary-detection",
        checkpoint_dir: Path = Path("checkpoints"),
        save_every_n_epochs: int = 5,
        balanced_sampling: bool = True,
        sampling_ratio: float = 3.0,
    ):
        self.dataset_id = dataset_id
        self.experiment_name = experiment_name
        self.training_db_path = training_db_path
        self.transform_strategy = transform_strategy
        self.ocr_viz_variant = ocr_viz_variant
        self.use_font_embedding = use_font_embedding
        self.epochs = epochs
        self.batch_size = batch_size
        self.lr_features = lr_features
        self.lr_classifier = lr_classifier
        self.wandb_project = wandb_project
        # Organize checkpoints by experiment name
        self.checkpoint_dir = Path(checkpoint_dir) / experiment_name / "checkpoints"
        self.save_every_n_epochs = save_every_n_epochs

        # Balanced sampling configuration
        self.balanced_sampling = balanced_sampling
        self.sampling_ratio = sampling_ratio

        # Early stopping configuration
        self.early_stopping_patience = 5
        self.early_stopping_counter = 0
        self.early_stopping_min_delta = 1e-4

        # Auto-detect device
        if device is None:
            if torch.cuda.is_available():
                device = "cuda"
            elif torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"

        self.device = device
        console.print(f"[cyan]Using device:[/cyan] {self.device}")

        # Create checkpoint directory
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

        # Initialize components (lazy - will be created in train())
        self.model = None
        self.train_loader = None
        self.val_loader = None
        self.optimizer = None
        self.criterion = None
        self.experiment_id = None

    def _setup_datasets(self):
        """Set up train and validation datasets."""
        console.print("[cyan]Loading datasets...[/cyan]")

        # Train dataset
        self.train_dataset = CaptionBoundaryDataset(
            dataset_id=self.dataset_id,
            split="train",
            training_db_path=self.training_db_path,
            transform_strategy=self.transform_strategy,
        )

        # Val dataset
        self.val_dataset = CaptionBoundaryDataset(
            dataset_id=self.dataset_id,
            split="val",
            training_db_path=self.training_db_path,
            transform_strategy=self.transform_strategy,
        )

        # Adjust num_workers based on device (MPS has issues with multiprocessing)
        num_workers = 0 if self.device == "mps" else 4

        # Create train loader with optional balanced sampling
        if self.balanced_sampling:
            train_sampler = BalancedBatchSampler(self.train_dataset, majority_ratio=self.sampling_ratio)

            self.train_loader = DataLoader(
                self.train_dataset,
                batch_size=self.batch_size,
                sampler=train_sampler,  # Use balanced sampler instead of shuffle
                num_workers=num_workers,
                collate_fn=CaptionBoundaryDataset.collate_fn,
                pin_memory=(self.device == "cuda"),
            )

            # Log sampling statistics
            console.print(f"[cyan]Balanced sampling enabled (ratio={self.sampling_ratio}):[/cyan]")
            console.print(f"  Total train samples: {len(self.train_dataset)}")
            console.print(f"  Samples per epoch: {len(train_sampler)}")
            speedup = len(self.train_dataset) / len(train_sampler)
            console.print(f"  Speedup: {speedup:.2f}x faster epochs")

            # Show per-class sampling
            for label in range(len(CaptionBoundaryDataset.LABELS)):
                label_name = CaptionBoundaryDataset.LABELS[label]
                original_count = train_sampler.class_sizes.get(label, 0)
                sampled_count = min(original_count, train_sampler.max_samples_per_class)
                if original_count > 0:
                    pct = (sampled_count / original_count) * 100
                    console.print(f"    {label_name}: {sampled_count}/{original_count} ({pct:.0f}%)")
        else:
            self.train_loader = DataLoader(
                self.train_dataset,
                batch_size=self.batch_size,
                shuffle=True,
                num_workers=num_workers,
                collate_fn=CaptionBoundaryDataset.collate_fn,
                pin_memory=(self.device == "cuda"),
            )
            console.print(f"[green]✓[/green] Train samples: {len(self.train_dataset)}")

        # Val loader (no sampling - always use all validation data)
        self.val_loader = DataLoader(
            self.val_dataset,
            batch_size=self.batch_size,
            shuffle=False,
            num_workers=num_workers,
            collate_fn=CaptionBoundaryDataset.collate_fn,
            pin_memory=(self.device == "cuda"),
        )

        console.print(f"[green]✓[/green] Val samples: {len(self.val_dataset)}")

    def _compute_class_weights(self) -> torch.Tensor:
        """Compute class weights from training dataset to handle class imbalance.

        Uses inverse frequency weighting: weight = total_samples / class_count
        This ensures minority classes get higher loss contributions.

        Returns:
            Tensor of class weights for CrossEntropyLoss
        """
        from collections import Counter

        # Extract labels from training dataset
        labels = [self.train_dataset[i]["label"] for i in range(len(self.train_dataset))]
        label_counts = Counter(labels)

        # Compute weights: total_samples / class_count
        total_samples = len(labels)
        num_classes = len(label_counts)
        class_weights = torch.zeros(num_classes, dtype=torch.float32)

        for class_idx, count in label_counts.items():
            class_weights[class_idx] = total_samples / count

        # Move to device and log
        class_weights = class_weights.to(self.device)

        console.print("[cyan]Class weights (inverse frequency):[/cyan]")
        label_names = ["same", "different", "empty_empty", "empty_valid", "valid_empty"]
        for class_idx in range(num_classes):
            count = label_counts.get(class_idx, 0)
            weight = class_weights[class_idx].item()
            label_name = label_names[class_idx] if class_idx < len(label_names) else f"class_{class_idx}"
            console.print(f"  {label_name}: {count} samples, weight={weight:.2f}")

        return class_weights

    def _setup_model(self):
        """Initialize model, optimizer, and loss function."""
        console.print("[cyan]Initializing model...[/cyan]")

        self.model = create_model(device=self.device, pretrained=True)

        console.print(f"[green]✓[/green] Total params: {self.model.get_num_total_params():,}")
        console.print(f"[green]✓[/green] Trainable params: {self.model.get_num_trainable_params():,}")

        # Optimizer with different learning rates for different components
        # Higher LR for newly added classifier, lower LR for pretrained feature extractor
        param_groups = [
            {
                "params": [p for n, p in self.model.named_parameters() if "classifier" in n],
                "lr": self.lr_classifier,
                "name": "classifier",
            },
            {
                "params": [p for n, p in self.model.named_parameters() if "classifier" not in n],
                "lr": self.lr_features,
                "name": "features",
            },
        ]

        self.optimizer = optim.AdamW(param_groups)

        console.print(f"[cyan]Learning rates:[/cyan]")
        console.print(f"  Classifier: {self.lr_classifier:.2e}")
        console.print(f"  Features: {self.lr_features:.2e}")

        # Learning rate scheduler - reduce LR on plateau
        self.scheduler = optim.lr_scheduler.ReduceLROnPlateau(
            self.optimizer,
            mode="min",
            factor=0.5,
            patience=2,
            verbose=True,
        )

        # Compute class weights from training data to handle imbalance
        class_weights = self._compute_class_weights()

        # Loss function with class weighting (cross-entropy for multi-class classification)
        self.criterion = nn.CrossEntropyLoss(weight=class_weights)

    def _setup_wandb(self):
        """Initialize W&B tracking."""
        # Get dataset info for W&B config
        with next(get_training_db(self.training_db_path)) as db:
            dataset = db.query(TrainingDataset).filter(TrainingDataset.id == self.dataset_id).first()

            if not dataset:
                raise ValueError(f"Dataset {self.dataset_id} not found")

            config = {
                # Model config
                "model_architecture": "CaptionBoundaryPredictor",
                "num_classes": 5,
                "pretrained": True,
                # Training config
                "epochs": self.epochs,
                "batch_size": self.batch_size,
                "balanced_sampling": self.balanced_sampling,
                "sampling_ratio": self.sampling_ratio,
                "lr_features": self.lr_features,
                "lr_classifier": self.lr_classifier,
                "optimizer": "AdamW",
                # Data config
                "dataset_id": self.dataset_id,
                "dataset_name": dataset.name,
                "num_train_samples": len(self.train_dataset),
                "num_val_samples": len(self.val_dataset),
                "transform_strategy": self.transform_strategy.value,
                "ocr_viz_variant": self.ocr_viz_variant,
                "use_font_embedding": self.use_font_embedding,
                "split_strategy": dataset.split_strategy,
                "train_split_ratio": dataset.train_split_ratio,
                "random_seed": dataset.random_seed,
                # Hardware
                "device": self.device,
            }

            # Initialize W&B (store runs in local/models/caption_boundaries/wandb)
            wandb.init(
                project=self.wandb_project,
                name=self.experiment_name,
                config=config,
                dir="../../local/models/caption_boundaries/wandb",
                mode="online",  # Default to online reporting to wandb.ai
            )

            # Save W&B run ID for experiment tracking
            self.wandb_run_id = wandb.run.id

            console.print(f"[green]✓[/green] W&B initialized: {wandb.run.url}")

    def train_epoch(self, epoch: int) -> dict[str, float]:
        """Train for one epoch.

        Args:
            epoch: Current epoch number

        Returns:
            Dict with training metrics
        """
        self.model.train()
        total_loss = 0.0
        all_preds = []
        all_labels = []

        for batch in track(self.train_loader, description=f"Epoch {epoch}/{self.epochs}"):
            # Move batch to device
            ocr_viz = batch["ocr_viz"].to(self.device)
            frame1 = batch["frame1"].to(self.device)
            frame2 = batch["frame2"].to(self.device)
            spatial_features = batch["spatial_features"].to(self.device)
            font_embedding = batch["font_embedding"].to(self.device)
            labels = batch["label"].to(self.device)

            # Forward pass
            self.optimizer.zero_grad()
            logits = self.model(ocr_viz, frame1, frame2, spatial_features, font_embedding)

            # Compute loss
            loss = self.criterion(logits, labels)

            # Backward pass
            loss.backward()
            self.optimizer.step()

            # Track metrics
            total_loss += loss.item()
            preds = torch.argmax(logits, dim=1)
            all_preds.extend(preds.cpu().numpy())
            all_labels.extend(labels.cpu().numpy())

        # Compute epoch metrics
        avg_loss = total_loss / len(self.train_loader)
        accuracy = accuracy_score(all_labels, all_preds)
        f1_weighted = f1_score(all_labels, all_preds, average="weighted", zero_division=0)
        f1_macro = f1_score(all_labels, all_preds, average="macro", zero_division=0)

        return {
            "train/loss": avg_loss,
            "train/accuracy": accuracy,
            "train/f1_weighted": f1_weighted,
            "train/f1_macro": f1_macro,
        }

    def validate(self, epoch: int) -> dict[str, Any]:
        """Run validation.

        Args:
            epoch: Current epoch number

        Returns:
            Dict with validation metrics
        """
        self.model.eval()
        total_loss = 0.0
        all_preds = []
        all_labels = []

        with torch.no_grad():
            for batch in self.val_loader:
                # Move batch to device
                ocr_viz = batch["ocr_viz"].to(self.device)
                frame1 = batch["frame1"].to(self.device)
                frame2 = batch["frame2"].to(self.device)
                spatial_features = batch["spatial_features"].to(self.device)
                font_embedding = batch["font_embedding"].to(self.device)
                labels = batch["label"].to(self.device)

                # Forward pass
                logits = self.model(ocr_viz, frame1, frame2, spatial_features, font_embedding)

                # Compute loss
                loss = self.criterion(logits, labels)

                # Track metrics
                total_loss += loss.item()
                preds = torch.argmax(logits, dim=1)
                all_preds.extend(preds.cpu().numpy())
                all_labels.extend(labels.cpu().numpy())

        # Compute validation metrics
        avg_loss = total_loss / len(self.val_loader)
        accuracy = accuracy_score(all_labels, all_preds)
        f1_weighted = f1_score(all_labels, all_preds, average="weighted", zero_division=0)
        f1_macro = f1_score(all_labels, all_preds, average="macro", zero_division=0)

        # Confusion matrix
        cm = confusion_matrix(all_labels, all_preds)

        # Classification report (specify labels to handle missing classes in small datasets)
        class_report = classification_report(
            all_labels,
            all_preds,
            labels=list(range(len(CaptionBoundaryDataset.LABELS))),
            target_names=CaptionBoundaryDataset.LABELS,
            output_dict=True,
            zero_division=0,
        )

        metrics = {
            "val/loss": avg_loss,
            "val/accuracy": accuracy,
            "val/f1_weighted": f1_weighted,
            "val/f1_macro": f1_macro,
            "val/confusion_matrix": cm,
            "val/classification_report": class_report,
        }

        # Add per-class metrics for W&B logging
        for label_name in CaptionBoundaryDataset.LABELS:
            if label_name in class_report:
                metrics[f"val/precision_{label_name}"] = class_report[label_name]["precision"]
                metrics[f"val/recall_{label_name}"] = class_report[label_name]["recall"]
                metrics[f"val/f1_{label_name}"] = class_report[label_name]["f1-score"]

        # Log confusion matrix to W&B every 5 epochs
        if epoch % 5 == 0:
            wandb.log(
                {
                    "val/confusion_matrix_plot": wandb.plot.confusion_matrix(
                        probs=None,
                        y_true=all_labels,
                        preds=all_preds,
                        class_names=CaptionBoundaryDataset.LABELS,
                    )
                },
                step=epoch,
            )

        return metrics

    def save_checkpoint(self, epoch: int, metrics: dict, is_best: bool = False):
        """Save model checkpoint.

        Args:
            epoch: Current epoch
            metrics: Validation metrics
            is_best: Whether this is the best model so far
        """
        checkpoint = {
            "epoch": epoch,
            "model_state_dict": self.model.state_dict(),
            "optimizer_state_dict": self.optimizer.state_dict(),
            "metrics": metrics,
            "config": {
                "dataset_id": self.dataset_id,
                "transform_strategy": self.transform_strategy.value,
                "ocr_viz_variant": self.ocr_viz_variant,
                "use_font_embedding": self.use_font_embedding,
            },
        }

        # Save periodic checkpoint
        if epoch % self.save_every_n_epochs == 0:
            checkpoint_path = self.checkpoint_dir / f"checkpoint_epoch_{epoch}.pt"
            torch.save(checkpoint, checkpoint_path)
            console.print(f"[green]✓[/green] Saved checkpoint: {checkpoint_path}")

        # Save best checkpoint
        if is_best:
            best_path = self.checkpoint_dir / "best.pt"
            torch.save(checkpoint, best_path)
            console.print(f"[green]✓[/green] Saved best checkpoint: {best_path}")

            # Log to W&B
            wandb.run.summary["best_epoch"] = epoch
            wandb.run.summary["best_val_f1_macro"] = metrics["val/f1_macro"]
            wandb.run.summary["best_val_f1_weighted"] = metrics["val/f1_weighted"]
            wandb.run.summary["best_val_accuracy"] = metrics["val/accuracy"]

    def train(self):
        """Run full training loop."""
        console.print(f"\n[cyan]Starting training:[/cyan] {self.experiment_name}\n")

        # Setup
        self._setup_datasets()
        self._setup_model()
        self._setup_wandb()

        # Track best model (use macro F1 for imbalanced datasets)
        best_val_f1_macro = 0.0

        # Training loop
        for epoch in range(1, self.epochs + 1):
            # Train
            train_metrics = self.train_epoch(epoch)

            # Validate
            val_metrics = self.validate(epoch)

            # Combine metrics
            all_metrics = {**train_metrics, **val_metrics, "epoch": epoch}

            # Remove non-scalar metrics for W&B logging
            wandb_metrics = {
                k: v for k, v in all_metrics.items() if not isinstance(v, (np.ndarray, dict))
            }
            wandb.log(wandb_metrics, step=epoch)

            # Print progress
            console.print(
                f"\nEpoch {epoch}/{self.epochs} - "
                f"Train Loss: {train_metrics['train/loss']:.4f}, "
                f"Train F1 (macro): {train_metrics['train/f1_macro']:.4f} | "
                f"Val Loss: {val_metrics['val/loss']:.4f}, "
                f"Val F1 (macro): {val_metrics['val/f1_macro']:.4f}"
            )

            # Step learning rate scheduler based on validation loss
            self.scheduler.step(val_metrics["val/loss"])

            # Save checkpoint (use macro F1 for best model selection)
            is_best = val_metrics["val/f1_macro"] > best_val_f1_macro
            if is_best:
                best_val_f1_macro = val_metrics["val/f1_macro"]
                self.early_stopping_counter = 0  # Reset early stopping
            else:
                self.early_stopping_counter += 1

            self.save_checkpoint(epoch, val_metrics, is_best=is_best)

            # Early stopping check
            if self.early_stopping_counter >= self.early_stopping_patience:
                console.print(
                    f"\n[yellow]Early stopping triggered after {epoch} epochs "
                    f"(no improvement for {self.early_stopping_patience} epochs)[/yellow]"
                )
                break

        # Save final checkpoint
        final_path = self.checkpoint_dir / "final.pt"
        torch.save(
            {
                "epoch": self.epochs,
                "model_state_dict": self.model.state_dict(),
                "optimizer_state_dict": self.optimizer.state_dict(),
                "metrics": val_metrics,
            },
            final_path,
        )

        # Save experiment to database
        self._save_experiment_to_db(best_val_f1_macro, val_metrics["val/accuracy"])

        # Finish W&B
        wandb.finish()

        console.print(f"\n[green]✓ Training complete![/green]")
        console.print(f"Best Val F1: {best_val_f1:.4f}")
        console.print(f"Checkpoints saved to: {self.checkpoint_dir}")

    def _save_experiment_to_db(self, best_val_f1: float, best_val_accuracy: float):
        """Save experiment metadata to database."""
        with next(get_training_db(self.training_db_path)) as db:
            # Get git info if available
            try:
                import subprocess

                git_commit = subprocess.check_output(["git", "rev-parse", "HEAD"]).decode("ascii").strip()
                git_branch = subprocess.check_output(["git", "rev-parse", "--abbrev-ref", "HEAD"]).decode("ascii").strip()
            except Exception:
                git_commit = None
                git_branch = None

            experiment = Experiment(
                name=self.experiment_name,
                dataset_id=self.dataset_id,
                wandb_run_id=self.wandb_run_id,
                wandb_project=self.wandb_project,
                model_architecture={"type": "CaptionBoundaryPredictor", "pretrained": True},
                hyperparameters={
                    "epochs": self.epochs,
                    "batch_size": self.batch_size,
                    "learning_rate": self.learning_rate,
                    "optimizer": "AdamW",
                },
                transform_strategy=self.transform_strategy.value,
                ocr_visualization_variant=self.ocr_viz_variant,
                use_font_embedding=self.use_font_embedding,
                best_val_f1=best_val_f1,
                best_val_accuracy=best_val_accuracy,
                best_checkpoint_path=str(self.checkpoint_dir / "best.pt"),
                final_checkpoint_path=str(self.checkpoint_dir / "final.pt"),
                git_commit=git_commit,
                git_branch=git_branch,
            )

            from datetime import UTC, datetime

            experiment.completed_at = datetime.now(UTC)

            db.add(experiment)
            db.commit()
            db.refresh(experiment)

            self.experiment_id = experiment.id
            console.print(f"[green]✓[/green] Experiment saved to database (ID: {experiment.id})")
