"""
Crop Frames to WebM Chunks Flow - Versioned Frameset Generation

Handles cropped frame extraction and encoding to VP9/WebM chunks with versioning:
1. Download video and layout.db from Wasabi
2. Create new version record in Supabase
3. Extract cropped frames at 10Hz
4. Encode frames as VP9/WebM chunks
5. Upload chunks to Wasabi
6. Activate new version (archives previous version)

This flow supports multiple versions for ML training reproducibility.
The app always uses the latest "active" version for annotation workflows.
"""

import hashlib
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from prefect import flow, task
from prefect.artifacts import create_table_artifact

from supabase_client import CroppedFramesVersionRepository, VideoRepository
from wasabi_client import WasabiClient, get_wasabi_client

# Default tenant for development
DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001"

# WebM chunk parameters - Hierarchical modulo-based chunking
# Each chunk contains 32 frames at a specific modulo spacing
# This enables progressive loading from coarse (modulo 32) to fine (modulo 1)
FRAMES_PER_CHUNK = 32  # Exactly 32 frames per chunk (matches frontend loading system)
MODULO_LEVELS = [32, 16, 8, 4, 2, 1]  # Hierarchical sampling levels
WEBM_CRF = 23  # Constant Rate Factor (0-63, lower = better quality)
WEBM_BITRATE = "500k"  # Target bitrate

@task(
    name="download-video-from-wasabi",
    tags=["wasabi", "download"],
    log_prints=True,
)
def download_video_from_wasabi(
    tenant_id: str,
    video_id: str,
    filename: str,
    local_path: str,
) -> str:
    """Download video file from Wasabi to local path."""
    print(f"[Wasabi] Downloading video: {filename}")

    client = get_wasabi_client()
    storage_key = WasabiClient.build_storage_key(tenant_id, video_id, filename)

    client.download_file(storage_key=storage_key, local_path=local_path)

    print(f"[Wasabi] Video downloaded: {local_path}")
    return local_path

