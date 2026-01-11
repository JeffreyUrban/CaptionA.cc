"""Video-related endpoints: image URLs."""

import asyncio

import boto3
from botocore.config import Config
from fastapi import APIRouter, HTTPException, Query, status

from app.config import get_settings
from app.dependencies import Auth

router = APIRouter()


def _generate_presigned_url(
    s3_client, bucket: str, key: str, expires_in: int = 3600
) -> str:
    """Generate a presigned URL for an S3 object."""
    return s3_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires_in,
    )


@router.get("/{video_id}/image-urls")
async def get_image_urls(
    video_id: str,
    auth: Auth,
    frames: str = Query(..., description="Comma-separated frame indices (e.g., '0,10,20')"),
):
    """
    Get presigned URLs for frame images.

    Returns presigned URLs for the specified frame images stored in Wasabi.
    URLs are valid for 1 hour.
    """
    settings = get_settings()

    # Parse frame indices
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

    if len(frame_indices) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 100 frames per request.",
        )

    # Create S3 client for Wasabi
    s3_client = boto3.client(
        "s3",
        endpoint_url=settings.wasabi_endpoint_url,
        aws_access_key_id=settings.wasabi_access_key_id,
        aws_secret_access_key=settings.wasabi_secret_access_key,
        region_name=settings.wasabi_region,
        config=Config(signature_version="s3v4"),
    )

    # Generate presigned URLs for each frame
    def generate_urls():
        urls = {}
        for frame_idx in frame_indices:
            # Frame images are stored as: {tenant_id}/videos/{video_id}/frames/frame_{index}.jpg
            key = f"{auth.tenant_id}/videos/{video_id}/frames/frame_{frame_idx}.jpg"
            try:
                url = _generate_presigned_url(
                    s3_client, settings.wasabi_bucket, key, expires_in=3600
                )
                urls[str(frame_idx)] = url
            except Exception:
                # Skip frames that don't exist or have errors
                urls[str(frame_idx)] = None
        return urls

    urls = await asyncio.to_thread(generate_urls)

    return {"urls": urls}
