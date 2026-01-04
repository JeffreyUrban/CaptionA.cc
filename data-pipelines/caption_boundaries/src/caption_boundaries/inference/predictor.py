"""Inference pipeline for caption boundary detection.

Loads trained models and predicts boundaries on new videos.
"""

from pathlib import Path
from typing import Any, Literal

import numpy as np
import torch
from rich.console import Console

from caption_boundaries.data.dataset import CaptionBoundaryDataset
from caption_boundaries.data.transforms import AnchorAwareResize, NormalizeImageNet, ResizeStrategy
from caption_boundaries.models.registry import create_model

console = Console(stderr=True)


class BoundaryPredictor:
    """Predicts caption boundaries using trained model.

    Args:
        checkpoint_path: Path to trained model checkpoint (.pt file)
        device: Device to run inference on ('cuda', 'mps', 'cpu', or None for auto-detect)
        transform_strategy: Transform strategy used during training
        ocr_viz_variant: OCR visualization variant used during training
    """

    def __init__(
        self,
        checkpoint_path: Path,
        device: str | None = None,
        transform_strategy: ResizeStrategy | None = None,
        ocr_viz_variant: str | None = None,
    ):
        self.checkpoint_path = Path(checkpoint_path)

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
        console.print(f"[cyan]Loading checkpoint:[/cyan] {checkpoint_path}")
        checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)

        # Extract config from checkpoint
        config = checkpoint.get("config", {})
        self.architecture_name = config.get("architecture_name", "triple_backbone_resnet50")
        self.model_config = config.get("model_config", {"pretrained": False})
        self.transform_strategy = transform_strategy or ResizeStrategy(config.get("transform_strategy", "mirror_tile"))
        self.ocr_viz_variant = ocr_viz_variant or config.get("ocr_visualization_variant", "boundaries")

        # OCR visualization will be loaded per-video (not at init time)
        self.ocr_viz_img = None

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
        self.labels = CaptionBoundaryDataset.LABELS
        self.label_to_idx = {label: idx for idx, label in enumerate(self.labels)}

        console.print(f"[green]✓[/green] Model loaded on {device}")
        console.print(f"[green]✓[/green] Transform: {self.transform_strategy.value}")
        console.print(f"[green]✓[/green] OCR viz: {self.ocr_viz_variant}")

    @torch.no_grad()
    def predict_frame_pair(
        self,
        video_db_path: Path,
        frame1_index: int,
        frame2_index: int,
        anchor_type: Literal["left", "center", "right"] = "center",
    ) -> dict[str, Any]:
        """Predict boundary classification for a single frame pair.

        Args:
            video_db_path: Path to video's annotations.db
            frame1_index: Index of first frame
            frame2_index: Index of second frame
            anchor_type: Caption anchor type ('left', 'center', 'right')

        Returns:
            Dict with prediction results:
                - predicted_label: str
                - probabilities: dict[str, float]
                - confidence: float (max probability)
        """
        # Load frames from database
        from frames_db import get_frame_from_db

        frame1_data = get_frame_from_db(video_db_path, frame1_index, table="cropped_frames")
        frame2_data = get_frame_from_db(video_db_path, frame2_index, table="cropped_frames")

        if frame1_data is None:
            raise ValueError(f"Frame {frame1_index} not found in {video_db_path}")
        if frame2_data is None:
            raise ValueError(f"Frame {frame2_index} not found in {video_db_path}")

        # Convert FrameData to PIL Images
        frame1_img = frame1_data.to_pil_image()
        frame2_img = frame2_data.to_pil_image()

        # OCR visualization is loaded once per video in __init__, use the cached version
        ocr_viz_img = self.ocr_viz_img
        if ocr_viz_img is None:
            raise ValueError("OCR visualization not loaded. Call load_ocr_visualization() first.")

        # Get spatial metadata
        from caption_boundaries.data.dataset import _get_spatial_features

        spatial_features = _get_spatial_features(video_db_path, frame1_index, frame2_index)
        spatial_features = torch.tensor(spatial_features, dtype=torch.float32)

        # Apply transforms
        ocr_viz = self.resize_transform(ocr_viz_img, anchor_type=anchor_type)
        ocr_viz = self.normalize_transform(ocr_viz)
        ocr_viz = torch.from_numpy(ocr_viz)  # Convert numpy to tensor

        frame1 = self.resize_transform(frame1_img, anchor_type=anchor_type)
        frame1 = self.normalize_transform(frame1)
        frame1 = torch.from_numpy(frame1)  # Convert numpy to tensor

        frame2 = self.resize_transform(frame2_img, anchor_type=anchor_type)
        frame2 = self.normalize_transform(frame2)
        frame2 = torch.from_numpy(frame2)  # Convert numpy to tensor

        # Add batch dimension and move to device
        ocr_viz = ocr_viz.unsqueeze(0).to(self.device)
        frame1 = frame1.unsqueeze(0).to(self.device)
        frame2 = frame2.unsqueeze(0).to(self.device)
        spatial_features = spatial_features.unsqueeze(0).to(self.device)

        # Forward pass
        logits = self.model(ocr_viz, frame1, frame2, spatial_features)
        probs = torch.softmax(logits, dim=1).cpu().numpy()[0]

        # Get prediction
        pred_idx = int(np.argmax(probs))
        predicted_label = self.labels[pred_idx]

        return {
            "predicted_label": predicted_label,
            "probabilities": {label: float(probs[idx]) for idx, label in enumerate(self.labels)},
            "confidence": float(probs[pred_idx]),
        }

    def predict_video_boundaries(
        self,
        video_db_path: Path,
        confidence_threshold: float = 0.8,
        return_all_transitions: bool = False,
    ) -> list[dict[str, Any]]:
        """Predict all caption boundaries in a video.

        Analyzes consecutive confirmed caption frames to detect boundaries.

        Args:
            video_db_path: Path to video's annotations.db
            confidence_threshold: Minimum confidence for predictions
            return_all_transitions: If True, return all frame transitions (not just boundaries)

        Returns:
            List of predicted boundaries with metadata
        """
        # Convert to absolute path to avoid issues with relative paths
        from pathlib import Path

        from caption_boundaries.data.dataset import _get_video_metadata

        video_db_path = Path(video_db_path).resolve()

        # Get video metadata and confirmed captions
        _get_video_metadata(video_db_path)

        # Get all confirmed captions sorted by time
        import sqlite3

        conn = sqlite3.connect(video_db_path)
        cursor = conn.cursor()

        # Get anchor type and OCR visualization from video layout config
        cursor.execute("SELECT anchor_type, ocr_visualization_image FROM video_layout_config WHERE id = 1")
        layout_result = cursor.fetchone()
        if not layout_result or not layout_result[0]:
            raise ValueError("anchor_type not found in video_layout_config")
        anchor_type = layout_result[0]
        ocr_viz_blob = layout_result[1]

        if not ocr_viz_blob:
            raise ValueError("ocr_visualization_image not found in video_layout_config")

        # Load OCR visualization image from blob
        import io

        from PIL import Image as PILImage

        self.ocr_viz_img = PILImage.open(io.BytesIO(ocr_viz_blob))

        # Get confirmed caption segments (exclude 'issue' state - not clean boundaries)
        cursor.execute("""
            SELECT start_frame_index, end_frame_index
            FROM captions
            WHERE boundary_state = 'confirmed' AND boundary_state != 'issue'
            ORDER BY start_frame_index
        """)
        confirmed_captions = cursor.fetchall()
        conn.close()

        # Convert caption segments to frame pairs for boundary detection
        # We check the boundary between end of one caption and start of next
        confirmed_frames = []
        for _start_idx, end_idx in confirmed_captions:
            # Add end frame as a transition point
            confirmed_frames.append((end_idx, anchor_type))

        if len(confirmed_frames) < 2:
            console.print("[yellow]⚠[/yellow] Less than 2 confirmed captions found")
            return []

        console.print(f"[cyan]Analyzing {len(confirmed_frames)} confirmed captions...[/cyan]")

        # Predict for consecutive frame pairs
        predictions = []
        boundaries = []

        for i in range(len(confirmed_frames) - 1):
            frame1_index, anchor1 = confirmed_frames[i]
            frame2_index, anchor2 = confirmed_frames[i + 1]

            # Use anchor type from first frame
            anchor_type = anchor1 or "center"

            # Predict
            result = self.predict_frame_pair(video_db_path, frame1_index, frame2_index, anchor_type=anchor_type)

            result.update(
                {
                    "frame1_index": frame1_index,
                    "frame2_index": frame2_index,
                    "anchor_type": anchor_type,
                }
            )

            predictions.append(result)

            # Check if this is a boundary (different or valid_empty or empty_valid)
            is_boundary = result["predicted_label"] in ("different", "valid_empty", "empty_valid")
            is_high_confidence = result["confidence"] >= confidence_threshold

            if is_boundary and is_high_confidence:
                boundaries.append(result)

        console.print(f"[green]✓[/green] Found {len(boundaries)} high-confidence boundaries")

        if return_all_transitions:
            return predictions
        else:
            return boundaries

    def predict_with_quality_checks(
        self,
        video_db_path: Path,
        confidence_threshold: float = 0.8,
        ocr_confidence_min: float = 0.7,
    ) -> dict[str, Any]:
        """Predict boundaries with quality checks.

        Args:
            video_db_path: Path to video's annotations.db
            confidence_threshold: Minimum model confidence
            ocr_confidence_min: Minimum OCR confidence

        Returns:
            Dict with predictions and quality metrics
        """
        from caption_boundaries.inference.quality_checks import run_quality_checks

        # Get predictions
        boundaries = self.predict_video_boundaries(
            video_db_path,
            confidence_threshold=confidence_threshold,
            return_all_transitions=False,
        )

        # Run quality checks
        quality_results = run_quality_checks(
            video_db_path,
            boundaries,
            ocr_confidence_min=ocr_confidence_min,
        )

        return {
            "boundaries": boundaries,
            "quality": quality_results,
            "num_boundaries": len(boundaries),
            "num_flagged": len(quality_results.get("flagged_boundaries", [])),
        }
