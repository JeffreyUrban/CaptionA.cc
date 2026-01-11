"""Video-related endpoints: image URLs and frame chunks."""

import asyncio
from enum import Enum

import boto3
from botocore.config import Config
from fastapi import APIRouter, HTTPException, Query, status

from app.config import get_settings
from app.dependencies import Auth

router = APIRouter()

# Constants
PRESIGNED_URL_EXPIRES_IN = 900  # 15 minutes
FRAMES_PER_CHUNK = 32
VALID_MODULO_VALUES = {1, 4, 16}


class ImageSize(str, Enum):
    """Image size options for frame images."""

    thumb = "thumb"
    full = "full"


def _get_s3_client():
    """Create and return an S3 client configured for Wasabi."""
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.wasabi_endpoint_url,
        aws_access_key_id=settings.wasabi_access_key_id,
        aws_secret_access_key=settings.wasabi_secret_access_key,
        region_name=settings.wasabi_region,
        config=Config(signature_version="s3v4"),
    )


def _generate_presigned_url(
    s3_client, bucket: str, key: str, expires_in: int = PRESIGNED_URL_EXPIRES_IN
) -> str:
    """Generate a presigned URL for an S3 object."""
    return s3_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires_in,
    )


def _parse_frame_indices(frames: str, max_frames: int = 100) -> list[int]:
    """Parse comma-separated frame indices string into a list of integers."""
    try:
        frame_indices = [int(f.strip()) for f in frames.split(",") if f.strip()]
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid frame indices. Must be comma-separated integers.",
        )

    if not frame_indices:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one frame index is required.",
        )

    if len(frame_indices) > max_frames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum {max_frames} frames per request.",
        )

    return frame_indices


@router.get("/{video_id}/image-urls")
async def get_image_urls(
    video_id: str,
    auth: Auth,
    frames: str = Query(..., description="Comma-separated frame indices (e.g., '0,10,20')"),
    size: ImageSize = Query(
        ImageSize.thumb, description="Image size: 'thumb' (~100px) or 'full' (original)"
    ),
):
    """
    Get presigned URLs for frame images (layout page).

    Returns presigned URLs for the specified frame images stored in Wasabi.
    Use 'thumb' for thumbnails in frame strip, 'full' for detailed view.
    URLs are valid for 15 minutes.
    """
    settings = get_settings()
    frame_indices = _parse_frame_indices(frames)
    s3_client = _get_s3_client()

    def generate_urls():
        urls = {}
        for frame_idx in frame_indices:
            # Path depends on size:
            # - thumb: {tenant_id}/videos/{video_id}/thumbnails/frame_{index}.jpg
            # - full: {tenant_id}/videos/{video_id}/frames/frame_{index}.jpg
            if size == ImageSize.thumb:
                key = f"{auth.tenant_id}/videos/{video_id}/thumbnails/frame_{frame_idx}.jpg"
            else:
                key = f"{auth.tenant_id}/videos/{video_id}/frames/frame_{frame_idx}.jpg"

            try:
                url = _generate_presigned_url(s3_client, settings.wasabi_bucket, key)
                urls[str(frame_idx)] = url
            except Exception:
                # Skip frames that don't exist or have errors
                urls[str(frame_idx)] = None
        return urls

    urls = await asyncio.to_thread(generate_urls)

    return {"urls": urls, "expiresIn": PRESIGNED_URL_EXPIRES_IN}


@router.get("/{video_id}/frame-chunks")
async def get_frame_chunks(
    video_id: str,
    auth: Auth,
    modulo: int = Query(..., description="Sampling level: 16, 4, or 1"),
    indices: str = Query(..., description="Comma-separated frame indices to load"),
):
    """
    Get presigned URLs for VP9 WebM video chunks containing cropped frames (caption editing).

    Chunks are organized by modulo level for hierarchical loading:
    - modulo=16: Coarsest, every 16th frame
    - modulo=4: Medium, every 4th frame (excluding mod-16)
    - modulo=1: Finest, all remaining frames

    Each chunk contains 32 frames. Client extracts individual frames via video element + canvas.
    URLs are valid for 15 minutes.
    """
    # Validate modulo value
    if modulo not in VALID_MODULO_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Invalid modulo value. Must be one of: {sorted(VALID_MODULO_VALUES)}",
        )

    settings = get_settings()
    frame_indices = _parse_frame_indices(indices, max_frames=500)
    s3_client = _get_s3_client()

    def generate_chunk_urls():
        # Group frame indices by chunk
        # Chunk size in frame indices = 32 frames × modulo spacing
        chunk_size = FRAMES_PER_CHUNK * modulo
        chunks_map: dict[int, list[int]] = {}

        for frame_idx in frame_indices:
            chunk_start = (frame_idx // chunk_size) * chunk_size
            if chunk_start not in chunks_map:
                chunks_map[chunk_start] = []
            chunks_map[chunk_start].append(frame_idx)

        # Generate presigned URLs for each chunk
        chunks = []
        for chunk_start, chunk_frames in chunks_map.items():
            # Chunk files stored as: {tenant_id}/videos/{video_id}/chunks/mod{modulo}/chunk_{start}.webm
            key = f"{auth.tenant_id}/videos/{video_id}/chunks/mod{modulo}/chunk_{chunk_start}.webm"
            try:
                url = _generate_presigned_url(s3_client, settings.wasabi_bucket, key)
                chunks.append(
                    {
                        "chunkIndex": chunk_start,
                        "signedUrl": url,
                        "frameIndices": sorted(chunk_frames),
                    }
                )
            except Exception:
                # Skip chunks that don't exist or have errors
                pass

        return chunks

    chunks = await asyncio.to_thread(generate_chunk_urls)

    return {"chunks": chunks, "expiresIn": PRESIGNED_URL_EXPIRES_IN}
