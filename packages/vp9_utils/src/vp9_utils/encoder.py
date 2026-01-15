"""VP9 video encoding utilities for frame chunks."""

import sqlite3
import subprocess
import tempfile
from pathlib import Path
from typing import Callable, Literal, TypedDict

FrameType = Literal["cropped", "full"]


class EncodingResult(TypedDict):
    """Result from encoding operation."""

    chunks_encoded: int
    total_frames: int
    output_dir: Path
    chunk_files: list[Path]
    modulo_levels: list[int]


def get_frames_from_db(db_path: Path, frame_type: FrameType = "cropped") -> list[tuple[int, bytes, int, int]]:
    """Extract frames from database.

    Args:
        db_path: Path to SQLite database
        frame_type: Type of frames to extract ("cropped" or "full")

    Returns:
        List of (frame_index, image_data, width, height) tuples
    """
    table_name = f"{frame_type}_frames"

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute(f"""
        SELECT frame_index, image_data, width, height
        FROM {table_name}
        ORDER BY frame_index
    """)

    frames = cursor.fetchall()
    conn.close()

    return frames


def organize_frames_by_modulo(
    frames: list[tuple[int, bytes, int, int]], modulo_levels: list[int]
) -> dict[int, list[tuple[int, bytes, int, int]]]:
    """Organize frames into modulo levels without duplication.

    For cropped frames with [16, 4, 1]:
    - modulo_16: frames where index % 16 == 0
    - modulo_4: frames where index % 4 == 0 AND index % 16 != 0
    - modulo_1: frames where index % 4 != 0 (i.e., NOT in modulo_4 or modulo_16)

    For full frames with [1]:
    - modulo_1: ALL frames

    Args:
        frames: List of frame tuples
        modulo_levels: List of modulo levels to organize by

    Returns:
        Dict mapping modulo level to list of frames
    """
    organized = {level: [] for level in modulo_levels}

    # If only modulo_1, just return all frames
    if modulo_levels == [1]:
        organized[1] = frames
        return organized

    # Non-duplicating strategy for multi-level
    for frame in frames:
        frame_index = frame[0]

        # modulo_16 gets frames divisible by 16
        if 16 in modulo_levels and frame_index % 16 == 0:
            organized[16].append(frame)

        # modulo_4 gets frames divisible by 4 (but not by higher levels)
        elif 4 in modulo_levels and frame_index % 4 == 0:
            organized[4].append(frame)

        # modulo_1 gets frames NOT divisible by 4 (i.e., not in higher levels)
        elif 1 in modulo_levels:
            organized[1].append(frame)

    return organized


def write_frames_to_temp_dir(frames: list[tuple[int, bytes, int, int]], temp_dir: Path) -> tuple[int, int]:
    """Write frames as JPEG files to temporary directory.

    Args:
        frames: List of frame tuples
        temp_dir: Directory to write frames to

    Returns:
        (width, height) of first frame

    Raises:
        ValueError: If frames list is empty
    """
    if not frames:
        raise ValueError("Cannot write frames: frames list is empty")

    width, height = None, None

    for i, (frame_index, image_data, w, h) in enumerate(frames):
        if width is None:
            width, height = w, h

        frame_path = temp_dir / f"frame_{i:06d}.jpg"
        frame_path.write_bytes(image_data)

    assert width is not None and height is not None  # For type checker
    return width, height


def encode_chunk(input_dir: Path, output_path: Path, width: int, height: int, crf: int = 30) -> None:
    """Encode frames into VP9 WebM chunk using ffmpeg.

    Args:
        input_dir: Directory containing frame_*.jpg files
        output_path: Output .webm file path
        width: Frame width
        height: Frame height
        crf: Constant quality (0-63, lower = better quality)
    """
    # VP9 encoding parameters:
    # -c:v libvpx-vp9: VP9 codec
    # -crf 30: Constant quality (0-63, lower = better quality)
    # -b:v 0: Use constant quality mode
    # -row-mt 1: Enable row-based multithreading
    # -g 32: Keyframe interval (match chunk size)
    # -pix_fmt yuv420p: Pixel format for compatibility

    cmd = [
        "ffmpeg",
        "-framerate",
        "10",  # 10 fps (100ms per frame)
        "-pattern_type",
        "glob",
        "-i",
        str(input_dir / "frame_*.jpg"),
        "-c:v",
        "libvpx-vp9",
        "-crf",
        str(crf),
        "-b:v",
        "0",
        "-row-mt",
        "1",
        "-g",
        "32",
        "-pix_fmt",
        "yuv420p",
        "-y",  # Overwrite output file
        str(output_path),
    ]

    subprocess.run(cmd, check=True, capture_output=True)


