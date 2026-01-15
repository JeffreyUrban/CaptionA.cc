"""Wasabi S3 client for uploading VP9 chunks."""

import os
from pathlib import Path
from typing import Callable, Literal, TypedDict

import boto3
from botocore.exceptions import ClientError

FrameType = Literal["cropped", "full"]


class UploadResult(TypedDict):
    """Result from upload operation."""

    chunks_uploaded: int
    total_size_bytes: int
    s3_keys: list[str]


def get_s3_client():
    """Get configured S3 client for Wasabi.

    Returns:
        Configured boto3 S3 client

    Raises:
        ValueError: If required environment variables are missing
    """
    required_vars = ["WASABI_REGION", "WASABI_ACCESS_KEY", "WASABI_SECRET_KEY"]
    missing = [var for var in required_vars if not os.getenv(var)]

    if missing:
        raise ValueError(f"Missing required environment variables: {', '.join(missing)}")

    return boto3.client(
        "s3",
        endpoint_url=f"https://s3.{os.getenv('WASABI_REGION')}.wasabisys.com",
        aws_access_key_id=os.getenv("WASABI_ACCESS_KEY"),
        aws_secret_access_key=os.getenv("WASABI_SECRET_KEY"),
        region_name=os.getenv("WASABI_REGION"),
    )


def build_s3_key(
    video_id: str,
    frame_type: FrameType,
    modulo: int,
    filename: str,
    user_id: str = "default_user",
    environment: str = "dev",
) -> str:
    """Build S3 object key for a chunk file.

    Args:
        video_id: Video ID
        frame_type: "cropped" or "full"
        modulo: Modulo level
        filename: Chunk filename (e.g., chunk_0000000000.webm)
        user_id: User ID (default: "default_user")
        environment: Environment (dev/prod)

    Returns:
        S3 object key (path within bucket)
    """
    return f"{environment}/users/{user_id}/videos/{video_id}/{frame_type}_frames/modulo_{modulo}/{filename}"


def upload_chunk(s3_client, local_path: Path, s3_key: str, bucket: str) -> None:
    """Upload a single chunk to Wasabi.

    Args:
        s3_client: Configured boto3 S3 client
        local_path: Local file path
        s3_key: S3 object key (path within bucket)
        bucket: S3 bucket name

    Raises:
        ClientError: If upload fails
    """
    s3_client.upload_file(str(local_path), bucket, s3_key, ExtraArgs={"ContentType": "video/webm"})


def upload_chunks_to_wasabi(
    chunk_files: list[Path],
    video_id: str,
    frame_type: FrameType,
    user_id: str = "default_user",
    environment: str = "dev",
    progress_callback: Callable[[int, int], None] | None = None,
) -> UploadResult:
    """Upload chunks to Wasabi S3.

    Args:
        chunk_files: List of local chunk file paths
        video_id: Video ID
        frame_type: "cropped" or "full"
        user_id: User ID (default: "default_user")
        environment: Environment (dev/prod)
        progress_callback: Optional callback(current, total)

    Returns:
        UploadResult with upload metrics

    Raises:
        ValueError: If bucket not configured or upload fails
    """
    bucket = os.getenv("WASABI_BUCKET")
    if not bucket:
        raise ValueError("WASABI_BUCKET environment variable not set")

    s3_client = get_s3_client()

    # Group chunks by modulo level (parse from path)
    total_size_bytes = 0
    uploaded_keys = []
    total_chunks = len(chunk_files)

    for idx, chunk_path in enumerate(chunk_files):
        # Extract modulo from path: .../modulo_16/chunk_*.webm
        modulo = int(chunk_path.parent.name.split("_")[1])

        # Build S3 key
        s3_key = build_s3_key(
            video_id=video_id,
            frame_type=frame_type,
            modulo=modulo,
            filename=chunk_path.name,
            user_id=user_id,
            environment=environment,
        )

        # Upload chunk
        upload_chunk(s3_client, chunk_path, s3_key, bucket)

        # Track metrics
        total_size_bytes += chunk_path.stat().st_size
        uploaded_keys.append(s3_key)

        # Call progress callback
        if progress_callback:
            progress_callback(idx + 1, total_chunks)

    return {"chunks_uploaded": len(uploaded_keys), "total_size_bytes": total_size_bytes, "s3_keys": uploaded_keys}


def test_wasabi_connection() -> bool:
    """Test Wasabi credentials and bucket access.

    Returns:
        True if connection successful, False otherwise
    """
    try:
        bucket = os.getenv("WASABI_BUCKET")
        if not bucket:
            return False

        s3_client = get_s3_client()
        s3_client.head_bucket(Bucket=bucket)
        return True

    except (ClientError, ValueError):
        return False
