#!/usr/bin/env python3
"""
OCR Batch Processing Service

Independent microservice for batch OCR processing using vertical montage stacking.
Handles any set of identically-dimensioned images and returns structured results.

Features:
- Async job processing (non-blocking)
- Rate limiting and daily limits
- Circuit breaker for GCP failures
- Job deduplication and caching
"""

import asyncio
import base64
import json
import os
import sqlite3
import tempfile
import time
from io import BytesIO
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from circuit_breaker import CircuitBreakerOpen, circuit_breaker

# Import protection modules
from config import config
from fastapi import FastAPI, HTTPException
from job_store import JobStatus, job_store
from PIL import Image
from pydantic import BaseModel, Field
from rate_limiter import usage_tracker
from wasabi_client import get_wasabi_client

try:
    from google.cloud import vision  # type: ignore

    # Handle Fly.io secrets (JSON stored as environment variable)
    creds_json = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    if creds_json:
        # Write to temp file for google-cloud-vision
        with open("/tmp/gcp-credentials.json", "w") as f:
            f.write(creds_json)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "/tmp/gcp-credentials.json"

    GOOGLE_CLOUD_AVAILABLE = True
except ImportError:
    GOOGLE_CLOUD_AVAILABLE = False
    vision = None  # type: ignore


app = FastAPI(
    title="OCR Batch Processing Service", description="Async batch OCR processing with cost protection", version="2.0.0"
)


# Configuration constants from config
SEPARATOR_PX = 2  # Separator between stacked images

# Concurrency control - limit concurrent job processing to prevent memory exhaustion
# With 512MB RAM and ~230MB peak per job, we use MAX_CONCURRENT_JOBS=1 for safety
job_semaphore = asyncio.Semaphore(config.MAX_CONCURRENT_JOBS)
active_jobs_count = 0  # Track currently processing jobs
queued_jobs_count = 0  # Track jobs waiting for semaphore
concurrency_lock = asyncio.Lock()  # Protect the counters

# Job data storage directory (temporary files for downloaded video.db)
JOB_DATA_DIR = Path(tempfile.gettempdir()) / "ocr_job_data"
JOB_DATA_DIR.mkdir(exist_ok=True)

# Track download tasks for pre-fetching
download_tasks: Dict[str, asyncio.Task] = {}  # job_id -> download task
download_lock = asyncio.Lock()  # Protect download_tasks dict

# Initialize Wasabi client
try:
    wasabi_client = get_wasabi_client()
    WASABI_AVAILABLE = True
except Exception as e:
    print(f"Warning: Wasabi client not available: {e}")
    wasabi_client = None
    WASABI_AVAILABLE = False


async def download_and_extract_frames(
    job_id: str, tenant_id: str, video_id: str, frame_indices: List[int]
) -> str:
    """
    Download video.db from Wasabi and extract requested frames.

    This function downloads the video.db file and extracts the specified frames,
    saving them to a temporary file for processing.

    Args:
        job_id: Job identifier
        tenant_id: Tenant UUID
        video_id: Video UUID
        frame_indices: List of frame indices to extract

    Returns:
        Path to temporary file containing extracted frame data (JSON)

    Raises:
        Exception: If download or extraction fails
    """
    # Download video.db from Wasabi
    storage_key = f"{tenant_id}/{video_id}/video.db"
    video_db_path = JOB_DATA_DIR / f"{job_id}_video.db"

    # Run download in executor to avoid blocking
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: wasabi_client.download_file(storage_key, video_db_path))

    try:
        # Extract frames from video.db
        conn = sqlite3.connect(str(video_db_path))
        cursor = conn.cursor()

        # Build query for specific frame indices
        placeholders = ",".join("?" * len(frame_indices))
        cursor.execute(
            f"""
            SELECT frame_index, image_data
            FROM full_frames
            WHERE frame_index IN ({placeholders})
            ORDER BY frame_index
        """,
            frame_indices,
        )

        # Collect frames as list of dicts
        frames = []
        for row in cursor:
            frame_index, image_data = row
            frames.append({"id": f"frame_{frame_index}", "data": base64.b64encode(image_data).decode("utf-8")})

        conn.close()

        # Write frames to JSON file
        frames_file = JOB_DATA_DIR / f"{job_id}_frames.json"
        with open(frames_file, "w") as f:
            json.dump(frames, f)

        return str(frames_file)

    finally:
        # Clean up video.db (we've extracted what we need)
        video_db_path.unlink(missing_ok=True)


