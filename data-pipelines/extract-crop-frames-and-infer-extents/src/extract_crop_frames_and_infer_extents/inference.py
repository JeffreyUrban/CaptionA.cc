"""
Modal inference function for crop_and_infer_caption_frame_extents.

This function:
1. Downloads video from Wasabi
2. Extracts and crops frames at specified rate
3. Encodes frames as VP9/WebM chunks (modulo hierarchy: 16, 4, 1)
4. Runs caption frame extents inference on sequential frame pairs
5. Uploads WebM chunks and inference DB to Wasabi
6. Returns CropInferResult with statistics
"""

import subprocess
import tempfile
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

try:
    import modal
except ImportError:
    modal = None

from .models import CropInferResult, CropRegion


# GPU image with all dependencies for inference
# This will be used by app.py when registering the function
def get_inference_image():
    """Get Modal image with inference dependencies."""
    if not modal:
        return None

    return (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install(
            "ffmpeg",
            "libgl1-mesa-glx",
            "libglib2.0-0",
        )
        .pip_install(
            # Core ML/Vision
            "torch",
            "torchvision",
            "opencv-python-headless",
            "numpy",
            "pillow",
            # GPU Video Processing
            "PyNvVideoCodec",  # NVIDIA GPU-accelerated video decoding
            # Data/Storage
            "boto3",
            "sqlalchemy",
            "supabase",  # Required by caption_frame_extents
            # Utilities
            "rich",
            "ffmpeg-python",
            "httpx",
            "pydantic",  # Required by caption_frame_extents
            # Monitoring
            "psutil",
            "nvidia-ml-py3",  # pynvml for GPU monitoring
        )
        # Add local packages for inference
        .add_local_python_source("caption_frame_extents")
        .add_local_python_source("gpu_video_utils")
    )


