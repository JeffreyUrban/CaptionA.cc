"""Data models for frame storage."""

import os
import tempfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


@dataclass
class FrameData:
    """Represents a video frame with metadata.

    Attributes:
        frame_index: Frame index in video (0.1Hz for full_frames, 10Hz for cropped_frames)
        image_data: JPEG-compressed image bytes
        width: Frame width in pixels
        height: Frame height in pixels
        file_size: Size of image_data in bytes
        created_at: Timestamp when frame was stored (optional)
    """

    frame_index: int
    image_data: bytes
    width: int
    height: int
    file_size: int
    created_at: str | None = None

    def to_pil_image(self) -> Image.Image:
        """Convert frame data to PIL Image.

        Returns:
            PIL Image object

        Example:
            >>> frame = get_frame_from_db(db_path, 100)
            >>> img = frame.to_pil_image()
            >>> img.show()
        """
        return Image.open(BytesIO(self.image_data))

    def to_cv2_image(self) -> np.ndarray:
        """Convert frame data to OpenCV image array.

        Returns:
            NumPy array in BGR format (OpenCV's default)

        Example:
            >>> frame = get_frame_from_db(db_path, 100)
            >>> img = frame.to_cv2_image()
            >>> cv2.imshow('Frame', img)
        """
        nparr = np.frombuffer(self.image_data, np.uint8)
        return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    def to_temp_file(self, suffix: str = ".jpg") -> Path:
        """Save frame to temporary file.

        Useful for tools that require filesystem paths (e.g., ocrmac.OCR).
        The caller is responsible for cleaning up the temp file.

        Args:
            suffix: File extension (default: ".jpg")

        Returns:
            Path to temporary file

        Example:
            >>> frame = get_frame_from_db(db_path, 100)
            >>> temp_path = frame.to_temp_file()
            >>> try:
            ...     result = ocrmac.OCR(str(temp_path))
            ... finally:
            ...     temp_path.unlink()
        """
        temp_fd, temp_path = tempfile.mkstemp(suffix=suffix)
        try:
            Path(temp_path).write_bytes(self.image_data)
        finally:
            os.close(temp_fd)
        return Path(temp_path)

    def __repr__(self) -> str:
        """String representation for debugging."""
        return (
            f"FrameData(frame_index={self.frame_index}, "
            f"width={self.width}, height={self.height}, "
            f"file_size={self.file_size:,} bytes)"
        )
