"""
Sequential implementation of crop_and_infer_caption_frame_extents.

This module implements a GPU-accelerated sequential pipeline:
1. GPU-accelerated frame extraction with precise FPS timing (PyNvVideoCodec)
2. GPU-accelerated cropping (PyTorch tensor slicing)
3. Batch inference on saved frames
4. Parallel VP9 encoding on CPU (multiple workers)

Architecture:
    PyNvVideoCodec Decoder → Precise FPS → GPU Crop → CPU Transfer → Saved Frames → GPU Inference → Results
                                                                                                        ↓
                                                                                                 Encoder Pool → Wasabi Upload

Key optimizations:
- Zero-copy GPU decoding via DLPack
- GPU cropping before CPU transfer (15x less data)
- Precise timing: maintains 0.1s accuracy over 10+ hours

IMPORTANT: This includes performance instrumentation to measure bottlenecks.
"""

import subprocess
import tempfile
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Iterator, Tuple

import ffmpeg
import numpy as np
import torch
from PIL import Image as PILImage

try:
    import PyNvVideoCodec as nvvc
    PYNVVIDEOCODEC_AVAILABLE = True
except ImportError:
    PYNVVIDEOCODEC_AVAILABLE = False

from .models import CropInferResult, CropRegion

# Import from caption_frame_extents package
from caption_frame_extents.inference.batch_predictor import BatchCaptionFrameExtentsPredictor
from caption_frame_extents.inference.caption_frame_extents_db import PairResult, create_caption_frame_extents_db
from caption_frame_extents.inference.wasabi import WasabiClient

# Try to import monitoring libraries
try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False

try:
    import pynvml
    pynvml.nvmlInit()
    GPU_MONITORING_AVAILABLE = True
except Exception:
    GPU_MONITORING_AVAILABLE = False


def get_gpu_metrics():
    """Get current GPU utilization and memory usage."""
    if not GPU_MONITORING_AVAILABLE:
        return None

    try:
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)
        memory_info = pynvml.nvmlDeviceGetMemoryInfo(handle)

        return {
            "gpu_util_percent": utilization.gpu,
            "gpu_memory_used_gb": memory_info.used / (1024**3),
            "gpu_memory_total_gb": memory_info.total / (1024**3),
        }
    except Exception:
        return None


def get_system_metrics():
    """Get current CPU and system memory usage."""
    if not PSUTIL_AVAILABLE:
        return None

    try:
        return {
            "cpu_percent": psutil.cpu_percent(interval=0.1),
            "memory_used_gb": psutil.virtual_memory().used / (1024**3),
            "memory_total_gb": psutil.virtual_memory().total / (1024**3),
        }
    except Exception:
        return None


