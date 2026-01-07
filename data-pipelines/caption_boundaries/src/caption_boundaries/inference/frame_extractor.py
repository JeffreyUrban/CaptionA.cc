"""Extract frames from VP9/WebM chunks.

Ported from TypeScript web client (useBoundaryFrameLoader.ts).
"""

import os
import tempfile
from pathlib import Path

import cv2
import numpy as np
import requests
from rich.console import Console

console = Console(stderr=True)


def calculate_frame_offset(frame_index: int, modulo: int) -> int:
    """Calculate frame position within a VP9 chunk.

    Uses non-duplicating strategy:
    - modulo 16: frames where index % 16 === 0
    - modulo 4: frames where index % 4 === 0 AND index % 16 !== 0
    - modulo 1: frames where index % 4 !== 0

    Args:
        frame_index: Absolute frame index in video
        modulo: Modulo level (1, 4, or 16)

    Returns:
        Frame position within chunk (0-31)
    """
    # Chunk size in frame indices
    chunk_size = 32 * modulo
    chunk_start = (frame_index // chunk_size) * chunk_size

    # Count frames in chunk before target frame
    offset = 0
    for i in range(chunk_start, frame_index + 1):
        if modulo == 16 and i % 16 == 0:
            if i == frame_index:
                return offset
            offset += 1
        elif modulo == 4 and i % 4 == 0 and i % 16 != 0:
            if i == frame_index:
                return offset
            offset += 1
        elif modulo == 1 and i % 4 != 0:
            if i == frame_index:
                return offset
            offset += 1

    raise ValueError(f"Frame {frame_index} not found in modulo {modulo} chunk")


def determine_modulo_for_frame(frame_index: int) -> int:
    """Determine which modulo level contains this frame.

    Args:
        frame_index: Absolute frame index

    Returns:
        Modulo level (1, 4, or 16)
    """
    if frame_index % 16 == 0:
        return 16
    elif frame_index % 4 == 0:
        return 4
    else:
        return 1


def extract_frame_from_chunk(
    signed_url: str,
    frame_index: int,
    modulo: int | None = None,
    fps: int = 10,
) -> np.ndarray:
    """Extract single frame from VP9/WebM chunk.

    Args:
        signed_url: Wasabi signed URL for chunk
        frame_index: Absolute frame index to extract
        modulo: Modulo level (auto-detected if None)
        fps: Frames per second (default 10)

    Returns:
        Frame as numpy array (RGB, uint8)

    Raises:
        ValueError: If frame extraction fails
    """
    if modulo is None:
        modulo = determine_modulo_for_frame(frame_index)

    # Download chunk to temp file
    try:
        response = requests.get(signed_url, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        raise ValueError(f"Failed to download chunk: {e}") from e

    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(response.content)
        temp_path = f.name

    try:
        # Calculate frame position in chunk
        frame_offset = calculate_frame_offset(frame_index, modulo)

        # Extract frame using OpenCV
        cap = cv2.VideoCapture(temp_path)

        if not cap.isOpened():
            raise ValueError(f"Failed to open video file: {temp_path}")

        # Seek to frame
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_offset)
        ret, frame = cap.read()
        cap.release()

        if not ret or frame is None:
            raise ValueError(f"Failed to read frame at offset {frame_offset}")

        # Convert BGR to RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        return frame_rgb

    finally:
        # Clean up temp file
        try:
            os.unlink(temp_path)
        except OSError:
            pass


class ChunkCache:
    """LRU cache for downloaded VP9 chunks.

    Primary use case: A/B testing model versions on the same video.

    When running inference with multiple model versions on the same video:
    1. First model: Downloads chunks from Wasabi
    2. Second model: Reuses cached chunks (same video, different model)

    This is useful when:
    - Testing new model versions (run old + new model on same video)
    - Comparing model predictions (diff two model outputs)
    - Multiple jobs for same video arrive within 5-min warm period

    Note: Chunks are video-specific, not model-specific. Once downloaded,
    any model version can use them. Cache persists for Modal's 5-minute
    container idle period.
    """

    def __init__(self, max_size_mb: int = 1024):
        """Initialize chunk cache.

        Args:
            max_size_mb: Maximum cache size in megabytes
        """
        self.max_size_bytes = max_size_mb * 1024 * 1024
        self.cache: dict[str, Path] = {}  # storage_key -> local_path
        self.sizes: dict[str, int] = {}  # storage_key -> file_size
        self.access_order: list[str] = []  # LRU tracking

    def get(self, storage_key: str) -> Path | None:
        """Get cached chunk path.

        Args:
            storage_key: Wasabi storage key

        Returns:
            Local path if cached, None otherwise
        """
        if storage_key in self.cache:
            # Update access order (move to end = most recent)
            self.access_order.remove(storage_key)
            self.access_order.append(storage_key)
            return self.cache[storage_key]
        return None

    def put(self, storage_key: str, chunk_path: Path) -> None:
        """Add chunk to cache.

        Args:
            storage_key: Wasabi storage key
            chunk_path: Local path to chunk file
        """
        file_size = chunk_path.stat().st_size

        # Evict if needed
        while self._total_size() + file_size > self.max_size_bytes and self.cache:
            self._evict_lru()

        self.cache[storage_key] = chunk_path
        self.sizes[storage_key] = file_size
        self.access_order.append(storage_key)

    def _total_size(self) -> int:
        """Get total cache size in bytes."""
        return sum(self.sizes.values())

    def _evict_lru(self) -> None:
        """Evict least recently used chunk."""
        if not self.access_order:
            return

        lru_key = self.access_order.pop(0)
        chunk_path = self.cache.pop(lru_key)
        self.sizes.pop(lru_key)

        # Delete file
        try:
            chunk_path.unlink()
        except OSError:
            pass

    def clear(self) -> None:
        """Clear all cached chunks."""
        for chunk_path in self.cache.values():
            try:
                chunk_path.unlink()
            except OSError:
                pass

        self.cache.clear()
        self.sizes.clear()
        self.access_order.clear()


def batch_extract_frames(
    signed_urls: dict[int, str],
    frame_indices: list[int],
    use_cache: bool = True,
) -> dict[int, np.ndarray]:
    """Extract multiple frames efficiently.

    Args:
        signed_urls: Mapping of chunk_index -> signed_url
        frame_indices: List of frame indices to extract
        use_cache: Whether to use chunk caching

    Returns:
        Mapping of frame_index -> frame (RGB numpy array)
    """
    cache = ChunkCache() if use_cache else None
    results = {}

    # Group frames by chunk
    from collections import defaultdict

    frames_by_chunk: dict[tuple[int, int], list[int]] = defaultdict(list)

    for frame_idx in frame_indices:
        modulo = determine_modulo_for_frame(frame_idx)
        chunk_size = 32 * modulo
        chunk_index = (frame_idx // chunk_size) * modulo

        frames_by_chunk[(chunk_index, modulo)].append(frame_idx)

    console.print(f"[cyan]Extracting {len(frame_indices)} frames from {len(frames_by_chunk)} chunks[/cyan]")

    # Process each chunk
    for (chunk_index, modulo), chunk_frames in frames_by_chunk.items():
        if chunk_index not in signed_urls:
            console.print(f"[yellow]⚠ Missing signed URL for chunk {chunk_index}[/yellow]")
            continue

        signed_url = signed_urls[chunk_index]

        # Extract all frames from this chunk
        for frame_idx in chunk_frames:
            try:
                frame = extract_frame_from_chunk(signed_url, frame_idx, modulo)
                results[frame_idx] = frame
            except ValueError as e:
                console.print(f"[red]✗ Failed to extract frame {frame_idx}: {e}[/red]")

    if cache:
        cache.clear()

    console.print(f"[green]✓ Extracted {len(results)}/{len(frame_indices)} frames[/green]")

    return results