def encode_modulo_chunks(
    modulo: int,
    frames: list[tuple[int, bytes, int, int]],
    output_dir: Path,
    chunk_size: int = 32,
    crf: int = 30,
    progress_callback: Callable[[int, int], None] | None = None,
) -> list[Path]:
    """Encode all chunks for a modulo level.

    Args:
        modulo: Modulo level (16, 4, or 1)
        frames: List of frames for this modulo
        output_dir: Directory to write chunks
        chunk_size: Frames per chunk
        crf: VP9 quality setting
        progress_callback: Optional callback(current_chunk, total_chunks)

    Returns:
        List of encoded chunk file paths
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    chunk_paths = []

    # Split frames into chunks
    num_chunks = (len(frames) + chunk_size - 1) // chunk_size

    for chunk_idx in range(num_chunks):
        start_idx = chunk_idx * chunk_size
        end_idx = min(start_idx + chunk_size, len(frames))
        chunk_frames = frames[start_idx:end_idx]

        # Get start frame index for chunk filename
        start_frame_index = chunk_frames[0][0]

        chunk_filename = f"chunk_{start_frame_index:010d}.webm"
        chunk_path = output_dir / chunk_filename

        # Write frames to temp directory
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            width, height = write_frames_to_temp_dir(chunk_frames, temp_path)

            # Encode chunk
            encode_chunk(temp_path, chunk_path, width, height, crf)

        chunk_paths.append(chunk_path)

        # Call progress callback
        if progress_callback:
            progress_callback(chunk_idx + 1, num_chunks)

    return chunk_paths


def encode_video_chunks(
    db_path: Path,
    video_id: str,
    frame_type: FrameType,
    output_dir: Path,
    modulo_levels: list[int] | None = None,
    frames_per_chunk: int = 32,
    crf: int = 30,
    progress_callback: Callable[[int, int], None] | None = None,
) -> EncodingResult:
    """Encode frames to VP9 WebM chunks.

    Args:
        db_path: Path to SQLite database
        video_id: Video ID for namespace
        frame_type: "cropped" or "full"
        output_dir: Local directory for chunk files
        modulo_levels: Hierarchical preview levels.
                       Defaults: cropped=[16,4,1], full=[1]
        frames_per_chunk: Number of frames per chunk
        crf: VP9 quality setting (0-63, lower = better)
        progress_callback: Optional callback(current, total)

    Returns:
        EncodingResult with metrics and file paths
    """
    # Auto-select modulo levels based on frame type
    if modulo_levels is None:
        modulo_levels = [16, 4, 1] if frame_type == "cropped" else [1]

    # Get frames from database
    frames = get_frames_from_db(db_path, frame_type)
    if not frames:
        raise ValueError(f"No {frame_type} frames found in database")

    # Organize by modulo
    modulo_frames = organize_frames_by_modulo(frames, modulo_levels)

    # Set up output directories
    output_base = output_dir / video_id / f"{frame_type}_frames"
    output_base.mkdir(parents=True, exist_ok=True)

    # Encode chunks for each modulo level
    all_chunk_files = []
    total_chunks_encoded = 0

    for modulo in modulo_levels:
        modulo_output_dir = output_base / f"modulo_{modulo}"
        chunk_paths = encode_modulo_chunks(
            modulo,
            modulo_frames[modulo],
            modulo_output_dir,
            chunk_size=frames_per_chunk,
            crf=crf,
            progress_callback=progress_callback,
        )

        all_chunk_files.extend(chunk_paths)
        total_chunks_encoded += len(chunk_paths)

    return {
        "chunks_encoded": total_chunks_encoded,
        "total_frames": len(frames),
        "output_dir": output_base,
        "chunk_files": all_chunk_files,
        "modulo_levels": modulo_levels,
    }
