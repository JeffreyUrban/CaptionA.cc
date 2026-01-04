"""Performance benchmark for Boundaries Annotation page frame loading.

Simulates the actual access pattern:
- Load 10-30 frames simultaneously (visible frames)
- Random access by frame index (user navigation)
- Compare filesystem vs database performance
"""

import sqlite3
import time
from io import BytesIO
from pathlib import Path

import pytest
from frames_db import (
    get_frame_from_db,
    get_frames_range,
    write_frames_batch,
)
from PIL import Image


def create_test_frame(width: int = 480, height: int = 48) -> bytes:
    """Create a realistic test frame (cropped subtitle region size)."""
    img = Image.new("RGB", (width, height), color=(255, 0, 0))
    buffer = BytesIO()
    img.save(buffer, format="JPEG", quality=95)
    return buffer.getvalue()


@pytest.fixture
def setup_test_data(tmp_path: Path):
    """Setup test data with 1000 frames in both filesystem and database."""
    # Create database with schema
    db_path = tmp_path / "annotations.db"
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE cropped_frames (
                frame_index INTEGER PRIMARY KEY,
                image_data BLOB NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                file_size INTEGER NOT NULL,
                crop_bounds_version INTEGER DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        conn.commit()
    finally:
        conn.close()

    # Create test frames
    frame_data = create_test_frame()
    width, height = 480, 48

    # Write 1000 frames to database (10Hz sampling, 100 seconds of video)
    frames = [(i, frame_data, width, height) for i in range(1000)]
    write_frames_batch(
        db_path=db_path,
        frames=frames,
        table="cropped_frames",
        crop_bounds_version=1,
    )

    # Create filesystem frames for comparison
    fs_dir = tmp_path / "crop_frames"
    fs_dir.mkdir()
    for i in range(1000):
        frame_path = fs_dir / f"frame_{i:010d}.jpg"
        frame_path.write_bytes(frame_data)

    return {
        "db_path": db_path,
        "fs_dir": fs_dir,
        "frame_data": frame_data,
        "width": width,
        "height": height,
    }


class TestBoundariesAnnotationPerformance:
    """Performance tests simulating Boundaries Annotation page."""

    @pytest.mark.unit
    def test_filesystem_load_visible_frames(self, setup_test_data):
        """Benchmark: Load 11 visible frames from filesystem (baseline)."""
        fs_dir = setup_test_data["fs_dir"]

        # Simulate loading 11 visible frames (linear spacing: -5 to +5)
        current_frame = 500
        offsets = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
        frame_indices = [current_frame + offset for offset in offsets]

        start = time.time()
        frames_loaded = []
        for idx in frame_indices:
            frame_path = fs_dir / f"frame_{idx:010d}.jpg"
            frame_bytes = frame_path.read_bytes()
            frames_loaded.append(frame_bytes)
        elapsed = time.time() - start

        assert len(frames_loaded) == 11
        print(f"\n[Filesystem] Loaded 11 frames in {elapsed * 1000:.2f}ms")
        assert elapsed < 0.1  # Should be <100ms

    @pytest.mark.unit
    def test_database_load_visible_frames_individual(self, setup_test_data):
        """Benchmark: Load 11 visible frames from DB (individual queries)."""
        db_path = setup_test_data["db_path"]

        # Simulate loading 11 visible frames
        current_frame = 500
        offsets = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
        frame_indices = [current_frame + offset for offset in offsets]

        start = time.time()
        frames_loaded = []
        for idx in frame_indices:
            frame = get_frame_from_db(db_path, idx, "cropped_frames")
            if frame:
                frames_loaded.append(frame.image_data)
        elapsed = time.time() - start

        assert len(frames_loaded) == 11
        print(f"\n[Database Individual] Loaded 11 frames in {elapsed * 1000:.2f}ms")
        assert elapsed < 0.2  # Should be <200ms

    @pytest.mark.unit
    def test_database_load_visible_frames_range(self, setup_test_data):
        """Benchmark: Load 11 visible frames from DB (range query)."""
        db_path = setup_test_data["db_path"]

        # Simulate loading 11 visible frames using range query
        current_frame = 500
        start_idx = current_frame - 5
        end_idx = current_frame + 5

        start = time.time()
        frames = get_frames_range(db_path, start_idx, end_idx, "cropped_frames")
        elapsed = time.time() - start

        assert len(frames) == 11
        print(f"\n[Database Range] Loaded 11 frames in {elapsed * 1000:.2f}ms")
        assert elapsed < 0.15  # Should be faster than individual queries

    @pytest.mark.unit
    def test_navigation_simulation(self, setup_test_data):
        """Simulate user navigation: Load frames for 10 different positions."""
        db_path = setup_test_data["db_path"]

        # Simulate scrolling through 10 different positions
        positions = [100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

        start = time.time()
        for current_frame in positions:
            # Load 11 visible frames
            frames = get_frames_range(db_path, current_frame - 5, current_frame + 5, "cropped_frames")
            assert len(frames) == 11
        elapsed = time.time() - start

        avg_per_load = elapsed / len(positions) * 1000
        print(f"\n[Navigation] 10 loads, avg {avg_per_load:.2f}ms per load")
        print(f"[Navigation] Total: {elapsed * 1000:.2f}ms for 10 navigation steps")
        assert avg_per_load < 50  # Each load should be <50ms for smooth navigation

    @pytest.mark.unit
    def test_large_window_load(self, setup_test_data):
        """Test loading 30 frames (large window, extended spacing)."""
        db_path = setup_test_data["db_path"]

        # Large window: -15 to +15 (30 frames total)
        current_frame = 500
        start = time.time()
        frames = get_frames_range(db_path, current_frame - 15, current_frame + 15, "cropped_frames")
        elapsed = time.time() - start

        assert len(frames) == 31  # Inclusive range
        print(f"\n[Large Window] Loaded 31 frames in {elapsed * 1000:.2f}ms")
        assert elapsed < 0.3  # Should be <300ms even for large window

    @pytest.mark.unit
    def test_database_connection_overhead(self, setup_test_data):
        """Measure connection overhead for multiple rapid queries."""
        db_path = setup_test_data["db_path"]

        # Simulate rapid navigation (100 frame loads)
        start = time.time()
        for i in range(100):
            frame = get_frame_from_db(db_path, i, "cropped_frames")
            assert frame is not None
        elapsed = time.time() - start

        avg_per_query = elapsed / 100 * 1000
        print(f"\n[Connection Overhead] 100 queries, avg {avg_per_query:.2f}ms per query")
        assert avg_per_query < 10  # Each query should be <10ms

    @pytest.mark.unit
    def test_memory_efficiency(self, setup_test_data):
        """Test that frames can be garbage collected (not held in memory)."""
        db_path = setup_test_data["db_path"]

        # Load frames and measure memory
        frames = get_frames_range(db_path, 0, 99, "cropped_frames")
        frame_size = sum(len(f.image_data) for f in frames)

        # Clear references
        frames = None

        # Size should be reasonable
        print(f"\n[Memory] 100 frames total size: {frame_size / 1024:.2f} KB")
        assert frame_size < 2 * 1024 * 1024  # Should be <2MB for 100 cropped frames


class TestOptimizationStrategies:
    """Test potential optimization strategies."""

    @pytest.mark.unit
    def test_connection_pooling(self, setup_test_data):
        """Test if reusing connection improves performance."""
        db_path = setup_test_data["db_path"]

        # Without pooling (current implementation)
        start = time.time()
        for i in range(50):
            get_frame_from_db(db_path, i, "cropped_frames")
        elapsed_no_pool = time.time() - start

        # With connection reuse
        conn = sqlite3.connect(db_path)
        try:
            start = time.time()
            cursor = conn.cursor()
            for i in range(50):
                cursor.execute("SELECT image_data FROM cropped_frames WHERE frame_index = ?", (i,))
                cursor.fetchone()
            elapsed_with_pool = time.time() - start
        finally:
            conn.close()

        print(f"\n[Pooling] Without: {elapsed_no_pool * 1000:.2f}ms")
        print(f"[Pooling] With reuse: {elapsed_with_pool * 1000:.2f}ms")
        print(f"[Pooling] Improvement: {(1 - elapsed_with_pool / elapsed_no_pool) * 100:.1f}%")

        # Connection reuse should be faster
        assert elapsed_with_pool < elapsed_no_pool