def read_frames_from_disk(frames_file_path: str) -> List[Dict]:
    """
    Read frames data from disk.

    Args:
        frames_file_path: Path to the temporary frames JSON file

    Returns:
        List of frame dicts with 'id' and 'data' (base64) keys
    """
    with open(frames_file_path, "r") as f:
        return json.load(f)


def cleanup_job_data_file(frames_file_path: str):
    """
    Delete temporary frames file.

    Args:
        frames_file_path: Path to the temporary frames JSON file
    """
    try:
        Path(frames_file_path).unlink(missing_ok=True)
    except Exception:
        pass  # Best effort cleanup


class ImageDimensions(BaseModel):
    """Image dimensions for capacity calculation."""

    width: int = Field(..., gt=0, description="Image width in pixels")
    height: int = Field(..., gt=0, description="Image height in pixels")


class CapacityResponse(BaseModel):
    """Response for capacity calculation."""

    max_images: int
    limits: Dict[str, int]
    limiting_factor: str
    estimated_file_size_mb: float


class JobSubmitRequest(BaseModel):
    """Request to submit OCR job using Wasabi storage references."""

    tenant_id: str = Field(..., description="Tenant UUID")
    video_id: str = Field(..., description="Video UUID")
    frame_indices: List[int] = Field(..., min_length=1, description="List of frame indices to process")


class JobSubmitResponse(BaseModel):
    """Response for job submission."""

    job_id: str
    status: str
    message: str


class BoundingBox(BaseModel):
    """Character bounding box."""

    x: int
    y: int
    width: int
    height: int


class CharacterResult(BaseModel):
    """OCR result for a single character."""

    text: str
    bbox: BoundingBox


class ImageOCRResult(BaseModel):
    """OCR results for a single image."""

    id: str
    characters: List[CharacterResult]
    text: str
    char_count: int


class JobResultResponse(BaseModel):
    """Response for completed job."""

    results: List[ImageOCRResult]
    processing_time_ms: float
    total_characters: int
    images_processed: int


class JobStatusResponse(BaseModel):
    """Response for job status check."""

    job_id: str
    status: str
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    processing_time_ms: Optional[float] = None
    images_count: int
    result: Optional[JobResultResponse] = None
    error: Optional[str] = None


def calculate_capacity(width: int, height: int) -> Tuple[int, Dict[str, int], str, float]:
    """
    Calculate maximum number of images that can be safely processed.

    Returns:
        (max_images, limits_dict, limiting_factor, estimated_file_size_mb)
    """
    # Calculate max by height
    max_by_height = (config.HEIGHT_LIMIT_PX + SEPARATOR_PX) // (height + SEPARATOR_PX)

    # Calculate max by total pixels
    max_by_pixels = config.PIXEL_LIMIT // (width * height)

    # Estimate max by file size (rough estimate based on observed compression)
    # Based on test: 950 frames @ 666×64 = 15.41 MB
    reference_bytes_per_frame = (15.41 * 1024 * 1024) / 950
    reference_pixels_per_frame = 666 * 64
    estimated_bytes_per_frame = reference_bytes_per_frame * (width * height) / reference_pixels_per_frame
    max_by_size = int((config.FILE_SIZE_LIMIT_MB * 1024 * 1024) / estimated_bytes_per_frame)

    # Apply configured max frames limit
    max_by_config = config.MAX_FRAMES_PER_JOB

    limits = {
        "by_height": max_by_height,
        "by_pixels": max_by_pixels,
        "by_file_size": max_by_size,
        "by_config": max_by_config,
    }

    # Find minimum (most restrictive)
    max_images = min(max_by_height, max_by_pixels, max_by_size, max_by_config)

    if max_images == max_by_config:
        limiting_factor = "config_limit"
    elif max_images == max_by_height:
        limiting_factor = "height"
    elif max_images == max_by_pixels:
        limiting_factor = "total_pixels"
    else:
        limiting_factor = "file_size"

    # Estimate final file size
    estimated_file_size_mb = (estimated_bytes_per_frame * max_images) / (1024 * 1024)

    return max_images, limits, limiting_factor, estimated_file_size_mb


