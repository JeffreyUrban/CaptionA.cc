"""PyTorch dataset for caption frame extents detection training.

Loads frame pairs, OCR visualizations, and metadata for training the caption frame extents predictor.
"""

import sqlite3
import subprocess
from pathlib import Path
from typing import Literal

import numpy as np
import torch
from PIL import Image
from torch.utils.data import Dataset

from caption_frame_extents.data.transforms import (
    AnchorAwareResize,
    NormalizeImageNet,
    ResizeStrategy,
)
from caption_frame_extents.database import TrainingDataset, TrainingSample


def get_git_root() -> Path:
    """Get the git repository root directory.

    Returns:
        Path to git repository root

    Raises:
        RuntimeError: If not in a git repository
    """
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
        )
        return Path(result.stdout.strip())
    except subprocess.CalledProcessError as e:
        raise RuntimeError("Not in a git repository") from e


class CaptionFrameExtentsDataset(Dataset):
    """PyTorch dataset for caption frame extents detection.

    Loads consecutive frame pairs with their OCR visualizations and metadata
    from a self-contained dataset database.

    Each sample contains:
    - OCR box visualization (from training_ocr_visualizations table)
    - Frame 1 (cropped caption at time t, from training_frames table)
    - Frame 2 (cropped caption at time t+1, from training_frames table)
    - Spatial metadata (anchor_type, position, size)
    - Reference frame image (for CLIP encoding, from training_frames table)
    - Label (5-way classification)

    Args:
        dataset_db_path: Path to dataset database file
        split: Which split to load ('train', 'val', or 'test')
        transform_strategy: Resize strategy for variable-sized crops
        target_width: Target width for frame crops (default: 480)
        target_height: Target height for frame crops (default: 48)

    Example:
        >>> from caption_frame_extents.database import get_dataset_db_path
        >>> dataset_path = get_dataset_db_path("production_v1")
        >>> dataset = CaptionFrameExtentsDataset(
        ...     dataset_db_path=dataset_path,
        ...     split='train',
        ...     transform_strategy=ResizeStrategy.MIRROR_TILE
        ... )
        >>> sample = dataset[0]
        >>> print(sample.keys())
        dict_keys(['ocr_viz', 'frame1', 'frame2', 'spatial_features',
                   'reference_image', 'label'])
    """

    # Label encoding
    LABELS = ["same", "different", "empty_empty", "empty_valid", "valid_empty"]
    LABEL_TO_IDX = {label: idx for idx, label in enumerate(LABELS)}

    def __init__(
        self,
        dataset_db_path: Path,
        split: Literal["train", "val", "test"],
        transform_strategy: ResizeStrategy = ResizeStrategy.MIRROR_TILE,
        target_width: int = 480,
        target_height: int = 48,
    ):
        self.dataset_db_path = dataset_db_path
        self.split = split
        self.transform_strategy = transform_strategy
        self.target_width = target_width
        self.target_height = target_height

        # Create persistent database session for data loading
        # This avoids opening a new connection for every sample
        from caption_frame_extents.database import create_dataset_session

        self._db_session = create_dataset_session(dataset_db_path)

        # Load samples from database
        self.samples = self._load_samples()

        # Initialize transforms
        self.resize_transform = AnchorAwareResize(
            target_width=target_width,
            target_height=target_height,
            strategy=transform_strategy,
        )
        self.normalize = NormalizeImageNet()

        # Cache for spatial metadata
        self._spatial_metadata_cache = {}

    def __del__(self):
        """Clean up database session when dataset is destroyed."""
        if hasattr(self, "_db_session"):
            self._db_session.close()

    def _load_samples(self) -> list[TrainingSample]:
        """Load training samples from database for this split.

        Returns:
            List of TrainingSample objects (only complete samples with all required data)

        Raises:
            ValueError: If no samples found for split
        """

        # Get dataset to verify it exists
        dataset = self._db_session.query(TrainingDataset).first()
        if not dataset:
            raise ValueError(f"No dataset found in {self.dataset_db_path}")

        # Load samples for this split
        all_samples = (
            self._db_session.query(TrainingSample)
            .filter(TrainingSample.split == self.split)
            .all()
        )

        if not all_samples:
            raise ValueError(
                f"No {self.split} samples found in dataset '{dataset.name}'"
            )

        # Filter to only complete samples (all required data exists)
        valid_samples = []
        missing_stats = {
            "frame1": 0,
            "frame2": 0,
            "ocr_viz": 0,
        }

        for sample in all_samples:
            # Check if all required data exists
            if self._is_complete_sample(sample, missing_stats):
                valid_samples.append(sample)

        # Detach from session (make transient)
        for sample in valid_samples:
            self._db_session.expunge(sample)

        incomplete_count = len(all_samples) - len(valid_samples)
        if incomplete_count > 0:
            incomplete_pct = incomplete_count / len(all_samples) * 100
            print(
                f"⚠️  Excluded {incomplete_count}/{len(all_samples)} incomplete samples "
                f"from {self.split} split ({incomplete_pct:.1f}%)"
            )
            print("   Missing data breakdown:")
            for key, count in missing_stats.items():
                if count > 0:
                    print(f"   - {key}: {count} samples")

        if not valid_samples:
            raise ValueError(
                f"No complete {self.split} samples found in dataset '{dataset.name}'"
            )

        return valid_samples

    def _is_complete_sample(
        self, sample: TrainingSample, missing_stats: dict | None = None
    ) -> bool:
        """Check if a sample has all required data.

        Note: Reference frame check removed since we now fallback to frame1 if missing.

        Args:
            sample: Training sample to validate
            missing_stats: Optional dict to track what's missing (for diagnostics)

        Returns:
            True if all required data exists, False otherwise
        """
        from caption_frame_extents.database import (
            TrainingFrame,
            TrainingOCRVisualization,
        )

        # Check frame1 exists (also serves as fallback reference frame)
        frame1 = (
            self._db_session.query(TrainingFrame)
            .filter(
                TrainingFrame.video_hash == sample.video_hash,
                TrainingFrame.frame_index == sample.frame1_index,
            )
            .first()
        )
        if not frame1:
            if missing_stats is not None:
                missing_stats["frame1"] += 1
            return False

        # Check frame2 exists
        frame2 = (
            self._db_session.query(TrainingFrame)
            .filter(
                TrainingFrame.video_hash == sample.video_hash,
                TrainingFrame.frame_index == sample.frame2_index,
            )
            .first()
        )
        if not frame2:
            if missing_stats is not None:
                missing_stats["frame2"] += 1
            return False

        # Check OCR visualization exists
        ocr_viz = (
            self._db_session.query(TrainingOCRVisualization)
            .filter(TrainingOCRVisualization.video_hash == sample.video_hash)
            .first()
        )
        if not ocr_viz:
            if missing_stats is not None:
                missing_stats["ocr_viz"] += 1
            return False

        return True

    def __len__(self) -> int:
        """Return number of samples in dataset."""
        return len(self.samples)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor | int]:
        """Get a single training sample.

        Args:
            idx: Sample index

        Returns:
            Dictionary containing:
            - ocr_viz: Tensor of shape (C, H, W) - OCR box visualization
            - frame1: Tensor of shape (C, H, W) - First frame
            - frame2: Tensor of shape (C, H, W) - Second frame
            - spatial_features: Tensor of shape (6,) - Spatial metadata
            - label: Integer label (0-4)
            - sample_id: Database ID of sample (for debugging)
        """
        sample = self.samples[idx]

        # Load frames from dataset database
        frame1_image = self._load_frame(sample.video_hash, sample.frame1_index)
        frame2_image = self._load_frame(sample.video_hash, sample.frame2_index)

        # Load OCR visualization from dataset database
        ocr_viz_image = self._load_ocr_visualization(sample.video_hash)

        # Get spatial metadata
        spatial_features = self._get_spatial_metadata(sample.video_hash)

        # Apply transforms
        # Get anchor type from spatial metadata
        anchor_type = self._get_anchor_type(spatial_features)

        frame1 = self.resize_transform(frame1_image, anchor_type)
        frame2 = self.resize_transform(frame2_image, anchor_type)
        ocr_viz = self.resize_transform(ocr_viz_image, anchor_type)

        # Normalize to tensors
        frame1_tensor = torch.from_numpy(self.normalize(frame1))
        frame2_tensor = torch.from_numpy(self.normalize(frame2))
        ocr_viz_tensor = torch.from_numpy(self.normalize(ocr_viz))

        # Convert spatial features to tensor
        spatial_tensor = torch.tensor(spatial_features, dtype=torch.float32)

        # Encode label
        label_idx = self.LABEL_TO_IDX[sample.label]

        return {
            "ocr_viz": ocr_viz_tensor,
            "frame1": frame1_tensor,
            "frame2": frame2_tensor,
            "spatial_features": spatial_tensor,
            "label": label_idx,
            "sample_id": sample.id,
        }

    def _load_frame(self, video_hash: str, frame_index: int) -> Image.Image:
        """Load frame from dataset database.

        Args:
            video_hash: Video hash
            frame_index: Frame index to load

        Returns:
            PIL Image of frame

        Raises:
            ValueError: If frame not found in database
        """
        from io import BytesIO

        from caption_frame_extents.database import TrainingFrame

        frame = (
            self._db_session.query(TrainingFrame)
            .filter(
                TrainingFrame.video_hash == video_hash,
                TrainingFrame.frame_index == frame_index,
            )
            .first()
        )

        if not frame:
            raise ValueError(
                f"Frame {frame_index} for video {video_hash[:8]}... not found in dataset"
            )

        return Image.open(BytesIO(frame.image_data))

    def _load_ocr_visualization(self, video_hash: str) -> Image.Image:
        """Load OCR visualization from dataset database.

        Args:
            video_hash: Video hash

        Returns:
            PIL Image of OCR visualization

        Raises:
            ValueError: If OCR visualization not found in database
        """
        from io import BytesIO

        from caption_frame_extents.database import TrainingOCRVisualization

        ocr_viz = (
            self._db_session.query(TrainingOCRVisualization)
            .filter(TrainingOCRVisualization.video_hash == video_hash)
            .first()
        )

        if not ocr_viz:
            raise ValueError(
                f"OCR visualization for video {video_hash[:8]}... not found in dataset"
            )

        img = Image.open(BytesIO(ocr_viz.image_data))
        return img.convert("RGB")  # Ensure RGB, remove alpha channel if present

    def _get_spatial_metadata(self, video_hash: str) -> np.ndarray:
        """Get spatial metadata for video.

        Returns 6-dimensional feature vector:
        - anchor_type: 0=left, 0.5=center, 1=right
        - vertical_position: Normalized y position (0-1)
        - vertical_std: Normalized standard deviation
        - caption_height: Normalized height (0-1)
        - caption_width: Normalized width (0-1)
        - anchor_position: Normalized x position (0-1)

        Args:
            video_hash: Video hash

        Returns:
            Numpy array of shape (6,) with spatial features

        TODO: Implement actual spatial metadata loading from video_layout_config table
        """
        if video_hash in self._spatial_metadata_cache:
            return self._spatial_metadata_cache[video_hash]

        # TODO: Load from video_layout_config table
        # For now, return dummy features (centered captions)
        features = np.array([0.5, 0.9, 0.01, 0.1, 1.0, 0.5], dtype=np.float32)

        self._spatial_metadata_cache[video_hash] = features
        return features

    def _get_anchor_type(
        self, spatial_features: np.ndarray
    ) -> Literal["left", "center", "right"]:
        """Extract anchor type from spatial features.

        Args:
            spatial_features: Spatial feature vector

        Returns:
            Anchor type string
        """
        # First feature is anchor_type encoding
        anchor_value = spatial_features[0]

        if anchor_value < 0.33:
            return "left"
        elif anchor_value < 0.67:
            return "center"
        else:
            return "right"

    @staticmethod
    def collate_fn(batch: list[dict]) -> dict[str, torch.Tensor | list]:
        """Collate function for DataLoader.

        Args:
            batch: List of sample dictionaries from __getitem__

        Returns:
            Batched dictionary with stacked tensors (sample_id is kept as list for debugging)
        """
        return {
            "ocr_viz": torch.stack([s["ocr_viz"] for s in batch]),
            "frame1": torch.stack([s["frame1"] for s in batch]),
            "frame2": torch.stack([s["frame2"] for s in batch]),
            "spatial_features": torch.stack([s["spatial_features"] for s in batch]),
            "label": torch.tensor([s["label"] for s in batch], dtype=torch.long),
            "sample_id": [s["sample_id"] for s in batch],  # Keep as list for debugging
        }