class FrameExtractor:
    """GPU-accelerated frame extractor using PyNvVideoCodec with FPS decimation."""

    def __init__(
        self,
        video_path: Path,
        crop_region: CropRegion,
        frame_width: int,
        frame_height: int,
        native_fps: float,
        target_fps: float,
        save_to_disk: bool = True,
        frames_dir: Path | None = None,
    ):
        if not PYNVVIDEOCODEC_AVAILABLE:
            raise RuntimeError("PyNvVideoCodec is not installed. Install with: pip install pynvvideocodec")

        self.video_path = video_path
        self.crop_region = crop_region
        self.frame_width = frame_width
        self.frame_height = frame_height
        self.native_fps = native_fps
        self.target_fps = target_fps
        self.save_to_disk = save_to_disk
        self.frames_dir = frames_dir

        # Compute crop box in pixels
        self.crop_left_px = int(crop_region.crop_left * frame_width)
        self.crop_top_px = int(crop_region.crop_top * frame_height)
        self.crop_right_px = int(crop_region.crop_right * frame_width)
        self.crop_bottom_px = int(crop_region.crop_bottom * frame_height)
        self.crop_width = self.crop_right_px - self.crop_left_px
        self.crop_height = self.crop_bottom_px - self.crop_top_px

    def extract_frames_stream(self) -> Iterator[Tuple[int, np.ndarray]]:
        """
        Stream frames using GPU-accelerated extraction with precise timing.

        Calculates exact frame indices for target FPS to maintain 0.1s accuracy over
        10+ hours while enabling pipelining (decode → crop → inference streaming).

        Yields:
            Tuple of (frame_index, frame_array)
            - frame_index: Sequential output frame number (0, 1, 2, ...)
            - frame_array: RGB numpy array (H, W, 3) uint8, cropped to caption region
        """
        print(f"  Initializing PyNvVideoCodec SimpleDecoder with precise frame timing...")
        print(f"    Video: {self.video_path}")
        print(f"    Native FPS: {self.native_fps}, Target FPS: {self.target_fps}")

        # Initialize PyNvVideoCodec SimpleDecoder
        # This wrapper class provides convenient frame access with RGB output
        decoder = nvvc.SimpleDecoder(
            enc_file_path=str(self.video_path),
            gpu_id=0,
            use_device_memory=True,
            output_color_type=nvvc.OutputColorType.RGB,
        )

        # Get total frame count and duration
        total_frames = len(decoder)  # SimpleDecoder supports len()
        video_duration = total_frames / self.native_fps
        num_output_frames = int(video_duration * self.target_fps)

        print(f"    Total frames in video: {total_frames}")
        print(f"    Video duration: {video_duration:.2f}s")
        print(f"    Target output frames: {num_output_frames} at {self.target_fps} FPS")
        print(f"    Time interval: {1.0/self.target_fps:.3f}s between frames\n")

        try:
            output_frame_idx = 0

            # Calculate precise frame index for each target time
            # This maintains 0.1s accuracy over 10+ hours
            for output_idx in range(num_output_frames):
                # Target time for this output frame
                target_time = output_idx / self.target_fps  # 0.0s, 0.1s, 0.2s, ...

                # Convert time to native frame index
                native_frame_idx = round(target_time * self.native_fps)

                # Clamp to valid range
                native_frame_idx = min(native_frame_idx, total_frames - 1)

                # Decode specific frame using SimpleDecoder indexing
                # SimpleDecoder returns frames as DLPack tensors
                frame_dlpack = decoder[native_frame_idx]

                if frame_dlpack is None:
                    print(f"    Warning: Failed to decode frame {native_frame_idx} (output {output_idx})")
                    continue

                # Convert DLPack tensor to PyTorch (zero-copy on GPU)
                frame_tensor = torch.from_dlpack(frame_dlpack)

                # Crop on GPU using PyTorch tensor slicing
                # This is much faster than cropping after CPU transfer
                # Transfers 15x less data: 402×27×3 vs 640×360×3
                cropped_tensor = frame_tensor[
                    self.crop_top_px:self.crop_bottom_px,
                    self.crop_left_px:self.crop_right_px,
                    :
                ]

                # Transfer cropped frame to CPU
                cropped_frame = cropped_tensor.cpu().numpy()

                # Optionally save to disk for VP9 encoding
                if self.save_to_disk and self.frames_dir:
                    frame_path = self.frames_dir / f"frame_{output_frame_idx:010d}.jpg"
                    PILImage.fromarray(cropped_frame).save(frame_path, quality=95)

                yield output_frame_idx, cropped_frame
                output_frame_idx += 1

                # Progress reporting every 1000 frames
                if output_frame_idx % 1000 == 0:
                    elapsed_time = output_frame_idx / self.target_fps
                    print(f"    Extracted {output_frame_idx}/{num_output_frames} frames ({elapsed_time:.1f}s)")

            print(f"\n  PyNvVideoCodec extraction stats:")
            print(f"    Input frames: {total_frames} at {self.native_fps} FPS")
            print(f"    Output frames extracted: {output_frame_idx} at {self.target_fps} FPS")
            print(f"    Timing method: Calculated indices (target_time * native_fps)")

        except Exception as e:
            print(f"  Error during frame extraction: {e}")
            import traceback
            traceback.print_exc()
            raise


