"""Video identification via SHA256 hash.

Provides robust video identification that persists across file moves/renames.

Uses partial file hashing (head + middle + tail) for performance:
- For large video files, hashing the entire file is slow
- Instead, hash first 10MB + middle 10MB + last 10MB
- Combined with file size, provides excellent uniqueness
- Dramatically faster than full file hash
"""

import hashlib
from pathlib import Path
from typing import TypedDict


class VideoMetadata(TypedDict):
    """Metadata extracted from video file."""

    video_hash: str
    video_path: str
    file_size_bytes: int


def compute_video_hash(
    video_path: Path,
    sample_size: int = 10 * 1024 * 1024,  # 10MB per sample
    chunk_size: int = 8192,
) -> str:
    """Compute SHA256 hash of video file using partial sampling for speed.

    Strategy: Hash head + middle + tail of file
    - First 10MB (or less if file is smaller)
    - Middle 10MB
    - Last 10MB (or less if file is smaller)

    This provides excellent file uniqueness while being much faster than
    hashing the entire multi-GB video file.

    Args:
        video_path: Path to video file
        sample_size: Bytes to sample from each region (default 10MB)
        chunk_size: Size of chunks to read (default 8KB)

    Returns:
        Hex string of SHA256 hash

    Example:
        >>> video_hash = compute_video_hash(Path("video.mp4"))
        >>> print(video_hash)
        'a7f9c3e2d1b...'
    """
    sha256 = hashlib.sha256()
    file_size = video_path.stat().st_size

    # Include file size in hash for additional uniqueness
    sha256.update(str(file_size).encode())

    with open(video_path, "rb") as f:
        # 1. Hash from beginning (head)
        bytes_read = 0
        while bytes_read < sample_size:
            chunk = f.read(min(chunk_size, sample_size - bytes_read))
            if not chunk:
                break
            sha256.update(chunk)
            bytes_read += len(chunk)

        # 2. Hash from middle
        if file_size > sample_size * 2:
            middle_pos = (file_size - sample_size) // 2
            f.seek(middle_pos)
            bytes_read = 0
            while bytes_read < sample_size:
                chunk = f.read(min(chunk_size, sample_size - bytes_read))
                if not chunk:
                    break
                sha256.update(chunk)
                bytes_read += len(chunk)

        # 3. Hash from end (tail)
        if file_size > sample_size:
            tail_pos = max(0, file_size - sample_size)
            f.seek(tail_pos)
            bytes_read = 0
            while bytes_read < sample_size:
                chunk = f.read(min(chunk_size, sample_size - bytes_read))
                if not chunk:
                    break
                sha256.update(chunk)
                bytes_read += len(chunk)

    return sha256.hexdigest()


def get_video_metadata(video_path: Path) -> VideoMetadata:
    """Extract basic metadata from video path and file.

    Args:
        video_path: Path to video file

    Returns:
        Dict with metadata:
            - video_hash: SHA256 hash (unique identifier)
            - video_path: Absolute path as string
            - file_size_bytes: File size in bytes

    Example:
        >>> metadata = get_video_metadata(Path("videos/my_video.mp4"))
        >>> metadata['video_hash']
        'a7f9c3e2d1b...'
    """
    # Compute hash
    video_hash = compute_video_hash(video_path)

    # Get file size
    file_size = video_path.stat().st_size

    return {
        "video_hash": video_hash,
        "video_path": str(video_path.absolute()),
        "file_size_bytes": file_size,
    }
