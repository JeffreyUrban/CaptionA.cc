"""Wasabi S3 Client for Modal inference service.

NOTE: This is a LOCAL COPY of WasabiClient for Modal compatibility.

WHY THIS EXISTS:
- Modal containers only have access to code explicitly added via add_local_python_source()
- The caption_frame_extents package is added to Modal, but shared packages are NOT
- Importing from shared packages would fail with ModuleNotFoundError in Modal
- This local copy contains only the methods needed for inference (download, upload, URLs)

DO NOT REMOVE: This file is required for Modal GPU inference to work.

Environment variables (set via Modal secrets):
- WASABI_ACCESS_KEY_READWRITE: Wasabi access key
- WASABI_SECRET_KEY_READWRITE: Wasabi secret key
- WASABI_BUCKET: S3 bucket name
- WASABI_REGION: Wasabi region (defaults to us-east-1)
"""

import os
from pathlib import Path
from typing import BinaryIO

import boto3
from botocore.client import Config


class WasabiClient:
    """Client for interacting with Wasabi S3 storage."""

    def __init__(
        self,
        access_key: str | None = None,
        secret_key: str | None = None,
        bucket_name: str | None = None,
        region: str | None = None,
    ):
        """Initialize Wasabi S3 client.

        Args:
            access_key: Wasabi access key (defaults to WASABI_ACCESS_KEY_READWRITE env var)
            secret_key: Wasabi secret key (defaults to WASABI_SECRET_KEY_READWRITE env var)
            bucket_name: S3 bucket name (defaults to WASABI_BUCKET env var)
            region: Wasabi region (defaults to WASABI_REGION env var, or us-east-1)
        """
        self.access_key = access_key or os.environ.get("WASABI_ACCESS_KEY_READWRITE")
        self.secret_key = secret_key or os.environ.get("WASABI_SECRET_KEY_READWRITE")
        self.bucket_name = bucket_name or os.environ.get("WASABI_BUCKET")
        self.region = region or os.environ.get("WASABI_REGION", "us-east-1")

        if not self.access_key or not self.secret_key:
            raise ValueError(
                "Wasabi credentials required. Set WASABI_ACCESS_KEY_READWRITE and WASABI_SECRET_KEY_READWRITE"
            )
        if not self.bucket_name:
            raise ValueError("Wasabi bucket required. Set WASABI_BUCKET environment variable")

        self.s3_client = boto3.client(
            "s3",
            endpoint_url=f"https://s3.{self.region}.wasabisys.com",
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            config=Config(signature_version="s3v4"),
        )

    def download_file(self, storage_key: str, local_path: str | Path) -> Path:
        """Download a file from Wasabi.

        Args:
            storage_key: S3 key (path) of the file
            local_path: Local path to save file

        Returns:
            Path to downloaded file
        """
        local_path = Path(local_path)
        local_path.parent.mkdir(parents=True, exist_ok=True)

        self.s3_client.download_file(
            self.bucket_name,
            storage_key,
            str(local_path),
        )

        return local_path

    def download_fileobj(self, storage_key: str, file_obj: BinaryIO) -> None:
        """Download a file to a file-like object.

        Args:
            storage_key: S3 key (path) of the file
            file_obj: File-like object to write to
        """
        self.s3_client.download_fileobj(
            self.bucket_name,
            storage_key,
            file_obj,
        )

    def upload_file(
        self,
        local_path: str | Path,
        storage_key: str,
        content_type: str | None = None,
    ) -> str:
        """Upload a file to Wasabi.

        Args:
            local_path: Path to local file
            storage_key: S3 key (path) for the file
            content_type: MIME type (optional)

        Returns:
            Storage key of uploaded file
        """
        local_path = Path(local_path)

        if not local_path.exists():
            raise FileNotFoundError(f"Local file not found: {local_path}")

        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type

        self.s3_client.upload_file(
            str(local_path),
            self.bucket_name,
            storage_key,
            ExtraArgs=extra_args if extra_args else None,
        )

        return storage_key

    def generate_presigned_url(self, storage_key: str, expiration: int = 900) -> str:
        """Generate a presigned URL for downloading a file.

        Args:
            storage_key: S3 key (path) of the file
            expiration: URL expiration time in seconds (default: 15 minutes)

        Returns:
            Presigned URL
        """
        return self.s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket_name, "Key": storage_key},
            ExpiresIn=expiration,
        )

    @staticmethod
    def build_storage_key(tenant_id: str, video_id: str, filename: str) -> str:
        """Build a standard storage key for a file.

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            filename: Filename

        Returns:
            Storage key (e.g., "tenant_id/video_id/filename")
        """
        return f"{tenant_id}/{video_id}/{filename}"

    @staticmethod
    def build_chunk_storage_key(
        tenant_id: str,
        video_id: str,
        chunk_type: str,
        chunk_index: int,
        version: int | None = None,
        modulo: int | None = None,
    ) -> str:
        """Build a storage key for a cropped frame chunk.

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            chunk_type: Type of chunk (e.g., "cropped_frames")
            chunk_index: Chunk index (0-based)
            version: Optional version number
            modulo: Optional modulo level (1, 4, 16)

        Returns:
            Storage key for chunk
        """
        if version is not None:
            chunk_dir = f"{chunk_type}_v{version}"
        else:
            chunk_dir = chunk_type

        if modulo is not None:
            return f"{tenant_id}/{video_id}/{chunk_dir}/modulo_{modulo}/chunk_{chunk_index:010d}.webm"
        else:
            return f"{tenant_id}/{video_id}/{chunk_dir}/chunk_{chunk_index:010d}.webm"