class PerformanceMetrics:
    """Track pipeline performance metrics."""

    def __init__(self):
        self.extraction_start = 0.0
        self.extraction_end = 0.0
        self.inference_start = 0.0
        self.inference_end = 0.0
        self.encoding_start = 0.0
        self.encoding_end = 0.0
        self.frames_extracted = 0
        self.pairs_inferred = 0
        self.chunks_encoded = 0

    def report(self):
        """Print performance report."""
        extraction_time = self.extraction_end - self.extraction_start
        inference_time = self.inference_end - self.inference_start
        encoding_time = self.encoding_end - self.encoding_start

        print(f"\n{'=' * 80}")
        print(f"PERFORMANCE METRICS")
        print(f"{'=' * 80}")
        print(f"Extraction:")
        print(f"  • Time: {extraction_time:.2f}s")
        print(f"  • Frames: {self.frames_extracted}")
        print(f"  • Throughput: {self.frames_extracted / extraction_time:.1f} fps")
        print(f"\nInference:")
        print(f"  • Time: {inference_time:.2f}s")
        print(f"  • Pairs: {self.pairs_inferred}")
        print(f"  • Throughput: {self.pairs_inferred / inference_time:.1f} pairs/sec")
        print(f"\nEncoding:")
        print(f"  • Time: {encoding_time:.2f}s")
        print(f"  • Chunks: {self.chunks_encoded}")
        print(f"  • Throughput: {self.frames_extracted / encoding_time:.1f} fps")
        print(f"\nOverlap Analysis:")
        # Check if inference finished before extraction
        inference_wait = max(0, self.extraction_end - self.inference_end)
        print(f"  • Inference wait for extraction: {inference_wait:.2f}s")
        # Check if encoding is bottleneck
        total_pipeline = max(extraction_time, inference_time)
        if encoding_time > total_pipeline * 1.5:
            print(f"  ⚠️  BOTTLENECK: Encoding is {encoding_time/total_pipeline:.1f}x slower than GPU pipeline")
            print(f"     Consider offloading VP9 encoding to separate instances")
        else:
            print(f"  ✓ Encoding throughput is adequate ({encoding_time/total_pipeline:.1f}x GPU pipeline time)")
        print(f"{'=' * 80}\n")


def extract_all_frames(
    frame_extractor: FrameExtractor,
    metrics: PerformanceMetrics | None = None,
) -> int:
    """Extract all frames sequentially and save to disk."""
    if metrics:
        metrics.extraction_start = time.time()

    frame_count = 0
    for frame_idx, frame in frame_extractor.extract_frames_stream():
        frame_count = frame_idx + 1

    # Verify actual file count on disk
    if frame_extractor.save_to_disk and frame_extractor.frames_dir:
        actual_files = sorted(frame_extractor.frames_dir.glob("frame_*.jpg"))
        print(f"  Files on disk: {len(actual_files)}")
        if len(actual_files) != frame_count:
            print(f"  WARNING: Mismatch! Generator yielded {frame_count} but {len(actual_files)} files on disk")

    if metrics:
        metrics.extraction_end = time.time()
        metrics.frames_extracted = frame_count

    print(f"  Extraction complete: {frame_count} frames")
    return frame_count