def create_vertical_montage(
    images: List[Tuple[str, bytes]], separator_px: int = SEPARATOR_PX
) -> Tuple[bytes, List[Dict]]:
    """
    Create vertical montage from list of images.

    Args:
        images: List of (id, image_data) tuples
        separator_px: Pixels between images

    Returns:
        (montage_bytes, metadata_list)
        metadata_list contains position info for each image
    """
    if not images:
        raise ValueError("No images provided")

    # Load first image to get dimensions
    first_img = Image.open(BytesIO(images[0][1]))
    width = first_img.width
    height = first_img.height

    # Calculate total height
    total_height = sum(height for _ in images) + (len(images) - 1) * separator_px

    # Check height limit
    if total_height > config.HEIGHT_LIMIT_PX:
        raise ValueError(f"Total height {total_height}px exceeds limit {config.HEIGHT_LIMIT_PX}px")

    # Create montage
    montage = Image.new("RGB", (width, total_height), (220, 220, 220))

    metadata = []
    y_offset = 0

    for img_id, img_data in images:
        img = Image.open(BytesIO(img_data))

        # Verify dimensions match
        if img.width != width or img.height != height:
            raise ValueError(
                f"Image {img_id} dimensions {img.width}×{img.height} don't match expected {width}×{height}"
            )

        # Paste image
        montage.paste(img, (0, y_offset))

        # Store metadata
        metadata.append({"id": img_id, "x": 0, "y": y_offset, "width": width, "height": height})

        y_offset += height + separator_px

    # Save to bytes
    buffer = BytesIO()
    montage.save(buffer, format="JPEG", quality=95)

    return buffer.getvalue(), metadata


def call_gcp_vision_api_sync(image_bytes: bytes) -> Dict:
    """
    Call Google Cloud Vision API for document text detection (synchronous).

    Returns structured results with character-level bounding boxes.
    """
    if not GOOGLE_CLOUD_AVAILABLE or vision is None:
        raise RuntimeError("google-cloud-vision not available")

    client = vision.ImageAnnotatorClient()
    image = vision.Image(content=image_bytes)

    start = time.time()

    # Call API (wrapped in circuit breaker by caller)
    response = client.document_text_detection(image=image, image_context={"language_hints": ["zh"]})  # type: ignore

    elapsed_ms = (time.time() - start) * 1000

    # Parse symbols (characters)
    symbols = []
    if response.full_text_annotation:
        for page in response.full_text_annotation.pages:
            for block in page.blocks:
                for paragraph in block.paragraphs:
                    for word in paragraph.words:
                        for symbol in word.symbols:
                            vertices = symbol.bounding_box.vertices
                            x = min(v.x for v in vertices)
                            y = min(v.y for v in vertices)
                            w = max(v.x for v in vertices) - x
                            h = max(v.y for v in vertices) - y

                            symbols.append({"text": symbol.text, "bbox": {"x": x, "y": y, "width": w, "height": h}})

    return {"processing_time_ms": elapsed_ms, "symbols": symbols, "total_characters": len(symbols)}


def distribute_characters_to_images(symbols: List[Dict], image_metadata: List[Dict]) -> List[ImageOCRResult]:
    """
    Distribute detected characters back to their original images based on position.

    Args:
        symbols: List of characters with bounding boxes in montage coordinates
        image_metadata: List of image positions in montage

    Returns:
        List of ImageOCRResult, one per image
    """
    results = []

    for img_meta in image_metadata:
        img_id = img_meta["id"]
        img_x = img_meta["x"]
        img_y = img_meta["y"]
        img_h = img_meta["height"]

        # Find characters that fall within this image's bounds
        img_chars = []

        for symbol in symbols:
            bbox = symbol["bbox"]
            char_x = bbox["x"]
            char_y = bbox["y"]

            # Check if character center is within image bounds
            char_center_y = char_y + bbox["height"] / 2

            if char_center_y >= img_y and char_center_y < img_y + img_h:
                # Transform coordinates to image-relative
                relative_bbox = BoundingBox(
                    x=char_x - img_x, y=char_y - img_y, width=bbox["width"], height=bbox["height"]
                )

                img_chars.append(CharacterResult(text=symbol["text"], bbox=relative_bbox))

        # Create result
        text = "".join(c.text for c in img_chars)
        results.append(ImageOCRResult(id=img_id, characters=img_chars, text=text, char_count=len(img_chars)))

    return results