# Helper functions for inference


def _get_video_metadata(video_db_path: Path) -> dict:
    """Get video metadata from annotations database.

    Args:
        video_db_path: Path to video's captions.db

    Returns:
        Dict with video metadata
    """

    conn = sqlite3.connect(video_db_path)
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM video_layout_config LIMIT 1")
    result = cursor.fetchone()
    conn.close()

    if result:
        columns = [desc[0] for desc in cursor.description]
        return dict(zip(columns, result, strict=True))
    else:
        return {}


def _get_spatial_features(
    video_db_path: Path, frame1_index: int, frame2_index: int
) -> list[float]:
    """Extract spatial features for frame pair.

    Args:
        video_db_path: Path to video's captions.db
        frame1_index: First frame index
        frame2_index: Second frame index

    Returns:
        List of spatial features (anchor type encoding, position, size)
    """

    conn = sqlite3.connect(video_db_path)
    cursor = conn.cursor()

    # Get video layout metadata
    cursor.execute("""
        SELECT anchor_type, crop_left, crop_top, crop_right, crop_bottom, frame_width, frame_height
        FROM video_layout_config LIMIT 1
    """)
    layout = cursor.fetchone()

    conn.close()

    if not layout:
        # Default values if no layout found
        anchor_encoding = [0.0, 0.0, 0.0]  # center
        x_norm, y_norm, w_norm = 0.5, 0.9, 0.5
    else:
        (
            anchor_type,
            crop_left,
            crop_top,
            crop_right,
            crop_bottom,
            frame_width,
            frame_height,
        ) = layout

        # Encode anchor type (one-hot)
        anchor_map = {
            "left": [1.0, 0.0, 0.0],
            "center": [0.0, 1.0, 0.0],
            "right": [0.0, 0.0, 1.0],
        }
        anchor_encoding = anchor_map.get(anchor_type, [0.0, 1.0, 0.0])

        # Calculate normalized crop region
        crop_width = crop_right - crop_left
        crop_height = crop_bottom - crop_top

        # Normalize to [0, 1] based on frame dimensions
        x_norm = (crop_left + crop_width / 2) / frame_width if frame_width else 0.5
        y_norm = (crop_top + crop_height / 2) / frame_height if frame_height else 0.9
        w_norm = crop_width / frame_width if frame_width else 0.5

    # Combine features: [anchor_left, anchor_center, anchor_right, x, y, w]
    # Note: Model expects 6 features total (3 anchor + 3 spatial)
    features = anchor_encoding + [x_norm, y_norm, w_norm]

    return features
