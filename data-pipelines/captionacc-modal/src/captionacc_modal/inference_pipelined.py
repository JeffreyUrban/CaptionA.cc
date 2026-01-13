"""
Pipelined implementation of crop_and_infer_caption_frame_extents.

This module implements a high-performance pipeline that maximizes A10G GPU utilization by:
1. GPU-accelerated frame extraction and cropping (NVDEC + CUDA filters)
2. Streaming frames directly to inference (no disk I/O between stages)
3. Parallel VP9 encoding on CPU (multiple workers)

Architecture:
    GPU Extractor → Frame Queue → GPU Inference → Results + Frame Buffer
                                                             ↓
                                                      Encoder Pool → Wasabi Upload

IMPORTANT: This includes performance instrumentation to measure bottlenecks.
Run first to determine if GPU pipeline or CPU encoding is the limiting factor.
"""

import subprocess
import tempfile
import time
import queue
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Iterator, Tuple

import ffmpeg
import numpy as np
import torch
from PIL import Image as PILImage

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
    """GPU-accelerated frame extractor using FFmpeg with NVDEC and CUDA filters."""

    def __init__(
        self,
        video_path: Path,
        crop_region: CropRegion,
        frame_width: int,
        frame_height: int,
        frame_rate: float,
        save_to_disk: bool = True,
        frames_dir: Path | None = None,
    ):
        self.video_path = video_path
        self.crop_region = crop_region
        self.frame_width = frame_width
        self.frame_height = frame_height
        self.frame_rate = frame_rate
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
        Stream frames using GPU-accelerated extraction.

        Yields:
            Tuple of (frame_index, frame_array)
            - frame_index: Sequential frame number (0, 1, 2, ...)
            - frame_array: RGB numpy array (H, W, 3) uint8
        """
        # Build FFmpeg command with GPU acceleration
        cmd = [
            "ffmpeg",
            "-hwaccel", "cuda",                    # Use NVDEC for decoding
            "-hwaccel_output_format", "cuda",      # Keep frames in GPU memory
            "-threads", "4",                        # Multi-threaded decoding
            "-i", str(self.video_path),
            # GPU crop and fps decimation, then download only needed frames
            "-vf", f"fps={self.frame_rate},"       # Decimate on GPU BEFORE crop/download
                   f"crop={self.crop_width}:{self.crop_height}:{self.crop_left_px}:{self.crop_top_px},"
                   f"hwdownload,"
                   f"format=nv12",                 # Convert to NV12 after download
            # Output to stdout as raw RGB frames
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "-",
        ]

        # Start FFmpeg process
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=10**8,  # 100MB buffer for high throughput
        )

        frame_idx = 0
        bytes_per_frame = self.crop_height * self.crop_width * 3

        try:
            if process.stdout is None:
                raise RuntimeError("FFmpeg stdout is None")

            while True:
                # Read one frame
                raw_frame = process.stdout.read(bytes_per_frame)

                if len(raw_frame) != bytes_per_frame:
                    break  # End of video or error

                # Convert bytes to numpy array
                frame = np.frombuffer(raw_frame, dtype=np.uint8)
                frame = frame.reshape((self.crop_height, self.crop_width, 3))

                # Optionally save to disk for VP9 encoding
                if self.save_to_disk and self.frames_dir:
                    frame_path = self.frames_dir / f"frame_{frame_idx:010d}.jpg"
                    PILImage.fromarray(frame).save(frame_path, quality=95)

                yield frame_idx, frame
                frame_idx += 1

        finally:
            if process.stdout:
                process.stdout.close()
            process.wait()

            # Check for errors
            if process.returncode != 0:
                stderr_output = ""
                if process.stderr:
                    stderr_output = process.stderr.read().decode()
                raise RuntimeError(f"FFmpeg extraction failed: {stderr_output}")


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


class InferencePipeline:
    """Manages the pipelined inference process."""

    def __init__(
        self,
        predictor: BatchCaptionFrameExtentsPredictor,
        batch_size: int = 32,
        frame_queue_size: int = 128,
        metrics: PerformanceMetrics | None = None,
    ):
        self.predictor = predictor
        self.batch_size = batch_size
        self.metrics = metrics

        # Queues for inter-stage communication
        self.frame_queue = queue.Queue(maxsize=frame_queue_size)
        self.results_queue = queue.Queue()

        # Tracking
        self.extraction_complete = threading.Event()
        self.inference_complete = threading.Event()
        self.frame_count = 0

    def extraction_worker(self, frame_extractor: FrameExtractor):
        """Thread 1: Extract frames and push to queue."""
        try:
            if self.metrics:
                self.metrics.extraction_start = time.time()

            for frame_idx, frame in frame_extractor.extract_frames_stream():
                # Convert to PIL Image for inference
                pil_frame = PILImage.fromarray(frame)
                self.frame_queue.put((frame_idx, pil_frame))
                self.frame_count = frame_idx + 1

                if frame_idx % 100 == 0:
                    print(f"  Extracted {frame_idx} frames")

            if self.metrics:
                self.metrics.extraction_end = time.time()
                self.metrics.frames_extracted = self.frame_count

            print(f"  Extraction complete: {self.frame_count} frames")
        except Exception as e:
            print(f"  Extraction error: {e}")
            raise
        finally:
            self.extraction_complete.set()

    def inference_worker(self) -> list[PairResult]:
        """Thread 2: Consume frame pairs and run inference."""
        pair_results = []
        frame_buffer = {}  # frame_idx -> PIL Image
        last_processed_idx = -1
        min_buffer_size = self.batch_size + 1  # Need batch_size/2 pairs + 1 extra frame

        try:
            if self.metrics:
                self.metrics.inference_start = time.time()
            while True:
                # Check if we're done
                if self.extraction_complete.is_set() and self.frame_queue.empty():
                    break

                # Get frame from queue (with timeout)
                try:
                    frame_idx, pil_frame = self.frame_queue.get(timeout=1.0)
                    frame_buffer[frame_idx] = pil_frame
                except queue.Empty:
                    # If extraction is done and we have frames, process them even if not full batch
                    if self.extraction_complete.is_set() and len(frame_buffer) >= 2:
                        pass  # Continue to processing
                    else:
                        continue

                # Count consecutive frames available from last_processed_idx
                consecutive_frames = 0
                check_idx = last_processed_idx + 1
                while check_idx in frame_buffer:
                    consecutive_frames += 1
                    check_idx += 1

                # Wait for more frames unless extraction is done or we have enough for a batch
                if consecutive_frames < min_buffer_size and not self.extraction_complete.is_set():
                    continue

                # Accumulate frame pairs for batched inference
                pairs_to_process = []
                max_pairs = self.batch_size // 2  # Each pair needs 2 inferences (forward + backward)

                # Collect consecutive frame pairs up to max_pairs
                temp_idx = last_processed_idx
                while len(pairs_to_process) < max_pairs:
                    idx1 = temp_idx + 1
                    idx2 = temp_idx + 2

                    if idx1 not in frame_buffer or idx2 not in frame_buffer:
                        break

                    f1 = frame_buffer[idx1]
                    f2 = frame_buffer[idx2]
                    pairs_to_process.append((idx1, idx2, f1, f2))
                    temp_idx = idx1

                # Process batch if we have pairs
                if pairs_to_process:
                    # Clean up processed frames from buffer
                    for idx1, _, _, _ in pairs_to_process:
                        if idx1 in frame_buffer:
                            del frame_buffer[idx1]
                    last_processed_idx = pairs_to_process[-1][0]
                    # Build bidirectional batch: [(f1, f2), (f2, f1), ...] for all pairs
                    batch_inputs = []
                    for _, _, f1, f2 in pairs_to_process:
                        batch_inputs.append((f1, f2))  # Forward
                        batch_inputs.append((f2, f1))  # Backward

                    # Run batched inference with timing
                    batch_start = time.time()

                    predictions = self.predictor.predict_batch(
                        batch_inputs,
                        batch_size=len(batch_inputs),
                    )

                    batch_duration = time.time() - batch_start

                    # Process results for each pair
                    for i, (idx1, idx2, _, _) in enumerate(pairs_to_process):
                        forward_pred = predictions[i * 2]
                        backward_pred = predictions[i * 2 + 1]

                        pair_result = PairResult(
                            frame1_index=idx1,
                            frame2_index=idx2,
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

                        if len(pair_results) % 500 == 0:
                            gpu_metrics = get_gpu_metrics()
                            sys_metrics = get_system_metrics()
                            print(f"  Inference progress: {len(pair_results)} pairs")
                            if gpu_metrics:
                                print(f"    GPU: {gpu_metrics['gpu_util_percent']}% util, "
                                      f"{gpu_metrics['gpu_memory_used_gb']:.1f}/{gpu_metrics['gpu_memory_total_gb']:.1f} GB")
                            if sys_metrics:
                                print(f"    CPU: {sys_metrics['cpu_percent']:.0f}% util, "
                                      f"{sys_metrics['memory_used_gb']:.1f}/{sys_metrics['memory_total_gb']:.1f} GB RAM")

            if self.metrics:
                self.metrics.inference_end = time.time()
                self.metrics.pairs_inferred = len(pair_results)

            print(f"  Inference complete: {len(pair_results)} pairs")
            return pair_results

        except Exception as e:
            print(f"  Inference error: {e}")
            raise
        finally:
            self.inference_complete.set()


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


def crop_and_infer_caption_frame_extents_pipelined(
    video_key: str,
    tenant_id: str,
    video_id: str,
    crop_region: CropRegion,
    frame_rate: float = 10.0,
    encoder_workers: int = 4,
) -> CropInferResult:
    """
    Pipelined implementation of crop_and_infer_caption_frame_extents.

    This version uses a parallel pipeline architecture to maximize A10G GPU utilization:
    1. GPU-accelerated frame extraction and cropping (NVDEC + CUDA filters)
    2. Streaming inference (frames go directly from extraction to inference)
    3. Parallel VP9 encoding (multiple CPU workers)
    4. Background Wasabi uploads

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
    print(f"Starting Pipelined Crop and Infer Job")
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

        # Step 2: Get video dimensions
        print("[2/7] Probing video dimensions...")
        probe = ffmpeg.probe(str(video_path))
        video_stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
        frame_width = int(video_stream["width"])
        frame_height = int(video_stream["height"])
        print(f"  Video dimensions: {frame_width}x{frame_height}\n")

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
        print("[5/7] Starting parallel pipeline...")
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
            frame_rate=frame_rate,
            save_to_disk=True,  # Save for VP9 encoding
            frames_dir=frames_dir,
        )

        # Load inference model
        model_version = "mrn0fkfd_a4b1a61c"
        checkpoint_path = Path("/root/boundary-models/checkpoints/mrn0fkfd_a4b1a61c.pt")

        # Real pipelined inference
        predictor = BatchCaptionFrameExtentsPredictor(
            checkpoint_path=checkpoint_path,
            layout_db_path=layout_db_path,
            device="cuda" if torch.cuda.is_available() else "cpu",
        )

        pipeline = InferencePipeline(predictor=predictor, batch_size=32, metrics=metrics)

        # Start extraction thread
        extraction_thread = threading.Thread(
            target=pipeline.extraction_worker,
            args=(frame_extractor,),
        )
        extraction_thread.start()

        # Run inference in main thread (needs to be on main thread for CUDA)
        pair_results = pipeline.inference_worker()

        # Wait for extraction to complete
        extraction_thread.join()

        frame_count = pipeline.frame_count

        pipeline_duration = time.time() - pipeline_start
        print(f"  Pipeline complete: {frame_count} frames, {len(pair_results)} pairs in {pipeline_duration:.2f}s\n")

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
        print(f"Pipelined Job Complete")
        print(f"{'=' * 80}")
        print(f"Version: {version}")
        print(f"Frames: {frame_count}")
        print(f"Chunks: {len(chunk_paths)}")
        print(f"Inference pairs: {len(pair_results)}")
        print(f"Label counts: {label_counts_dict}")
        print(f"Pipeline duration: {pipeline_duration:.2f}s")
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
