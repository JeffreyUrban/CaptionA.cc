"""Batch predictor for caption frame extents inference.

Adapted from CaptionFrameExtentsPredictor to work with extracted frames (not database frames).
Optimized for Modal GPU inference on full videos.
"""

import sqlite3
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image as PILImage
from rich.console import Console

from caption_frame_extents.data.dataset import CaptionFrameExtentsDataset
from caption_frame_extents.data.transforms import AnchorAwareResize, NormalizeImageNet, ResizeStrategy
from caption_frame_extents.models.registry import create_model

console = Console(stderr=True)


class BatchCaptionFrameExtentsPredictor:
    """Predicts caption frame extents using trained model with batch inference support.

    Designed for Modal GPU inference where frames are extracted from VP9 chunks
    rather than loaded from a database.

    Args:
        checkpoint_path: Path to trained model checkpoint
        layout_db_path: Path to layout.db (for OCR viz and spatial metadata)
        device: Device to run inference on ('cuda', 'mps', 'cpu', or None for auto)
    """

    def __init__(
        self,
        checkpoint_path: Path,
        layout_db_path: Path,
        device: str | None = None,
    ):
        self.checkpoint_path = Path(checkpoint_path)
        self.layout_db_path = Path(layout_db_path)

        # Auto-detect device
        if device is None:
            if torch.cuda.is_available():
                device = "cuda"
            elif torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"
        self.device = device

        # Load checkpoint
        console.print(f"[cyan]Loading checkpoint:[/cyan] {checkpoint_path.name}")
        checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)

        # Extract config
        config = checkpoint.get("config", {})
        self.architecture_name = config.get("architecture_name", "triple_backbone_resnet50")
        self.model_config = config.get("model_config", {"pretrained": False})
        self.transform_strategy = ResizeStrategy(config.get("transform_strategy", "mirror_tile"))
        self.ocr_viz_variant = config.get("ocr_visualization_variant", "boundaries")

        # Load model from registry
        self.model = create_model(
            architecture=self.architecture_name,
            device=device,
            **self.model_config,
        )
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.eval()

        # Create transforms
        self.resize_transform = AnchorAwareResize(
            target_width=480,
            target_height=48,
            strategy=self.transform_strategy,
        )
        self.normalize_transform = NormalizeImageNet()

        # Label mapping
        self.labels = CaptionFrameExtentsDataset.LABELS
        self.label_to_idx = {label: idx for idx, label in enumerate(self.labels)}

        # Load layout metadata and OCR visualization
        self._load_layout_metadata()

        console.print(f"[green]✓ Model loaded on {device}[/green]")
        console.print(f"  Transform: {self.transform_strategy.value}")
        console.print(f"  OCR viz: {self.ocr_viz_variant}")
        console.print(f"  Anchor: {self.anchor_type}")

    def _load_layout_metadata(self):
        """Load OCR visualization and spatial metadata from layout.db."""
        conn = sqlite3.connect(self.layout_db_path)
        cursor = conn.cursor()

        # Get layout config
        cursor.execute("""
            SELECT anchor_type, crop_left, crop_top, crop_right, crop_bottom,
                   frame_width, frame_height, ocr_visualization_image
            FROM video_layout_config LIMIT 1
        """)

        layout = cursor.fetchone()
        conn.close()

        if not layout:
            raise ValueError(f"No layout config found in {self.layout_db_path}")

        (
            self.anchor_type,
            self.crop_left,
            self.crop_top,
            self.crop_right,
            self.crop_bottom,
            self.frame_width,
            self.frame_height,
            ocr_viz_blob,
        ) = layout

        if not ocr_viz_blob:
            raise ValueError("OCR visualization not found in layout.db")

        # Load OCR visualization from blob
        self.ocr_viz_img = PILImage.open(BytesIO(ocr_viz_blob))

        # Precompute spatial features (same for all frames in this video)
        self._precompute_spatial_features()

        console.print(f"[green]✓ Loaded layout metadata from {self.layout_db_path.name}[/green]")

    def _precompute_spatial_features(self):
        """Precompute spatial features (same for all frames in video)."""
        # Anchor type encoding (one-hot)
        anchor_encoding = {
            "left": [1.0, 0.0, 0.0],
            "center": [0.0, 1.0, 0.0],
            "right": [0.0, 0.0, 1.0],
        }.get(self.anchor_type, [0.0, 1.0, 0.0])

        # Compute normalized position and size
        crop_width = self.crop_right - self.crop_left

        x_center = (self.crop_left + self.crop_right) / 2
        y_center = (self.crop_top + self.crop_bottom) / 2

        x_norm = x_center / self.frame_width if self.frame_width > 0 else 0.5
        y_norm = y_center / self.frame_height if self.frame_height > 0 else 0.9
        w_norm = crop_width / self.frame_width if self.frame_width > 0 else 0.5

        # Combine into feature vector [anchor_encoding(3), x_norm, y_norm, w_norm]
        self.spatial_features = anchor_encoding + [x_norm, y_norm, w_norm]

    @torch.no_grad()
    def predict_frame_pair(
        self,
        frame1_img: PILImage.Image,
        frame2_img: PILImage.Image,
    ) -> dict[str, Any]:
        """Predict caption frame extents classification for a single frame pair.

        Args:
            frame1_img: PIL Image of first frame (cropped)
            frame2_img: PIL Image of second frame (cropped)

        Returns:
            Dict with prediction results:
                - predicted_label: str
                - probabilities: dict[str, float] (all 5 class probabilities)
                - confidence: float (max probability)
        """
        # Apply transforms
        ocr_viz = self.resize_transform(self.ocr_viz_img, anchor_type=self.anchor_type)
        ocr_viz = self.normalize_transform(ocr_viz)
        ocr_viz = torch.from_numpy(ocr_viz)

        frame1 = self.resize_transform(frame1_img, anchor_type=self.anchor_type)
        frame1 = self.normalize_transform(frame1)
        frame1 = torch.from_numpy(frame1)

        frame2 = self.resize_transform(frame2_img, anchor_type=self.anchor_type)
        frame2 = self.normalize_transform(frame2)
        frame2 = torch.from_numpy(frame2)

        spatial = torch.tensor(self.spatial_features, dtype=torch.float32)

        # Add batch dimension and move to device
        ocr_viz = ocr_viz.unsqueeze(0).to(self.device)
        frame1 = frame1.unsqueeze(0).to(self.device)
        frame2 = frame2.unsqueeze(0).to(self.device)
        spatial = spatial.unsqueeze(0).to(self.device)

        # Forward pass
        logits = self.model(ocr_viz, frame1, frame2, spatial)
        probs = torch.softmax(logits, dim=1).cpu().numpy()[0]

        # Get prediction
        pred_idx = int(np.argmax(probs))
        predicted_label = self.labels[pred_idx]

        return {
            "predicted_label": predicted_label,
            "probabilities": {label: float(probs[idx]) for idx, label in enumerate(self.labels)},
            "confidence": float(probs[pred_idx]),
        }

    def predict_batch(
        self,
        frame_pairs: list[tuple[PILImage.Image, PILImage.Image]],
        batch_size: int = 32,
    ) -> list[dict[str, Any]]:
        """Predict caption frame extents for batch of frame pairs.

        Args:
            frame_pairs: List of (frame1, frame2) PIL Image tuples
            batch_size: Batch size for inference

        Returns:
            List of prediction dicts (same order as input)
        """
        results = []

        console.print(f"[cyan]Running batch inference on {len(frame_pairs)} pairs...[/cyan]")

        # Process in batches
        for i in range(0, len(frame_pairs), batch_size):
            batch = frame_pairs[i : i + batch_size]

            # Prepare batch tensors
            ocr_viz_batch = []
            frame1_batch = []
            frame2_batch = []
            spatial_batch = []

            for frame1_img, frame2_img in batch:
                # Transform OCR viz
                ocr_viz = self.resize_transform(self.ocr_viz_img, anchor_type=self.anchor_type)
                ocr_viz = self.normalize_transform(ocr_viz)
                ocr_viz = torch.from_numpy(ocr_viz)
                ocr_viz_batch.append(ocr_viz)

                # Transform frame1
                frame1 = self.resize_transform(frame1_img, anchor_type=self.anchor_type)
                frame1 = self.normalize_transform(frame1)
                frame1 = torch.from_numpy(frame1)
                frame1_batch.append(frame1)

                # Transform frame2
                frame2 = self.resize_transform(frame2_img, anchor_type=self.anchor_type)
                frame2 = self.normalize_transform(frame2)
                frame2 = torch.from_numpy(frame2)
                frame2_batch.append(frame2)

                # Spatial features (same for all)
                spatial = torch.tensor(self.spatial_features, dtype=torch.float32)
                spatial_batch.append(spatial)

            # Stack into batch tensors
            ocr_viz_tensor = torch.stack(ocr_viz_batch).to(self.device)
            frame1_tensor = torch.stack(frame1_batch).to(self.device)
            frame2_tensor = torch.stack(frame2_batch).to(self.device)
            spatial_tensor = torch.stack(spatial_batch).to(self.device)

            # Forward pass
            with torch.no_grad():
                logits = self.model(ocr_viz_tensor, frame1_tensor, frame2_tensor, spatial_tensor)
                probs = torch.softmax(logits, dim=1).cpu().numpy()

            # Extract predictions
            for _j, prob_dist in enumerate(probs):
                pred_idx = int(np.argmax(prob_dist))
                predicted_label = self.labels[pred_idx]

                result = {
                    "predicted_label": predicted_label,
                    "probabilities": {label: float(prob_dist[idx]) for idx, label in enumerate(self.labels)},
                    "confidence": float(prob_dist[pred_idx]),
                }
                results.append(result)

            # Progress logging
            if (i + batch_size) % 1000 == 0 or i + batch_size >= len(frame_pairs):
                console.print(f"  Processed {min(i + batch_size, len(frame_pairs))}/{len(frame_pairs)} pairs")

        console.print("[green]✓ Batch inference complete[/green]")
        return results