def run_inference_sequential(
    frames_dir: Path,
    predictor: BatchCaptionFrameExtentsPredictor,
    batch_size: int = 32,
    metrics: PerformanceMetrics | None = None,
) -> list[PairResult]:
    """Run inference on all frame pairs sequentially."""
    if metrics:
        metrics.inference_start = time.time()

    # Load all frame files
    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    print(f"  Loading {len(frame_files)} frames from disk...")

    frames = []
    for i, frame_file in enumerate(frame_files):
        frames.append(PILImage.open(frame_file))
        if (i + 1) % 500 == 0:
            print(f"    Loaded {i + 1} frames")

    print(f"  Loaded {len(frames)} frames")

    # Create frame pairs and run inference in batches
    pair_results = []
    num_pairs = len(frames) - 1

    if num_pairs < 1:
        print("  Warning: Not enough frames for inference")
        if metrics:
            metrics.inference_end = time.time()
            metrics.pairs_inferred = 0
        return pair_results

    print(f"  Running inference on {num_pairs} frame pairs...")

    # Process in batches
    max_pairs_per_batch = batch_size // 2  # Each pair needs 2 inferences (forward + backward)

    for batch_start in range(0, num_pairs, max_pairs_per_batch):
        batch_end = min(batch_start + max_pairs_per_batch, num_pairs)

        # Build batch inputs
        batch_inputs = []
        batch_pair_indices = []

        for pair_idx in range(batch_start, batch_end):
            f1 = frames[pair_idx]
            f2 = frames[pair_idx + 1]
            batch_inputs.append((f1, f2))  # Forward
            batch_inputs.append((f2, f1))  # Backward
            batch_pair_indices.append(pair_idx)

        # Run batched inference
        predictions = predictor.predict_batch(
            batch_inputs,
            batch_size=len(batch_inputs),
        )

        # Process results for each pair
        for i, pair_idx in enumerate(batch_pair_indices):
            forward_pred = predictions[i * 2]
            backward_pred = predictions[i * 2 + 1]

            pair_result = PairResult(
                frame1_index=pair_idx,
                frame2_index=pair_idx + 1,
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

        if batch_end % 500 == 0 or batch_end == num_pairs:
            gpu_metrics = get_gpu_metrics()
            sys_metrics = get_system_metrics()
            print(f"  Inference progress: {len(pair_results)}/{num_pairs} pairs")
            if gpu_metrics:
                print(f"    GPU: {gpu_metrics['gpu_util_percent']}% util, "
                      f"{gpu_metrics['gpu_memory_used_gb']:.1f}/{gpu_metrics['gpu_memory_total_gb']:.1f} GB")
            if sys_metrics:
                print(f"    CPU: {sys_metrics['cpu_percent']:.0f}% util, "
                      f"{sys_metrics['memory_used_gb']:.1f}/{sys_metrics['memory_total_gb']:.1f} GB RAM")

    if metrics:
        metrics.inference_end = time.time()
        metrics.pairs_inferred = len(pair_results)

    print(f"  Inference complete: {len(pair_results)} pairs")
    return pair_results


class VP9EncoderPool:
    """Parallel VP9 encoder pool."""

    def __init__(
        self,
        frames_dir: Path,
        chunks_dir: Path,
        frame_rate: float,
        num_workers: int = 4,
        frames_per_chunk: int = 32,
        metrics: PerformanceMetrics | None = None,
    ):
        self.frames_dir = frames_dir
        self.chunks_dir = chunks_dir
        self.frame_rate = frame_rate
        self.num_workers = num_workers
        self.frames_per_chunk = frames_per_chunk
        self.metrics = metrics

    def encode_chunk(
        self,
        chunk_frames: list[Path],
        chunk_output: Path,
    ) -> Path:
        """Encode a single chunk with optimized VP9 settings."""
        # Create FFmpeg file list
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            for frame_file in chunk_frames:
                f.write(f"file '{frame_file.absolute()}'\n")
                f.write(f"duration {1.0 / self.frame_rate}\n")
            filelist_path = f.name

        try:
            # Optimized VP9 encoding
            subprocess.run(
                [
                    "ffmpeg",
                    "-f", "concat",
                    "-safe", "0",
                    "-i", filelist_path,
                    "-c:v", "libvpx-vp9",
                    "-crf", "30",
                    "-b:v", "0",
                    # Speed optimizations (2-3x faster)
                    "-cpu-used", "2",           # Good speed/quality balance
                    "-threads", "2",            # 2 threads per worker
                    "-row-mt", "1",             # Row-based multithreading
                    "-tile-columns", "1",       # 2 tile columns
                    "-frame-parallel", "1",     # Frame parallelization
                    "-auto-alt-ref", "1",       # Better compression
                    "-lag-in-frames", "25",     # Look-ahead
                    "-y",
                    str(chunk_output),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            return chunk_output
        finally:
            Path(filelist_path).unlink(missing_ok=True)

    def encode_all_chunks(
        self,
        frame_files: list[Path],
        modulo_levels: list[int] = [16, 4, 1],
    ) -> list[Tuple[int, Path]]:
        """Encode all chunks in parallel across modulo levels."""
        chunk_paths = []
        encoding_tasks = []

        # Prepare all encoding tasks
        for modulo in modulo_levels:
            modulo_dir = self.chunks_dir / f"modulo_{modulo}"
            modulo_dir.mkdir(exist_ok=True, parents=True)

            # Select frames at this modulo
            modulo_frames = [f for i, f in enumerate(frame_files) if i % modulo == 0]

            if not modulo_frames:
                continue

            # Split into chunks
            num_chunks = (len(modulo_frames) + self.frames_per_chunk - 1) // self.frames_per_chunk

            for chunk_idx in range(num_chunks):
                start_idx = chunk_idx * self.frames_per_chunk
                end_idx = min(start_idx + self.frames_per_chunk, len(modulo_frames))
                chunk_frames = modulo_frames[start_idx:end_idx]

                # Get start frame index for filename
                start_frame_index = frame_files.index(chunk_frames[0])
                chunk_output = modulo_dir / f"chunk_{start_frame_index:010d}.webm"

                encoding_tasks.append((modulo, chunk_frames, chunk_output))

        # Execute encoding in parallel
        print(f"  Encoding {len(encoding_tasks)} chunks with {self.num_workers} workers...")

        if self.metrics:
            self.metrics.encoding_start = time.time()

        with ThreadPoolExecutor(max_workers=self.num_workers) as executor:
            futures = {
                executor.submit(self.encode_chunk, frames, output): (modulo, output)
                for modulo, frames, output in encoding_tasks
            }

            completed = 0
            for future in as_completed(futures):
                modulo, chunk_output = futures[future]
                try:
                    chunk_output = future.result()
                    chunk_paths.append((modulo, chunk_output))
                    completed += 1

                    if completed % 10 == 0 or completed == len(encoding_tasks):
                        print(f"    Progress: {completed}/{len(encoding_tasks)} chunks")
                except Exception as e:
                    print(f"    Failed chunk {chunk_output}: {e}")

        if self.metrics:
            self.metrics.encoding_end = time.time()
            self.metrics.chunks_encoded = len(chunk_paths)

        return chunk_paths


def crop_and_infer_caption_frame_extents_sequential(
    video_key: str,
    tenant_id: str,
    video_id: str,
    crop_region: CropRegion,
    frame_rate: float = 10.0,
    encoder_workers: int = 4,
    max_frames: int = 5000,
) -> CropInferResult:
    """
    Sequential implementation of crop_and_infer_caption_frame_extents.

    This version processes frames sequentially:
    1. GPU-accelerated frame extraction and cropping (NVDEC + CUDA filters) - completes first
    2. Batch inference on saved frames - runs after extraction
    3. Parallel VP9 encoding (multiple CPU workers)
    4. Wasabi uploads

    Args:
        video_key: Wasabi S3 key for video file
        tenant_id: Tenant UUID for path scoping
        video_id: Video UUID
        crop_region: Normalized crop region (0.0 to 1.0)
        frame_rate: Frames per second to extract (default: 10.0)
        encoder_workers: Number of parallel VP9 encoding workers (default: 4)

    Returns:
        CropInferResult with version, frame count, inference stats, and S3 paths
    """
    job_start = time.time()

    print(f"\n{'=' * 80}")
    print(f"Starting Sequential Crop and Infer Job")
    print(f"{'=' * 80}")
    print(f"Video: {video_key}")
    print(f"Tenant: {tenant_id}")
    print(f"Video ID: {video_id}")
    print(f"Crop Region: L={crop_region.crop_left}, T={crop_region.crop_top}, "
          f"R={crop_region.crop_right}, B={crop_region.crop_bottom}")
    print(f"Frame Rate: {frame_rate} Hz")
    print(f"Encoder Workers: {encoder_workers}")
    print(f"{'=' * 80}\n")

    # Initialize Wasabi client
    wasabi = WasabiClient()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)

        # Step 1: Download video from Wasabi
        print("[1/7] Downloading video from Wasabi...")
        download_start = time.time()
        video_path = tmp_path / "video.mp4"
        wasabi.download_file(video_key, video_path)
        print(f"  Downloaded in {time.time() - download_start:.2f}s\n")

        # Step 2: Get video dimensions and FPS
        print("[2/7] Probing video properties...")
        probe = ffmpeg.probe(str(video_path))
        video_stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
        frame_width = int(video_stream["width"])
        frame_height = int(video_stream["height"])

        # Parse FPS from r_frame_rate (e.g., "25/1" -> 25.0)
        fps_str = video_stream.get("r_frame_rate", "25/1")
        fps_parts = fps_str.split("/")
        native_fps = float(fps_parts[0]) / float(fps_parts[1])

        print(f"  Video dimensions: {frame_width}x{frame_height}")
        print(f"  Native FPS: {native_fps}\n")

        # Step 3: Determine version number
        print("[3/7] Determining version number...")
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
                    prefix_str = prefix["Prefix"]
                    version_str = prefix_str.rstrip("/").split("_v")[-1]
                    if version_str.isdigit():
                        existing_versions.append(int(version_str))

            version = max(existing_versions, default=0) + 1
        except Exception as e:
            print(f"  Warning: Could not check existing versions: {e}")
            version = 1

        print(f"  Version: {version}\n")

        # Step 4: Download and decompress layout.db.gz for OCR visualization
        print("[4/7] Downloading layout.db.gz...")
        layout_db_gz_path = tmp_path / "layout.db.gz"
        layout_db_path = tmp_path / "layout.db"
        layout_storage_key = f"{tenant_id}/client/videos/{video_id}/layout.db.gz"
        wasabi.download_file(layout_storage_key, layout_db_gz_path)

        # Decompress the layout.db.gz file
        import gzip
        import shutil
        with gzip.open(layout_db_gz_path, 'rb') as f_in:
            with open(layout_db_path, 'wb') as f_out:
                shutil.copyfileobj(f_in, f_out)
        print(f"  Downloaded and decompressed\n")

        # Step 5: Initialize components
        print("[5/7] Starting sequential processing...")
        pipeline_start = time.time()

        # Initialize performance metrics
        metrics = PerformanceMetrics()

        frames_dir = tmp_path / "frames"
        frames_dir.mkdir(exist_ok=True)

        chunks_dir = tmp_path / "chunks"
        chunks_dir.mkdir(exist_ok=True)

        # Initialize frame extractor
        frame_extractor = FrameExtractor(
            video_path=video_path,
            crop_region=crop_region,
            frame_width=frame_width,
            frame_height=frame_height,
            native_fps=native_fps,
            target_fps=frame_rate,  # This is the target FPS passed to function (e.g., 10.0)
            save_to_disk=True,  # Save for VP9 encoding
            frames_dir=frames_dir,
        )

        # Load inference model
        model_version = "mrn0fkfd_a4b1a61c"
        checkpoint_path = Path("/root/boundary-models/checkpoints/mrn0fkfd_a4b1a61c.pt")

        predictor = BatchCaptionFrameExtentsPredictor(
            checkpoint_path=checkpoint_path,
            layout_db_path=layout_db_path,
            device="cuda" if torch.cuda.is_available() else "cpu",
        )

        # Step 5a: Extract all frames first
        print("  [5a/7] Extracting frames...")
        frame_count = extract_all_frames(frame_extractor, metrics)

        # Step 5b: Run inference on saved frames
        print("  [5b/7] Running inference...")
        pair_results = run_inference_sequential(
            frames_dir=frames_dir,
            predictor=predictor,
            batch_size=32,
            metrics=metrics,
        )

        pipeline_duration = time.time() - pipeline_start
        print(f"  Sequential processing complete: {frame_count} frames, {len(pair_results)} pairs in {pipeline_duration:.2f}s\n")

        # Step 6: Encode VP9 chunks in parallel
        print("[6/7] Encoding VP9 chunks...")
        encode_start = time.time()

        frame_files = sorted(frames_dir.glob("frame_*.jpg"))

        encoder_pool = VP9EncoderPool(
            frames_dir=frames_dir,
            chunks_dir=chunks_dir,
            frame_rate=frame_rate,
            num_workers=encoder_workers,
            metrics=metrics,
        )

        chunk_paths = encoder_pool.encode_all_chunks(frame_files)

        print(f"  Encoded {len(chunk_paths)} chunks in {time.time() - encode_start:.2f}s\n")

        # Step 7: Create DB and upload to Wasabi
        print("[7/7] Creating database and uploading to Wasabi...")
        upload_start = time.time()

        # Compute label counts
        label_counts = Counter()
        for result in pair_results:
            label_counts[result.forward_predicted_label] += 1
        label_counts_dict = dict(label_counts)

        # Create caption frame extents database
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

        # Upload WebM chunks
        for modulo, chunk_path in chunk_paths:
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

        # Print performance metrics
        metrics.report()

        # Build output paths
        cropped_frames_prefix = f"{tenant_id}/client/videos/{video_id}/cropped_frames_v{version}/"

        # Compute final metrics
        total_duration = time.time() - job_start

        print(f"{'=' * 80}")
        print(f"Sequential Job Complete")
        print(f"{'=' * 80}")
        print(f"Version: {version}")
        print(f"Frames: {frame_count}")
        print(f"Chunks: {len(chunk_paths)}")
        print(f"Inference pairs: {len(pair_results)}")
        print(f"Label counts: {label_counts_dict}")
        print(f"Processing duration: {pipeline_duration:.2f}s")
        print(f"Encoding duration: {time.time() - encode_start:.2f}s")
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