@task(
    name="download-layout-db-from-wasabi",
    tags=["wasabi", "download"],
    log_prints=True,
)
def download_layout_db_from_wasabi(
    tenant_id: str,
    video_id: str,
    local_path: str,
) -> tuple[str, str]:
    """
    Download layout.db from Wasabi and compute its hash.

    Returns:
        Tuple of (local_path, sha256_hash)
    """
    print("[Wasabi] Downloading layout.db")

    client = get_wasabi_client()
    storage_key = WasabiClient.build_storage_key(tenant_id, video_id, "layout.db")

    client.download_file(storage_key=storage_key, local_path=local_path)

    # Compute SHA-256 hash
    sha256_hash = hashlib.sha256()
    with open(local_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256_hash.update(chunk)

    hash_hex = sha256_hash.hexdigest()

    print(f"[Wasabi] layout.db downloaded: {local_path}")
    print(f"[Wasabi] SHA-256: {hash_hex}")

    return local_path, hash_hex

@task(
    name="extract-cropped-frames",
    retries=2,
    retry_delay_seconds=60,
    tags=["crop-frames", "extraction"],
    log_prints=True,
)
def extract_cropped_frames(
    video_path: str,
    output_dir: str,
    crop_bounds: dict[str, int],
    frame_rate: float = 10.0,
) -> tuple[str, int]:
    """
    Extract cropped frames at specified rate using crop_frames pipeline.

    Args:
        video_path: Path to video file
        output_dir: Directory to write frames
        crop_bounds: Dict with keys: left, top, right, bottom
        frame_rate: Frame extraction rate in Hz (default 10.0)

    Returns:
        Tuple of (output_dir, frame_count)
    """
    print(f"[Crop] Extracting frames from {video_path}")
    print(f"[Crop] Bounds: {crop_bounds}")
    print(f"[Crop] Rate: {frame_rate}Hz")

    # Ensure output directory exists
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Format crop bounds as string
    crop_str = (
        f"{crop_bounds['left']},{crop_bounds['top']},{crop_bounds['right']},{crop_bounds['bottom']}"
    )

    # Get absolute path to crop_frames pipeline
    pipeline_dir = Path(__file__).parent.parent.parent.parent / "data-pipelines" / "crop_frames"

    # Call crop_frames pipeline (extract frames only, no DB write)
    result = subprocess.run(
        [
            "uv",
            "run",
            "crop_frames",
            "extract-frames",
            video_path,
            output_dir,
            "--crop",
            crop_str,
            "--rate",
            str(frame_rate),
        ],
        cwd=str(pipeline_dir),
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        print(f"STDERR: {result.stderr}")
        raise RuntimeError(f"crop_frames pipeline failed: {result.stderr}")

    # Count extracted frames
    frame_files = sorted(Path(output_dir).glob("frame_*.jpg"))
    frame_count = len(frame_files)

    print(f"[Crop] Extracted {frame_count} frames to {output_dir}")

    return output_dir, frame_count

@task(
    name="encode-frames-to-webm-chunks",
    retries=2,
    retry_delay_seconds=60,
    tags=["encoding", "webm"],
    log_prints=True,
)
def encode_frames_to_webm_chunks(
    frames_dir: str,
    output_dir: str,
    crf: int = WEBM_CRF,
    bitrate: str = WEBM_BITRATE,
    frame_rate: float = 10.0,
) -> tuple[str, int, list[tuple[int, Path]]]:
    """
    Encode cropped frames as VP9/WebM chunks using hierarchical modulo levels.

    The encoding follows a hierarchical modulo-based structure for progressive loading:
    - Modulo 32: Every 32nd frame (coarse overview, loads first)
    - Modulo 16: Every 16th frame
    - Modulo 8: Every 8th frame
    - Modulo 4: Every 4th frame
    - Modulo 2: Every 2nd frame
    - Modulo 1: Every frame (finest detail, loads last)

    Each chunk contains exactly 32 frames at the specified modulo spacing.
    For example, modulo 32 chunk covering indices 0-1023 contains frames [0, 32, 64, ..., 992].

    Args:
        frames_dir: Directory containing frame_*.jpg files
        output_dir: Directory to write WebM chunks (organized by modulo)
        crf: VP9 CRF (0-63, lower = better quality)
        bitrate: Target bitrate (e.g., "500k")
        frame_rate: Frame rate for WebM video

    Returns:
        Tuple of (output_dir, total_chunk_count, list of (modulo, chunk_path) tuples)
    """
    print("[WebM] Encoding frames to hierarchical VP9/WebM chunks")
    print(f"[WebM] Modulo levels: {MODULO_LEVELS}")
    print(f"[WebM] Frames per chunk: {FRAMES_PER_CHUNK}")
    print(f"[WebM] CRF: {crf}, Bitrate: {bitrate}")

    # Ensure output directory exists
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Get all frame files sorted by frame index
    frame_files = sorted(Path(frames_dir).glob("frame_*.jpg"))
    total_frames = len(frame_files)

    if total_frames == 0:
        raise RuntimeError(f"No frames found in {frames_dir}")

    print(f"[WebM] Total frames: {total_frames}")

    all_chunks: list[tuple[int, Path]] = []
    total_chunk_count = 0

    # Process each modulo level
    for modulo in MODULO_LEVELS:
        print(f"\n[WebM] Processing modulo {modulo}...")

        # Create modulo directory
        modulo_dir = Path(output_dir) / f"modulo_{modulo}"
        modulo_dir.mkdir(exist_ok=True)

        # Calculate chunk size in frame indices
        # For modulo 32: 32 frames × 32 spacing = 1024 frame indices per chunk
        chunk_size_indices = FRAMES_PER_CHUNK * modulo

        # Generate chunks for this modulo level
        chunk_index = 0
        for chunk_start_idx in range(0, total_frames, chunk_size_indices):
            chunk_end_idx = min(chunk_start_idx + chunk_size_indices, total_frames)

            # Collect frames at modulo positions within this chunk
            chunk_frame_indices = []
            for frame_idx in range(chunk_start_idx, chunk_end_idx):
                if frame_idx % modulo == 0:
                    chunk_frame_indices.append(frame_idx)

            # Skip empty chunks
            if not chunk_frame_indices:
                continue

            # Get actual frame files for this chunk
            chunk_frame_files = [
                frame_files[idx] for idx in chunk_frame_indices if idx < len(frame_files)
            ]

            if not chunk_frame_files:
                continue

            # Encode this chunk
            chunk_output = modulo_dir / f"chunk_{chunk_index:04d}.webm"

            # Create a temporary file list for FFmpeg
            with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
                for frame_file in chunk_frame_files:
                    f.write(f"file '{frame_file.absolute()}'\n")
                    f.write(f"duration {1.0 / frame_rate}\n")
                filelist_path = f.name

            try:
                # Encode with FFmpeg: VP9 codec in WebM container
                result = subprocess.run(
                    [
                        "ffmpeg",
                        "-f",
                        "concat",
                        "-safe",
                        "0",
                        "-i",
                        filelist_path,
                        "-c:v",
                        "libvpx-vp9",
                        "-crf",
                        str(crf),
                        "-b:v",
                        bitrate,
                        "-row-mt",
                        "1",  # Multi-threading
                        "-y",  # Overwrite output
                        str(chunk_output),
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )

                if result.returncode != 0:
                    print(f"FFmpeg STDERR: {result.stderr}")
                    raise RuntimeError(
                        f"FFmpeg encoding failed for modulo {modulo} chunk {chunk_index}: {result.stderr}"
                    )

                all_chunks.append((modulo, chunk_output))
                total_chunk_count += 1
                print(
                    f"[WebM] ✓ Encoded modulo_{modulo}/chunk_{chunk_index:04d}.webm "
                    f"({len(chunk_frame_files)} frames, indices {chunk_start_idx}-{chunk_end_idx - 1})"
                )

            finally:
                # Clean up temporary file list
                Path(filelist_path).unlink(missing_ok=True)

            chunk_index += 1

        print(f"[WebM] Modulo {modulo}: {chunk_index} chunks")

    print(
        f"\n[WebM] Encoded {total_chunk_count} total chunks across {len(MODULO_LEVELS)} modulo levels"
    )

    return output_dir, total_chunk_count, all_chunks

@task(
    name="upload-chunks-to-wasabi",
    tags=["wasabi", "upload"],
    log_prints=True,
)
def upload_chunks_to_wasabi(
    chunks: list[tuple[int, Path]],
    tenant_id: str,
    video_id: str,
    version: int,
) -> tuple[int, int]:
    """
    Upload hierarchical modulo-based WebM chunks to Wasabi.

    Args:
        chunks: List of (modulo, chunk_path) tuples
        tenant_id: Tenant UUID
        video_id: Video UUID
        version: Version number

    Returns:
        Tuple of (chunk_count, total_size_bytes)
    """
    print(f"[Wasabi] Uploading {len(chunks)} hierarchical chunks (version {version})")

    client = get_wasabi_client()
    total_size = 0

    # Group chunks by modulo level for organized upload
    chunks_by_modulo: dict[int, list[Path]] = {}
    for modulo, chunk_path in chunks:
        if modulo not in chunks_by_modulo:
            chunks_by_modulo[modulo] = []
        chunks_by_modulo[modulo].append(chunk_path)

    # Upload chunks organized by modulo level
    for modulo in sorted(chunks_by_modulo.keys(), reverse=True):  # Upload coarsest first
        modulo_chunks = chunks_by_modulo[modulo]
        print(f"\n[Wasabi] Uploading modulo {modulo}: {len(modulo_chunks)} chunks...")

        for chunk_index, chunk_path in enumerate(modulo_chunks):
            storage_key = WasabiClient.build_chunk_storage_key(
                tenant_id=tenant_id,
                video_id=video_id,
                chunk_type="cropped_frames",
                chunk_index=chunk_index,
                version=version,
                modulo=modulo,
            )

            client.upload_file(
                local_path=str(chunk_path),
                storage_key=storage_key,
                content_type="video/webm",
            )

            total_size += chunk_path.stat().st_size

        print(f"[Wasabi] ✓ Uploaded modulo {modulo}")

    print(f"\n[Wasabi] Uploaded {len(chunks)} total chunks ({total_size / 1024 / 1024:.2f} MB)")

    return len(chunks), total_size

@task(
    name="create-version-record",
    tags=["supabase", "version"],
    log_prints=True,
)
def create_version_record(
    video_id: str,
    tenant_id: str,
    version: int,
    crop_bounds: dict[str, int],
    frame_rate: float,
    layout_db_storage_key: str,
    layout_db_hash: str,
    created_by_user_id: str | None,
    prefect_flow_run_id: str,
) -> dict[str, Any]:
    """Create a new cropped frames version record in Supabase."""
    print(f"[Supabase] Creating version record: v{version}")

    versions_repo = CroppedFramesVersionRepository()

    storage_prefix = WasabiClient.build_chunk_prefix(
        tenant_id=tenant_id,
        video_id=video_id,
        chunk_type="cropped_frames",
        version=version,
    )

    version_record = versions_repo.create_version(
        video_id=video_id,
        tenant_id=tenant_id,
        version=version,
        storage_prefix=storage_prefix,
        crop_bounds=crop_bounds,
        frame_rate=frame_rate,
        layout_db_storage_key=layout_db_storage_key,
        layout_db_hash=layout_db_hash,
        created_by_user_id=created_by_user_id,
        prefect_flow_run_id=prefect_flow_run_id,
    )

    print(f"[Supabase] Version record created: {version_record['id']}")

    return version_record  # type: ignore[return-value]

@task(
    name="update-version-metadata",
    tags=["supabase", "version"],
    log_prints=True,
)
def update_version_metadata(
    version_id: str,
    chunk_count: int,
    total_frames: int,
    total_size_bytes: int,
) -> None:
    """Update version record with chunk metadata."""
    print("[Supabase] Updating version metadata")

    versions_repo = CroppedFramesVersionRepository()

    versions_repo.update_version_chunks(
        version_id=version_id,
        chunk_count=chunk_count,
        total_frames=total_frames,
        total_size_bytes=total_size_bytes,
    )

    print(f"[Supabase] Version metadata updated: {chunk_count} chunks, {total_frames} frames")

@task(
    name="activate-version",
    tags=["supabase", "version"],
    log_prints=True,
)
def activate_version(version_id: str) -> None:
    """Activate the version (archives previous active version)."""
    print(f"[Supabase] Activating version: {version_id}")

    versions_repo = CroppedFramesVersionRepository()
    versions_repo.activate_version(version_id)

    print("[Supabase] Version activated (previous version archived)")

@flow(
    name="crop-frames-to-webm",
    log_prints=True,
    retries=1,
    retry_delay_seconds=120,
)
def crop_frames_to_webm_flow(
    video_id: str,
    tenant_id: str = DEFAULT_TENANT_ID,
    filename: str | None = None,
    crop_bounds: dict[str, int] | None = None,
    frame_rate: float = 10.0,
    created_by_user_id: str | None = None,
) -> dict[str, Any]:
    """
    Generate versioned cropped frames as WebM chunks.

    This flow:
    1. Downloads video and layout.db from Wasabi
    2. Creates new version record in Supabase
    3. Extracts cropped frames at 10Hz
    4. Encodes frames as VP9/WebM chunks
    5. Uploads chunks to Wasabi
    6. Activates new version (archives previous version)

    The app always uses the latest "active" version for annotation workflows.
    Previous versions are archived but retained for ML training reproducibility.

    Args:
        video_id: Video UUID
        tenant_id: Tenant UUID (defaults to demo tenant)
        filename: Video filename (required if not in Supabase)
        crop_bounds: Crop bounds dict {left, top, right, bottom} (if not provided, reads from layout.db)
        frame_rate: Frame extraction rate in Hz (default 10.0)
        created_by_user_id: User UUID who initiated

    Returns:
        Dict with version info and metrics
    """
    from prefect.runtime import flow_run

    flow_run_id = str(flow_run.id)

    print(f"🎬 Starting cropped frames generation for video: {video_id}")
    print(f"🏢 Tenant ID: {tenant_id}")

    # Create temporary working directory
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        try:
            # Get video metadata from Supabase if filename not provided
            if not filename:
                print("[Supabase] Fetching video metadata")
                video_repo = VideoRepository()
                video_record = video_repo.get_video(video_id)
                if not video_record:
                    raise ValueError(f"Video not found: {video_id}")
                filename = video_record["filename"]
                if not filename:
                    raise ValueError(f"Video filename not set in database for video: {video_id}")

            # Step 1: Download video from Wasabi
            print("\n📥 Step 1/8: Downloading video from Wasabi...")
            video_path = str(temp_path / filename)
            download_video_from_wasabi(
                tenant_id=tenant_id,
                video_id=video_id,
                filename=filename,
                local_path=video_path,
            )

            # Step 2: Download layout.db from Wasabi
            print("\n📥 Step 2/8: Downloading layout.db from Wasabi...")
            layout_db_path = str(temp_path / "layout.db")
            layout_db_path, layout_db_hash = download_layout_db_from_wasabi(
                tenant_id=tenant_id,
                video_id=video_id,
                local_path=layout_db_path,
            )

            layout_db_storage_key = WasabiClient.build_storage_key(tenant_id, video_id, "layout.db")

            # TODO: Read crop_bounds from layout.db if not provided
            if not crop_bounds:
                raise ValueError("crop_bounds parameter is required (TODO: read from layout.db)")

            # Step 3: Get next version number
            print("\n📋 Step 3/8: Getting next version number...")
            versions_repo = CroppedFramesVersionRepository()
            version = versions_repo.get_next_version(video_id)
            print(f"[Version] Next version: v{version}")

            # Step 4: Create version record
            print("\n📝 Step 4/8: Creating version record...")
            version_record = create_version_record(
                video_id=video_id,
                tenant_id=tenant_id,
                version=version,
                crop_bounds=crop_bounds,
                frame_rate=frame_rate,
                layout_db_storage_key=layout_db_storage_key,
                layout_db_hash=layout_db_hash,
                created_by_user_id=created_by_user_id,
                prefect_flow_run_id=flow_run_id,
            )

            version_id = version_record["id"]

            # Step 5: Extract cropped frames
            print("\n🎞️  Step 5/8: Extracting cropped frames...")
            frames_dir = str(temp_path / "frames")
            frames_dir, total_frames = extract_cropped_frames(
                video_path=video_path,
                output_dir=frames_dir,
                crop_bounds=crop_bounds,
                frame_rate=frame_rate,
            )

            # Step 6: Encode frames to WebM chunks (hierarchical modulo levels)
            print("\n🎬 Step 6/8: Encoding frames to WebM chunks...")
            chunks_dir = str(temp_path / "chunks")
            chunks_dir, chunk_count, chunks = encode_frames_to_webm_chunks(
                frames_dir=frames_dir,
                output_dir=chunks_dir,
                frame_rate=frame_rate,
            )

            # Step 7: Upload chunks to Wasabi (organized by modulo level)
            print("\n📤 Step 7/8: Uploading chunks to Wasabi...")
            chunk_count, total_size_bytes = upload_chunks_to_wasabi(
                chunks=chunks,
                tenant_id=tenant_id,
                video_id=video_id,
                version=version,
            )

            # Step 8: Update version metadata
            print("\n📊 Step 8/8: Updating version metadata...")
            update_version_metadata(
                version_id=version_id,
                chunk_count=chunk_count,
                total_frames=total_frames,
                total_size_bytes=total_size_bytes,
            )

            # Step 9: Activate version
            print("\n✅ Activating version...")
            activate_version(version_id)

            # Create Prefect artifact for visibility
            create_table_artifact(
                key=f"video-{video_id}-cropped-frames-v{version}",
                table={
                    "Video ID": [video_id],
                    "Version": [f"v{version}"],
                    "Total Frames": [total_frames],
                    "Chunk Count": [chunk_count],
                    "Total Size (MB)": [f"{total_size_bytes / 1024 / 1024:.2f}"],
                    "Frame Rate": [f"{frame_rate} Hz"],
                    "Status": ["Active"],
                },
                description=f"Cropped frames v{version} for {video_id}",
            )

            print("\n✅ Cropped frames generation complete!")
            print(f"📊 Version: v{version}")
            print(f"📊 Frames: {total_frames}, Chunks: {chunk_count}")
            print(f"📊 Size: {total_size_bytes / 1024 / 1024:.2f} MB")

            return {
                "video_id": video_id,
                "version": version,
                "version_id": version_id,
                "total_frames": total_frames,
                "chunk_count": chunk_count,
                "total_size_bytes": total_size_bytes,
                "status": "completed",
            }

        except Exception as e:
            print(f"\n❌ Cropped frames generation failed: {e}")
            raise

        finally:
            # Cleanup temporary files
            if temp_path and temp_path.exists():
                print(f"\n🧹 Cleaning up temporary files at {temp_path}")
                import shutil
                shutil.rmtree(temp_path, ignore_errors=True)