async def process_job_background_with_download(job_id: str, download_task: asyncio.Task, num_images: int):
    """
    Background task to process OCR job with concurrency control and pre-fetching.

    This function waits for the download task to complete (which may be running
    in parallel while another job is processing), then processes the OCR.

    Args:
        job_id: Job identifier
        download_task: Async task downloading and extracting frames
        num_images: Number of images in the job

    Note: queued_jobs_count is already incremented in submit_job() to reserve the slot.
    The frames file will be deleted after processing (success or failure).
    """
    global active_jobs_count, queued_jobs_count

    try:
        # Acquire semaphore - will block if at max concurrency
        # While waiting, the download task continues in parallel (pre-fetch)
        async with job_semaphore:
            # Update counters when starting processing
            async with concurrency_lock:
                queued_jobs_count -= 1
                active_jobs_count += 1

            frames_file_path = None
            try:
                # Update status to processing
                job_store.update_status(job_id, JobStatus.PROCESSING, started_at=time.time())

                # Wait for download to complete (may already be done thanks to pre-fetch)
                frames_file_path = await download_task

                # Clean up download task tracking
                async with download_lock:
                    download_tasks.pop(job_id, None)

                # Read frames data from disk
                images_data = read_frames_from_disk(frames_file_path)

                # Decode base64 and convert to format for montage creation
                image_list = [(img["id"], base64.b64decode(img["data"])) for img in images_data]

                # Create montage
                montage_bytes, metadata = create_vertical_montage(image_list)

                # Call OCR API with circuit breaker protection
                loop = asyncio.get_event_loop()
                ocr_result = await loop.run_in_executor(
                    None, lambda: circuit_breaker.call(call_gcp_vision_api_sync, montage_bytes)
                )

                # Distribute characters back to images
                results = distribute_characters_to_images(ocr_result["symbols"], metadata)

                # Build result
                result = {
                    "results": [r.model_dump() for r in results],
                    "processing_time_ms": ocr_result["processing_time_ms"],
                    "total_characters": ocr_result["total_characters"],
                    "images_processed": num_images,
                }

                # Update job as completed
                job_store.update_status(
                    job_id,
                    JobStatus.COMPLETED,
                    completed_at=time.time(),
                    processing_time_ms=ocr_result["processing_time_ms"],
                    result=result,
                )

            except CircuitBreakerOpen as e:
                # Circuit breaker is open
                job_store.update_status(
                    job_id, JobStatus.FAILED, completed_at=time.time(), error=f"Circuit breaker open: {str(e)}"
                )

            except Exception as e:
                # Job failed (includes download failures)
                job_store.update_status(job_id, JobStatus.FAILED, completed_at=time.time(), error=str(e))

            finally:
                # Clean up frames file if it was created
                if frames_file_path:
                    cleanup_job_data_file(frames_file_path)

                # Clean up download task tracking if still present
                async with download_lock:
                    download_tasks.pop(job_id, None)

                # Decrement active count when done
                async with concurrency_lock:
                    active_jobs_count -= 1

    except Exception as e:
        # Handle semaphore acquisition errors or unexpected failures
        # Clean up download task tracking
        async with download_lock:
            download_tasks.pop(job_id, None)
        async with concurrency_lock:
            queued_jobs_count -= 1
        job_store.update_status(
            job_id, JobStatus.FAILED, completed_at=time.time(), error=f"Failed to acquire processing slot: {str(e)}"
        )


# Background cleanup task
async def cleanup_task():
    """Periodically cleanup old jobs."""
    while True:
        await asyncio.sleep(300)  # Every 5 minutes
        job_store.cleanup_old_jobs()


@app.on_event("startup")
async def startup_event():
    """Start background tasks."""
    asyncio.create_task(cleanup_task())


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "service": "OCR Batch Processing Service",
        "version": "2.0.0",
        "status": "healthy",
        "google_cloud_available": GOOGLE_CLOUD_AVAILABLE,
    }


@app.get("/health")
async def health():
    """Detailed health check with system status."""
    cb_status = circuit_breaker.get_status()
    job_stats = job_store.get_stats()
    usage_stats = usage_tracker.get_usage()

    # Get concurrency stats
    async with concurrency_lock:
        concurrency_stats = {
            "active_jobs": active_jobs_count,
            "queued_jobs": queued_jobs_count,
            "max_concurrent": config.MAX_CONCURRENT_JOBS,
            "available_slots": config.MAX_CONCURRENT_JOBS - active_jobs_count,
        }

    return {
        "status": "healthy" if cb_status["state"] == "closed" else "degraded",
        "google_cloud_available": GOOGLE_CLOUD_AVAILABLE,
        "circuit_breaker": cb_status,
        "job_storage": job_stats,
        "usage": usage_stats,
        "concurrency": concurrency_stats,
        "config": config.display(),
    }


@app.get("/usage")
async def get_usage():
    """Get usage statistics."""
    usage_stats = usage_tracker.get_usage()
    return {
        "usage": usage_stats,
        "limits": {
            "per_minute": config.JOBS_PER_MINUTE_LIMIT,
            "per_hour": config.JOBS_PER_HOUR_LIMIT,
            "per_day": config.DAILY_API_CALLS_LIMIT,
        },
    }


