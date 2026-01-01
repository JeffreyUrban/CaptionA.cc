"""PyTorch dataset for caption boundary detection training.

Loads frame pairs, OCR visualizations, and metadata for training the boundary predictor.
"""

import subprocess
from pathlib import Path
from typing import Literal

import numpy as np
import torch
from frames_db import get_frame_from_db
from PIL import Image
from sqlalchemy.orm import Session
from torch.utils.data import Dataset

from caption_boundaries.data.transforms import AnchorAwareResize, NormalizeImageNet, ResizeStrategy
from caption_boundaries.database import FontEmbedding, TrainingSample, get_training_db


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
    except subprocess.CalledProcessError:
        raise RuntimeError("Not in a git repository")


class CaptionBoundaryDataset(Dataset):
    """PyTorch dataset for caption boundary detection.

    Loads consecutive frame pairs with their OCR visualizations and metadata.

    Each sample contains:
    - OCR box visualization (from full_frame_ocr)
    - Frame 1 (cropped caption at time t)
    - Frame 2 (cropped caption at time t+1)
    - Spatial metadata (anchor_type, position, size)
    - Font embedding (512-dim from FontCLIP)
    - Label (5-way classification)

    Args:
        dataset_id: ID of training dataset in database
        split: Which split to load ('train', 'val', or 'test')
        training_db_path: Path to training database
        transform_strategy: Resize strategy for variable-sized crops
        target_width: Target width for frame crops (default: 480)
        target_height: Target height for frame crops (default: 48)

    Example:
        >>> dataset = CaptionBoundaryDataset(
        ...     dataset_id=1,
        ...     split='train',
        ...     transform_strategy=ResizeStrategy.MIRROR_TILE
        ... )
        >>> sample = dataset[0]
        >>> print(sample.keys())
        dict_keys(['ocr_viz', 'frame1', 'frame2', 'spatial_features',
                   'font_embedding', 'label'])
    """

    # Label encoding
    LABELS = ["same", "different", "empty_empty", "empty_valid", "valid_empty"]
    LABEL_TO_IDX = {label: idx for idx, label in enumerate(LABELS)}

    def __init__(
        self,
        dataset_id: int,
        split: Literal["train", "val", "test"],
        training_db_path: Path | None = None,
        transform_strategy: ResizeStrategy = ResizeStrategy.MIRROR_TILE,
        target_width: int = 480,
        target_height: int = 48,
    ):
        self.dataset_id = dataset_id
        self.split = split
        self.training_db_path = training_db_path
        self.transform_strategy = transform_strategy
        self.target_width = target_width
        self.target_height = target_height

        # Load samples from database
        self.samples = self._load_samples()

        # Initialize transforms
        self.resize_transform = AnchorAwareResize(
            target_width=target_width,
            target_height=target_height,
            strategy=transform_strategy,
        )
        self.normalize = NormalizeImageNet()

        # Cache for video databases and metadata
        self._video_db_cache = {}
        self._spatial_metadata_cache = {}
        self._font_embedding_cache = {}

    def _load_samples(self) -> list[TrainingSample]:
        """Load training samples from database for this dataset and split.

        Returns:
            List of TrainingSample objects

        Raises:
            ValueError: If no samples found for dataset and split
        """
        with next(get_training_db(self.training_db_path)) as db:
            samples = (
                db.query(TrainingSample)
                .filter(
                    TrainingSample.dataset_id == self.dataset_id,
                    TrainingSample.split == self.split,
                )
                .all()
            )

            if not samples:
                raise ValueError(
                    f"No samples found for dataset_id={self.dataset_id}, split={self.split}"
                )

            # Detach from session (make transient)
            for sample in samples:
                db.expunge(sample)

            return samples

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
            - font_embedding: Tensor of shape (512,) - Font embedding
            - label: Integer label (0-4)
            - sample_id: Database ID of sample (for debugging)
        """
        sample = self.samples[idx]

        # Get video database path
        video_db_path = self._get_video_db_path(sample.video_hash)

        # Load frames
        frame1_image = self._load_frame(video_db_path, sample.frame1_index)
        frame2_image = self._load_frame(video_db_path, sample.frame2_index)

        # Load OCR visualization (TODO: implement OCR viz loading)
        # For now, create a blank visualization
        ocr_viz_image = Image.new("RGB", (self.target_width, self.target_height))

        # Get spatial metadata
        spatial_features = self._get_spatial_metadata(sample.video_hash)

        # Get font embedding
        font_embedding = self._get_font_embedding(sample.video_hash)

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

        # Convert font embedding to tensor
        font_tensor = torch.tensor(font_embedding, dtype=torch.float32)

        # Encode label
        label_idx = self.LABEL_TO_IDX[sample.label]

        return {
            "ocr_viz": ocr_viz_tensor,
            "frame1": frame1_tensor,
            "frame2": frame2_tensor,
            "spatial_features": spatial_tensor,
            "font_embedding": font_tensor,
            "label": label_idx,
            "sample_id": sample.id,
        }

    def _get_video_db_path(self, video_hash: str) -> Path:
        """Get path to video's annotations.db from registry.

        Args:
            video_hash: Video hash

        Returns:
            Path to video's annotations.db

        Raises:
            FileNotFoundError: If video database not found
        """
        if video_hash in self._video_db_cache:
            return self._video_db_cache[video_hash]

        # Query video registry for path
        with next(get_training_db(self.training_db_path)) as db:
            from caption_boundaries.database import VideoRegistry

            video = (
                db.query(VideoRegistry)
                .filter(VideoRegistry.video_hash == video_hash)
                .first()
            )

            if not video:
                raise ValueError(f"Video {video_hash} not found in registry")

            # Construct annotations.db path from video path
            video_path = Path(video.video_path)

            # Resolve relative paths from git root (for worktree compatibility)
            if not video_path.is_absolute():
                git_root = get_git_root()
                video_path = git_root / video_path

            db_path = video_path.parent / "annotations.db"

            if not db_path.exists():
                raise FileNotFoundError(
                    f"Video database not found: {db_path}\n"
                    f"Expected annotations.db in same directory as {video_path}"
                )

            self._video_db_cache[video_hash] = db_path
            return db_path

    def _load_frame(self, video_db_path: Path, frame_index: int) -> Image.Image:
        """Load frame from video database.

        Args:
            video_db_path: Path to video's annotations.db
            frame_index: Frame index to load

        Returns:
            PIL Image of frame

        Raises:
            ValueError: If frame not found in database
        """
        frame_data = get_frame_from_db(
            db_path=video_db_path,
            frame_index=frame_index,
            table="cropped_frames",
        )

        if frame_data is None:
            raise ValueError(
                f"Frame {frame_index} not found in {video_db_path}\n"
                f"Ensure cropped_frames pipeline has been run on this video."
            )

        return frame_data.to_pil_image()

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

    def _get_anchor_type(self, spatial_features: np.ndarray) -> Literal["left", "center", "right"]:
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

    def _get_font_embedding(self, video_hash: str) -> np.ndarray:
        """Get font embedding for video.

        Args:
            video_hash: Video hash

        Returns:
            512-dimensional font embedding

        Raises:
            ValueError: If font embedding not found
        """
        if video_hash in self._font_embedding_cache:
            return self._font_embedding_cache[video_hash]

        with next(get_training_db(self.training_db_path)) as db:
            embedding_record = (
                db.query(FontEmbedding)
                .filter(FontEmbedding.video_hash == video_hash)
                .first()
            )

            if not embedding_record:
                raise ValueError(
                    f"Font embedding not found for video {video_hash}\n"
                    f"Run font embedding extraction before training."
                )

            # Convert bytes to numpy array
            embedding = np.frombuffer(embedding_record.embedding, dtype=np.float32)

            self._font_embedding_cache[video_hash] = embedding
            return embedding

    @staticmethod
    def collate_fn(batch: list[dict]) -> dict[str, torch.Tensor]:
        """Collate function for DataLoader.

        Args:
            batch: List of sample dictionaries from __getitem__

        Returns:
            Batched dictionary with stacked tensors
        """
        return {
            "ocr_viz": torch.stack([s["ocr_viz"] for s in batch]),
            "frame1": torch.stack([s["frame1"] for s in batch]),
            "frame2": torch.stack([s["frame2"] for s in batch]),
            "spatial_features": torch.stack([s["spatial_features"] for s in batch]),
            "font_embedding": torch.stack([s["font_embedding"] for s in batch]),
            "label": torch.tensor([s["label"] for s in batch], dtype=torch.long),
            "sample_id": [s["sample_id"] for s in batch],  # Keep as list for debugging
        }