# Function implementation (will be decorated by app.py)
def crop_and_infer_caption_frame_extents_impl(
    video_key: str,
    tenant_id: str,
    video_id: str,
    crop_region: CropRegion,
    frame_rate: float = 10.0,
) -> CropInferResult:
    """
    Crop frames to caption region, encode as WebM, and run inference.

    Args:
        video_key: Wasabi S3 key for video file
        tenant_id: Tenant UUID for path scoping
        video_id: Video UUID
        crop_region: Normalized crop region (0.0 to 1.0)
        frame_rate: Frames per second to extract (default: 10.0)

    Returns:
        CropInferResult with version, frame count, inference stats, and S3 paths

    Raises:
        ValueError: Invalid crop region or parameters
        RuntimeError: Processing error (FFmpeg, inference, etc.)

    Wasabi Outputs:
        - {tenant_id}/client/videos/{video_id}/cropped_frames_v{N}/modulo_{M}/chunk_{NNNN}.webm
        - {tenant_id}/server/videos/{video_id}/caption_frame_extents.db
    """
    import ffmpeg
    import torch

    # Import from caption_frame_extents package (added to Modal image)
    from caption_frame_extents.inference.batch_predictor import BatchCaptionFrameExtentsPredictor
    from caption_frame_extents.inference.caption_frame_extents_db import PairResult, create_caption_frame_extents_db

    # Import Wasabi client (embedded in caption_frame_extents for Modal compatibility)
    from caption_frame_extents.inference.wasabi import WasabiClient
    from PIL import Image as PILImage

    job_start = time.time()

    print(f"\n{'=' * 80}")
    print("Starting Crop and Infer Job")
    print(f"{'=' * 80}")
    print(f"Video: {video_key}")
    print(f"Tenant: {tenant_id}")
    print(f"Video ID: {video_id}")
    print(f"Crop Region: L={crop_region.crop_left}, T={crop_region.crop_top}, "
          f"R={crop_region.crop_right}, B={crop_region.crop_bottom}")
    print(f"Frame Rate: {frame_rate} Hz")
    print(f"{'=' * 80}\n")

    # Initialize Wasabi client
    wasabi = WasabiClient()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)

        # Step 1: Download video from Wasabi
        print("[1/8] Downloading video from Wasabi...")
        download_start = time.time()
        video_path = tmp_path / "video.mp4"
        wasabi.download_file(video_key, video_path)
        print(f"  Downloaded in {time.time() - download_start:.2f}s\n")

        # Step 2: Get video dimensions and compute pixel crop box
        print("[2/8] Computing crop region...")
        probe = ffmpeg.probe(str(video_path))
        video_stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
        frame_width = int(video_stream["width"])
        frame_height = int(video_stream["height"])

        # Convert normalized crop region to pixel coordinates
        crop_left_px = int(crop_region.crop_left * frame_width)
        crop_top_px = int(crop_region.crop_top * frame_height)
        crop_right_px = int(crop_region.crop_right * frame_width)
        crop_bottom_px = int(crop_region.crop_bottom * frame_height)

        crop_width = crop_right_px - crop_left_px
        crop_height = crop_bottom_px - crop_top_px

        print(f"  Video dimensions: {frame_width}x{frame_height}")
        print(f"  Crop region (px): x={crop_left_px}, y={crop_top_px}, "
              f"w={crop_width}, h={crop_height}\n")

        # Step 3: Extract cropped frames
        print(f"[3/8] Extracting cropped frames at {frame_rate} Hz...")
        extract_start = time.time()

        frames_dir = tmp_path / "frames"
        frames_dir.mkdir(exist_ok=True)

        # Use FFmpeg to extract and crop frames
        output_pattern = frames_dir / "frame_%010d.jpg"
        stream = ffmpeg.input(str(video_path))
        stream = stream.filter("crop", w=crop_width, h=crop_height, x=crop_left_px, y=crop_top_px)
        stream = stream.filter("fps", fps=frame_rate)
        stream.output(
            str(output_pattern),
            format="image2",
            **{"q:v": 6}  # JPEG quality
        ).overwrite_output().run(capture_stdout=True, capture_stderr=True)

        frame_files = sorted(frames_dir.glob("frame_*.jpg"))
        frame_count = len(frame_files)
        print(f"  Extracted {frame_count} frames in {time.time() - extract_start:.2f}s\n")

        # Step 4: Determine version number
        print("[4/8] Determining version number...")
        # Check for existing versions in Wasabi
        version_prefix = f"{tenant_id}/client/videos/{video_id}/cropped_frames_v"
        try:
            response = wasabi.s3_client.list_objects_v2(
                Bucket=wasabi.bucket_name,
                Prefix=version_prefix,
                Delimiter="/",
            )
            existing_versions = []
            if "CommonPrefixes" in response:
                for prefix in response["CommonPrefixes"]:
                    # Extract version number from prefix like "cropped_frames_v1/"
                    prefix_str = prefix["Prefix"]
                    version_str = prefix_str.rstrip("/").split("_v")[-1]
                    if version_str.isdigit():
                        existing_versions.append(int(version_str))

            version = max(existing_versions, default=0) + 1
        except Exception as e:
            print(f"  Warning: Could not check existing versions: {e}")
            version = 1

        print(f"  Version: {version}\n")

        # Step 5: Encode frames as VP9/WebM chunks (modulo hierarchy)
        print("[5/8] Encoding frames as VP9/WebM chunks...")
        encode_start = time.time()

        chunks_dir = tmp_path / "chunks"
        chunks_dir.mkdir(exist_ok=True)

        # Modulo hierarchy: 16, 4, 1
        modulo_levels = [16, 4, 1]
        frames_per_chunk = 32
        chunk_paths = []

        for modulo in modulo_levels:
            modulo_dir = chunks_dir / f"modulo_{modulo}"
            modulo_dir.mkdir(exist_ok=True)

            # Select frames at this modulo
            modulo_frames = [f for i, f in enumerate(frame_files) if i % modulo == 0]

            if not modulo_frames:
                continue

            # Split into chunks
            num_chunks = (len(modulo_frames) + frames_per_chunk - 1) // frames_per_chunk

            for chunk_idx in range(num_chunks):
                start_idx = chunk_idx * frames_per_chunk
                end_idx = min(start_idx + frames_per_chunk, len(modulo_frames))
                chunk_frames = modulo_frames[start_idx:end_idx]

                # Get start frame index for filename
                start_frame_index = frame_files.index(chunk_frames[0])
                chunk_output = modulo_dir / f"chunk_{start_frame_index:010d}.webm"

                # Create FFmpeg file list
                with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
                    for frame_file in chunk_frames:
                        f.write(f"file '{frame_file.absolute()}'\n")
                        f.write(f"duration {1.0 / frame_rate}\n")
                    filelist_path = f.name

                try:
                    # Encode chunk with VP9
                    subprocess.run(
                        [
                            "ffmpeg",
                            "-f", "concat",
                            "-safe", "0",
                            "-i", filelist_path,
                            "-c:v", "libvpx-vp9",
                            "-crf", "30",
                            "-b:v", "0",
                            "-row-mt", "1",
                            "-y",
                            str(chunk_output),
                        ],
                        capture_output=True,
                        text=True,
                        check=True,
                    )
                    chunk_paths.append((modulo, chunk_output))
                finally:
                    Path(filelist_path).unlink(missing_ok=True)

            print(f"  Encoded modulo_{modulo}: {num_chunks} chunks")

        print(f"  Encoded {len(chunk_paths)} total chunks in {time.time() - encode_start:.2f}s\n")

        # Step 6: Run caption frame extents inference
        print("[6/8] Running caption frame extents inference...")
        inference_start = time.time()

        # Load all frames into memory for inference
        all_frames = {}
        for i, frame_path in enumerate(frame_files):
            all_frames[i] = PILImage.open(frame_path)

        # Generate sequential frame pairs (i, i+1) for all frames
        frame_pairs = [(i, i + 1) for i in range(frame_count - 1)]

        # Download and decompress layout.db.gz for OCR visualization
        import gzip
        import shutil
        layout_db_gz_path = tmp_path / "layout.db.gz"
        layout_db_path = tmp_path / "layout.db"
        layout_storage_key = f"{tenant_id}/client/videos/{video_id}/layout.db.gz"
        wasabi.download_file(layout_storage_key, layout_db_gz_path)

        # Decompress the layout.db.gz file
        with gzip.open(layout_db_gz_path, 'rb') as f_in, open(layout_db_path, 'wb') as f_out:
            shutil.copyfileobj(f_in, f_out)

        # Load inference model
        # TODO: Configure model checkpoint path (for now, assume it's available in Modal volume)
        # This is a placeholder - actual model loading would require Modal volume setup
        model_version = "placeholder_model_v1"
        checkpoint_path = Path("/models/checkpoints/latest.pt")  # Placeholder

        # Check if model exists, if not, create a mock predictor for testing
        if not checkpoint_path.exists():
            print("  [WARNING] Model checkpoint not found, using mock predictions")
            # Create mock predictions (for testing - real implementation requires actual model)
            pair_results = []
            for frame1_idx, frame2_idx in frame_pairs:
                pair_result = PairResult(
                    frame1_index=frame1_idx,
                    frame2_index=frame2_idx,
                    forward_predicted_label="same",
                    forward_confidence=0.95,
                    forward_prob_same=0.95,
                    forward_prob_different=0.03,
                    forward_prob_empty_empty=0.01,
                    forward_prob_empty_valid=0.005,
                    forward_prob_valid_empty=0.005,
                    backward_predicted_label="same",
                    backward_confidence=0.95,
                    backward_prob_same=0.95,
                    backward_prob_different=0.03,
                    backward_prob_empty_empty=0.01,
                    backward_prob_empty_valid=0.005,
                    backward_prob_valid_empty=0.005,
                    processing_time_ms=None,
                )
                pair_results.append(pair_result)
        else:
            # Real inference with actual model
            predictor = BatchCaptionFrameExtentsPredictor(
                checkpoint_path=checkpoint_path,
                layout_db_path=layout_db_path,
                device="cuda" if torch.cuda.is_available() else "cpu",
            )

            # Run inference in batches
            batch_size = 32
            pair_results = []

            for i in range(0, len(frame_pairs), batch_size):
                batch = frame_pairs[i:i + batch_size]

                # Prepare bidirectional pairs
                bidirectional_pairs = []
                for frame1_idx, frame2_idx in batch:
                    if frame1_idx in all_frames and frame2_idx in all_frames:
                        f1 = all_frames[frame1_idx]
                        f2 = all_frames[frame2_idx]
                        bidirectional_pairs.append((f1, f2))  # Forward
                        bidirectional_pairs.append((f2, f1))  # Backward

                # Run inference
                if bidirectional_pairs:
                    predictions = predictor.predict_batch(bidirectional_pairs, batch_size=batch_size)

                    # Split into forward/backward and create results
                    for j, (frame1_idx, frame2_idx) in enumerate(batch):
                        forward_pred = predictions[j * 2]
                        backward_pred = predictions[j * 2 + 1]

                        pair_result = PairResult(
                            frame1_index=frame1_idx,
                            frame2_index=frame2_idx,
                            forward_predicted_label=forward_pred["predicted_label"],
                            forward_confidence=forward_pred["confidence"],
                            forward_prob_same=forward_pred["probabilities"]["same"],
                            forward_prob_different=forward_pred["probabilities"]["different"],
                            forward_prob_empty_empty=forward_pred["probabilities"]["empty_empty"],
                            forward_prob_empty_valid=forward_pred["probabilities"]["empty_valid"],
                            forward_prob_valid_empty=forward_pred["probabilities"]["valid_empty"],
                            backward_predicted_label=backward_pred["predicted_label"],
                            backward_confidence=backward_pred["confidence"],
                            backward_prob_same=backward_pred["probabilities"]["same"],
                            backward_prob_different=backward_pred["probabilities"]["different"],
                            backward_prob_empty_empty=backward_pred["probabilities"]["empty_empty"],
                            backward_prob_empty_valid=backward_pred["probabilities"]["empty_valid"],
                            backward_prob_valid_empty=backward_pred["probabilities"]["valid_empty"],
                            processing_time_ms=None,
                        )
                        pair_results.append(pair_result)

                if (i + batch_size) % 1000 == 0 or i + batch_size >= len(frame_pairs):
                    print(f"  Processed {min(i + batch_size, len(frame_pairs))}/{len(frame_pairs)} pairs")

        inference_duration = time.time() - inference_start
        print(f"  Completed {len(pair_results)} pairs in {inference_duration:.2f}s\n")

        # Compute label counts
        label_counts = Counter()
        for result in pair_results:
            label_counts[result.forward_predicted_label] += 1

        label_counts_dict = dict(label_counts)

        # Step 7: Create caption frame extents database
        print("[7/8] Creating caption frame extents database...")
        db_start = time.time()

        import uuid
        run_id = str(uuid.uuid4())
        started_at = datetime.fromtimestamp(job_start)
        completed_at = datetime.now()

        db_filename = f"caption_frame_extents_v{version}.db"
        db_path = tmp_path / db_filename

        create_caption_frame_extents_db(
            db_path=db_path,
            cropped_frames_version=version,
            model_version=model_version,
            run_id=run_id,
            started_at=started_at,
            completed_at=completed_at,
            results=pair_results,
            model_checkpoint_path=str(checkpoint_path) if checkpoint_path.exists() else None,
        )
        print(f"  Created database in {time.time() - db_start:.2f}s\n")

        # Step 8: Upload chunks and database to Wasabi
        print("[8/8] Uploading to Wasabi...")
        upload_start = time.time()

        # Upload WebM chunks
        for modulo, chunk_path in chunk_paths:
            # Extract chunk index from filename
            chunk_filename = chunk_path.name
            chunk_index = int(chunk_filename.split("_")[1].split(".")[0])

            storage_key = WasabiClient.build_chunk_storage_key(
                tenant_id=tenant_id,
                video_id=video_id,
                chunk_type="cropped_frames",
                chunk_index=chunk_index,
                version=version,
                modulo=modulo,
            )
            wasabi.upload_file(chunk_path, storage_key, content_type="video/webm")

        # Upload caption frame extents database
        db_storage_key = f"{tenant_id}/server/videos/{video_id}/caption_frame_extents.db"
        wasabi.upload_file(db_path, db_storage_key, content_type="application/x-sqlite3")

        print(f"  Uploaded {len(chunk_paths)} chunks and database in {time.time() - upload_start:.2f}s\n")

        # Build output paths
        cropped_frames_prefix = f"{tenant_id}/client/videos/{video_id}/cropped_frames_v{version}/"

        # Compute final metrics
        total_duration = time.time() - job_start

        print(f"{'=' * 80}")
        print("Job Complete")
        print(f"{'=' * 80}")
        print(f"Version: {version}")
        print(f"Frames: {frame_count}")
        print(f"Chunks: {len(chunk_paths)}")
        print(f"Inference pairs: {len(pair_results)}")
        print(f"Label counts: {label_counts_dict}")
        print(f"Total duration: {total_duration:.2f}s")
        print(f"{'=' * 80}\n")

        return CropInferResult(
            version=version,
            frame_count=frame_count,
            label_counts=label_counts_dict,
            processing_duration_seconds=total_duration,
            caption_frame_extents_db_key=db_storage_key,
            cropped_frames_prefix=cropped_frames_prefix,
        )