@app.post("/capacity", response_model=CapacityResponse)
async def get_capacity(dimensions: ImageDimensions):
    """
    Calculate maximum number of images that can be processed for given dimensions.

    This helps clients determine optimal batch sizes before sending images.
    """
    max_images, limits, limiting_factor, estimated_size = calculate_capacity(dimensions.width, dimensions.height)

    return CapacityResponse(
        max_images=max_images, limits=limits, limiting_factor=limiting_factor, estimated_file_size_mb=estimated_size
    )


@app.post("/ocr/jobs", response_model=JobSubmitResponse)
async def submit_job(request: JobSubmitRequest):
    """
    Submit OCR job for async processing using Wasabi storage references.

    Downloads video.db from Wasabi and extracts requested frames for processing.
    Pre-fetches data for queued jobs to minimize latency.

    Returns job_id immediately. Poll GET /ocr/jobs/{id} for results.
    """
    global queued_jobs_count

    if not GOOGLE_CLOUD_AVAILABLE:
        raise HTTPException(status_code=503, detail="Google Cloud Vision not available")

    if not WASABI_AVAILABLE:
        raise HTTPException(status_code=503, detail="Wasabi storage not available")

    # Check concurrency limits BEFORE accepting job
    # Allow 1 active + 1 queued for pre-fetching
    max_queue_depth = config.MAX_CONCURRENT_JOBS + 1  # Active + 1 pre-fetching
    async with concurrency_lock:
        total_pending = active_jobs_count + queued_jobs_count
        if total_pending >= max_queue_depth:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "Service at capacity. Too many jobs queued.",
                    "active_jobs": active_jobs_count,
                    "queued_jobs": queued_jobs_count,
                    "max_queue_depth": max_queue_depth,
                },
            )
        # Reserve slot immediately to prevent race condition
        queued_jobs_count += 1

    try:
        # Check rate limits
        allowed, error_msg, usage_stats = usage_tracker.check_and_record(
            config.JOBS_PER_MINUTE_LIMIT, config.JOBS_PER_HOUR_LIMIT, config.DAILY_API_CALLS_LIMIT
        )

        if not allowed:
            raise HTTPException(status_code=429, detail={"error": error_msg, "usage": usage_stats})

        # Check circuit breaker
        cb_status = circuit_breaker.get_status()
        if cb_status["state"] == "open":
            raise HTTPException(
                status_code=503, detail="Service temporarily unavailable. Circuit breaker open due to repeated failures."
            )

        # Generate job ID (with deduplication based on video + frames)
        # Create a synthetic "images" list for job_store compatibility
        # Each frame gets an ID based on video_id and frame_index
        synthetic_images = [
            {"id": f"{request.video_id}_frame_{frame_idx}"} for frame_idx in sorted(request.frame_indices)
        ]
        job_id = job_store.generate_job_id(synthetic_images)

        # Check if this is a deduplicated job
        existing_job = job_store.get_job(job_id)
        if existing_job and existing_job.status == JobStatus.COMPLETED:
            # Release the reserved slot
            async with concurrency_lock:
                queued_jobs_count -= 1
            return JobSubmitResponse(
                job_id=job_id,
                status="completed",
                message="Job already completed (deduplicated). Retrieve results at GET /ocr/jobs/{id}",
            )

        # Create new job
        job_store.create_job(job_id, len(request.frame_indices))

        # Start download immediately (pre-fetch for queue throughput)
        download_task = asyncio.create_task(
            download_and_extract_frames(job_id, request.tenant_id, request.video_id, request.frame_indices)
        )

        # Track download task
        async with download_lock:
            download_tasks[job_id] = download_task

        # Start background processing (will wait for download to complete)
        asyncio.create_task(process_job_background_with_download(job_id, download_task, len(request.frame_indices)))

        return JobSubmitResponse(
            job_id=job_id, status="pending", message="Job submitted. Poll GET /ocr/jobs/{id} for results."
        )

    except HTTPException:
        # Release reserved slot on HTTP exceptions (rate limit, circuit breaker, etc.)
        async with concurrency_lock:
            queued_jobs_count -= 1
        raise


@app.get("/ocr/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    """
    Get job status and results.

    Poll this endpoint to check if job is complete.
    """
    job = job_store.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    response = JobStatusResponse(
        job_id=job.job_id,
        status=job.status.value,
        created_at=job.to_dict()["created_at"],
        started_at=job.to_dict().get("started_at"),
        completed_at=job.to_dict().get("completed_at"),
        processing_time_ms=job.processing_time_ms,
        images_count=job.images_count,
        error=job.error,
    )

    # Add result if completed
    if job.status == JobStatus.COMPLETED and job.result:
        response.result = JobResultResponse(**job.result)

    return response


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
