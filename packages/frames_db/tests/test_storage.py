"""Unit tests for frames_db storage and retrieval operations."""

import sqlite3
from pathlib import Path

import numpy as np
import pytest
from frames_db import (
    FrameData,
    get_all_frame_indices,
    get_frame_from_db,
    get_frames_range,
    write_frame_to_db,
    write_frames_batch,
)
from PIL import Image


@pytest.fixture
def temp_db(tmp_path: Path) -> Path:
    """Create temporary database with schema."""
    db_path = tmp_path / "test_annotations.db"

    # Create schema
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        # Create full_frames table
        cursor.execute(
            """
            CREATE TABLE full_frames (
                frame_index INTEGER PRIMARY KEY,
                image_data BLOB NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                file_size INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )

        # Create cropped_frames table
        cursor.execute(
            """
            CREATE TABLE cropped_frames (
                frame_index INTEGER PRIMARY KEY,
                image_data BLOB NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                file_size INTEGER NOT NULL,
                crop_left INTEGER,
                crop_top INTEGER,
                crop_right INTEGER,
                crop_bottom INTEGER,
                crop_bounds_version INTEGER DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )

        conn.commit()
    finally:
        conn.close()

    return db_path


@pytest.fixture
def sample_frame_data() -> tuple[bytes, int, int]:
    """Create sample JPEG frame data."""
    # Create a simple 100x100 red image
    img = Image.new("RGB", (100, 100), color=(255, 0, 0))

    # Save to bytes
    from io import BytesIO

    buffer = BytesIO()
    img.save(buffer, format="JPEG", quality=95)
    jpeg_bytes = buffer.getvalue()

    return jpeg_bytes, 100, 100


class TestStorage:
    """Tests for storage operations."""

    @pytest.mark.unit
    def test_write_single_frame(self, temp_db: Path, sample_frame_data: tuple):
        """Test writing single frame to database."""
        jpeg_bytes, width, height = sample_frame_data

        write_frame_to_db(
            db_path=temp_db,
            frame_index=0,
            image_data=jpeg_bytes,
            width=width,
            height=height,
            table="full_frames",
        )

        # Verify frame was written
        frame = get_frame_from_db(temp_db, 0, "full_frames")
        assert frame is not None
        assert frame.frame_index == 0
        assert frame.width == width
        assert frame.height == height
        assert frame.image_data == jpeg_bytes

    @pytest.mark.unit
    def test_write_cropped_frame_requires_version(self, temp_db: Path, sample_frame_data: tuple):
        """Test that cropped_frames requires crop_bounds_version."""
        jpeg_bytes, width, height = sample_frame_data

        with pytest.raises(ValueError, match="crop_bounds_version is required"):
            write_frame_to_db(
                db_path=temp_db,
                frame_index=0,
                image_data=jpeg_bytes,
                width=width,
                height=height,
                table="cropped_frames",
                # Missing crop_bounds_version
            )

    @pytest.mark.unit
    def test_write_cropped_frame_with_version(self, temp_db: Path, sample_frame_data: tuple):
        """Test writing cropped frame with version."""
        jpeg_bytes, width, height = sample_frame_data

        write_frame_to_db(
            db_path=temp_db,
            frame_index=0,
            image_data=jpeg_bytes,
            width=width,
            height=height,
            table="cropped_frames",
            crop_bounds_version=1,
            crop_bounds=(0, 0, width, height),
        )

        # Verify frame was written
        frame = get_frame_from_db(temp_db, 0, "cropped_frames")
        assert frame is not None

    @pytest.mark.unit
    def test_write_frames_batch(self, temp_db: Path, sample_frame_data: tuple):
        """Test batch writing multiple frames."""
        jpeg_bytes, width, height = sample_frame_data

        frames = [
            (0, jpeg_bytes, width, height),
            (100, jpeg_bytes, width, height),
            (200, jpeg_bytes, width, height),
        ]

        count = write_frames_batch(db_path=temp_db, frames=frames, table="full_frames")

        assert count == 3

        # Verify all frames were written
        indices = get_all_frame_indices(temp_db, "full_frames")
        assert indices == [0, 100, 200]

    @pytest.mark.unit
    def test_write_batch_with_progress(self, temp_db: Path, sample_frame_data: tuple):
        """Test batch write with progress callback."""
        jpeg_bytes, width, height = sample_frame_data

        frames = [(i, jpeg_bytes, width, height) for i in range(10)]

        progress_calls = []

        def progress_callback(current: int, total: int):
            progress_calls.append((current, total))

        count = write_frames_batch(
            db_path=temp_db,
            frames=frames,
            table="full_frames",
            progress_callback=progress_callback,
        )

        assert count == 10
        assert len(progress_calls) == 10
        assert progress_calls[0] == (1, 10)
        assert progress_calls[-1] == (10, 10)

    @pytest.mark.unit
    def test_write_empty_batch(self, temp_db: Path):
        """Test writing empty batch."""
        count = write_frames_batch(db_path=temp_db, frames=[], table="full_frames")
        assert count == 0

    @pytest.mark.unit
    def test_invalid_table(self, temp_db: Path, sample_frame_data: tuple):
        """Test that invalid table name raises error."""
        jpeg_bytes, width, height = sample_frame_data

        with pytest.raises(ValueError, match="Invalid table"):
            write_frame_to_db(
                db_path=temp_db,
                frame_index=0,
                image_data=jpeg_bytes,
                width=width,
                height=height,
                table="invalid_table",
            )


class TestRetrieval:
    """Tests for retrieval operations."""

    @pytest.mark.unit
    def test_get_frame_not_found(self, temp_db: Path):
        """Test retrieving non-existent frame returns None."""
        frame = get_frame_from_db(temp_db, 999, "full_frames")
        assert frame is None

    @pytest.mark.unit
    def test_get_frame_found(self, temp_db: Path, sample_frame_data: tuple):
        """Test retrieving existing frame."""
        jpeg_bytes, width, height = sample_frame_data

        write_frame_to_db(temp_db, 100, jpeg_bytes, width, height, "full_frames")

        frame = get_frame_from_db(temp_db, 100, "full_frames")
        assert frame is not None
        assert frame.frame_index == 100
        assert frame.width == width
        assert frame.height == height

    @pytest.mark.unit
    def test_get_frames_range(self, temp_db: Path, sample_frame_data: tuple):
        """Test retrieving frame range."""
        jpeg_bytes, width, height = sample_frame_data

        # Write frames 0, 100, 200, 300, 400
        frames = [(i * 100, jpeg_bytes, width, height) for i in range(5)]
        write_frames_batch(temp_db, frames, "full_frames")

        # Get frames 100-300
        result = get_frames_range(temp_db, 100, 300, "full_frames")

        assert len(result) == 3
        assert [f.frame_index for f in result] == [100, 200, 300]

    @pytest.mark.unit
    def test_get_frames_range_empty(self, temp_db: Path):
        """Test retrieving empty range."""
        result = get_frames_range(temp_db, 0, 100, "full_frames")
        assert result == []

    @pytest.mark.unit
    def test_get_all_frame_indices(self, temp_db: Path, sample_frame_data: tuple):
        """Test retrieving all frame indices."""
        jpeg_bytes, width, height = sample_frame_data

        # Write frames in non-sequential order
        frames = [
            (200, jpeg_bytes, width, height),
            (0, jpeg_bytes, width, height),
            (100, jpeg_bytes, width, height),
        ]
        write_frames_batch(temp_db, frames, "full_frames")

        # Should return sorted indices
        indices = get_all_frame_indices(temp_db, "full_frames")
        assert indices == [0, 100, 200]

    @pytest.mark.unit
    def test_get_all_frame_indices_empty(self, temp_db: Path):
        """Test retrieving indices from empty table."""
        indices = get_all_frame_indices(temp_db, "full_frames")
        assert indices == []


class TestFrameData:
    """Tests for FrameData conversion methods."""

    @pytest.mark.unit
    def test_to_pil_image(self, temp_db: Path, sample_frame_data: tuple):
        """Test converting to PIL Image."""
        jpeg_bytes, width, height = sample_frame_data

        write_frame_to_db(temp_db, 0, jpeg_bytes, width, height, "full_frames")
        frame = get_frame_from_db(temp_db, 0, "full_frames")

        assert frame is not None
        img = frame.to_pil_image()

        assert isinstance(img, Image.Image)
        assert img.width == width
        assert img.height == height

    @pytest.mark.unit
    def test_to_cv2_image(self, temp_db: Path, sample_frame_data: tuple):
        """Test converting to OpenCV image."""
        jpeg_bytes, width, height = sample_frame_data

        write_frame_to_db(temp_db, 0, jpeg_bytes, width, height, "full_frames")
        frame = get_frame_from_db(temp_db, 0, "full_frames")

        assert frame is not None
        img = frame.to_cv2_image()

        assert isinstance(img, np.ndarray)
        assert img.shape == (height, width, 3)  # OpenCV uses (height, width, channels)

    @pytest.mark.unit
    def test_to_temp_file(self, temp_db: Path, sample_frame_data: tuple):
        """Test saving to temporary file."""
        jpeg_bytes, width, height = sample_frame_data

        write_frame_to_db(temp_db, 0, jpeg_bytes, width, height, "full_frames")
        frame = get_frame_from_db(temp_db, 0, "full_frames")

        assert frame is not None
        temp_path = frame.to_temp_file()

        try:
            assert temp_path.exists()
            assert temp_path.suffix == ".jpg"

            # Verify file contents match original
            assert temp_path.read_bytes() == jpeg_bytes

        finally:
            # Clean up
            if temp_path.exists():
                temp_path.unlink()

    @pytest.mark.unit
    def test_frame_data_repr(self, sample_frame_data: tuple):
        """Test FrameData string representation."""
        jpeg_bytes, width, height = sample_frame_data

        frame = FrameData(
            frame_index=100,
            image_data=jpeg_bytes,
            width=width,
            height=height,
            file_size=len(jpeg_bytes),
        )

        repr_str = repr(frame)
        assert "frame_index=100" in repr_str
        assert f"width={width}" in repr_str
        assert f"height={height}" in repr_str
        assert "file_size=" in repr_str


class TestPerformance:
    """Performance tests for batch operations."""

    @pytest.mark.unit
    def test_batch_write_performance(self, temp_db: Path):
        """Test batch write with 1000 frames completes quickly."""
        import time

        # Create simple test data
        jpeg_bytes = b"x" * 10000  # 10KB fake JPEG

        frames = [(i, jpeg_bytes, 100, 100) for i in range(1000)]

        start = time.time()
        count = write_frames_batch(
            temp_db, frames, "cropped_frames", crop_bounds_version=1, crop_bounds=(0, 0, 100, 100)
        )
        elapsed = time.time() - start

        assert count == 1000
        assert elapsed < 10.0  # Should complete in <10 seconds

    @pytest.mark.unit
    def test_batch_read_performance(self, temp_db: Path, sample_frame_data: tuple):
        """Test reading 100 frames completes quickly."""
        import time

        jpeg_bytes, width, height = sample_frame_data

        # Write 100 frames
        frames = [(i, jpeg_bytes, width, height) for i in range(100)]
        write_frames_batch(temp_db, frames, "full_frames")

        # Read them back
        start = time.time()
        result = get_frames_range(temp_db, 0, 99, "full_frames")
        elapsed = time.time() - start

        assert len(result) == 100
        assert elapsed < 5.0  # Should complete in <5 seconds
