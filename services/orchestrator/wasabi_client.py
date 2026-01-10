"""
Wasabi S3 Client for Video and Database Storage

Manages uploads/downloads of:
- Video files
- Cropped frame chunks
- Annotations databases
- Full frame images

All stored with path structure: {tenant_id}/{video_id}/{resource}
"""

import os
from pathlib import Path
from typing import BinaryIO

import boto3
from botocore.client import Config


class WasabiClient:
    """Client for interacting with Wasabi S3 storage"""

    def __init__(
        self,
        access_key: str | None = None,
        secret_key: str | None = None,
        bucket_name: str = "caption-acc-prod",
        region: str = "us-east-1",
    ):
        """
        Initialize Wasabi S3 client.

        Args:
            access_key: Wasabi access key (defaults to WASABI_ACCESS_KEY env var)
            secret_key: Wasabi secret key (defaults to WASABI_SECRET_KEY env var)
            bucket_name: S3 bucket name
            region: Wasabi region
        """
        self.access_key = (
            access_key
            or os.environ.get("WASABI_ACCESS_KEY_READWRITE")
            or os.environ.get("WASABI_ACCESS_KEY")
        )
        self.secret_key = (
            secret_key
            or os.environ.get("WASABI_SECRET_KEY_READWRITE")
            or os.environ.get("WASABI_SECRET_KEY")
        )
        self.bucket_name = bucket_name
        self.region = region

        if not self.access_key or not self.secret_key:
            raise ValueError(
                "Wasabi credentials required. Set WASABI_ACCESS_KEY and WASABI_SECRET_KEY"
            )

        # Initialize S3 client for Wasabi
        self.s3_client = boto3.client(
            "s3",
            endpoint_url=f"https://s3.{region}.wasabisys.com",
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            config=Config(signature_version="s3v4"),
        )

    def upload_file(
        self,
        local_path: str | Path,
        storage_key: str,
        content_type: str | None = None,
    ) -> str:
        """
        Upload a file to Wasabi.

        Args:
            local_path: Path to local file
            storage_key: S3 key (path) for the file
            content_type: MIME type (optional, auto-detected if not provided)

        Returns:
            Storage key of uploaded file

        Example:
            client.upload_file(
                "/path/to/video.mp4",
                "tenant_id/video_id/video.mp4",
                content_type="video/mp4"
            )
        """
        local_path = Path(local_path)

        if not local_path.exists():
            raise FileNotFoundError(f"Local file not found: {local_path}")

        # Auto-detect content type if not provided
        if not content_type:
            content_type = self._guess_content_type(local_path)

        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type

        print(f"[Wasabi] Uploading {local_path.name} to {storage_key}")

        self.s3_client.upload_file(
            str(local_path),
            self.bucket_name,
            storage_key,
            ExtraArgs=extra_args,
        )

        print(f"[Wasabi] Upload complete: {storage_key}")
        return storage_key

    def upload_fileobj(
        self,
        file_obj: BinaryIO,
        storage_key: str,
        content_type: str | None = None,
    ) -> str:
        """
        Upload a file-like object to Wasabi.

        Args:
            file_obj: File-like object to upload
            storage_key: S3 key (path) for the file
            content_type: MIME type (optional)

        Returns:
            Storage key of uploaded file
        """
        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type

        print(f"[Wasabi] Uploading file object to {storage_key}")

        self.s3_client.upload_fileobj(
            file_obj,
            self.bucket_name,
            storage_key,
            ExtraArgs=extra_args,
        )

        print(f"[Wasabi] Upload complete: {storage_key}")
        return storage_key

    def download_file(
        self,
        storage_key: str,
        local_path: str | Path,
    ) -> Path:
        """
        Download a file from Wasabi.

        Args:
            storage_key: S3 key (path) of the file
            local_path: Local path to save file

        Returns:
            Path to downloaded file

        Example:
            client.download_file(
                "tenant_id/video_id/video.db",
                "/path/to/video.db"
            )
        """
        local_path = Path(local_path)

        # Create parent directories if needed
        local_path.parent.mkdir(parents=True, exist_ok=True)

        print(f"[Wasabi] Downloading {storage_key} to {local_path}")

        self.s3_client.download_file(
            self.bucket_name,
            storage_key,
            str(local_path),
        )

        print(f"[Wasabi] Download complete: {local_path}")
        return local_path

    def file_exists(self, storage_key: str) -> bool:
        """
        Check if a file exists in Wasabi.

        Args:
            storage_key: S3 key (path) of the file

        Returns:
            True if file exists, False otherwise
        """
        try:
            self.s3_client.head_object(Bucket=self.bucket_name, Key=storage_key)
            return True
        except self.s3_client.exceptions.ClientError:
            return False

    def delete_file(self, storage_key: str) -> None:
        """
        Delete a file from Wasabi.

        Args:
            storage_key: S3 key (path) of the file
        """
        print(f"[Wasabi] Deleting {storage_key}")
        self.s3_client.delete_object(Bucket=self.bucket_name, Key=storage_key)
        print(f"[Wasabi] Deleted: {storage_key}")

    def delete_prefix(self, prefix: str) -> int:
        """
        Delete all files with a given prefix (e.g., entire video folder).

        Args:
            prefix: S3 key prefix (e.g., "tenant_id/video_id/")

        Returns:
            Number of files deleted
        """
        print(f"[Wasabi] Deleting all files with prefix: {prefix}")

        # List all objects with prefix
        paginator = self.s3_client.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=self.bucket_name, Prefix=prefix)

        delete_count = 0
        for page in pages:
            if "Contents" not in page:
                continue

            # Delete in batches of 1000 (S3 limit)
            objects = [{"Key": obj["Key"]} for obj in page["Contents"]]
            if objects:
                self.s3_client.delete_objects(
                    Bucket=self.bucket_name,
                    Delete={"Objects": objects},
                )
                delete_count += len(objects)

        print(f"[Wasabi] Deleted {delete_count} files with prefix: {prefix}")
        return delete_count

    def list_files(self, prefix: str) -> list[str]:
        """
        List all files with a given prefix.

        Args:
            prefix: S3 key prefix (e.g., "tenant_id/video_id/")

        Returns:
            List of storage keys
        """
        paginator = self.s3_client.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=self.bucket_name, Prefix=prefix)

        keys = []
        for page in pages:
            if "Contents" in page:
                keys.extend([obj["Key"] for obj in page["Contents"]])

        return keys

    def get_file_size(self, storage_key: str) -> int:
        """
        Get the size of a file in Wasabi.

        Args:
            storage_key: S3 key (path) of the file

        Returns:
            File size in bytes
        """
        response = self.s3_client.head_object(Bucket=self.bucket_name, Key=storage_key)
        return response["ContentLength"]

    def generate_presigned_url(
        self,
        storage_key: str,
        expiration: int = 900,
    ) -> str:
        """
        Generate a presigned URL for downloading a file from Wasabi.

        This allows browser to download files directly without exposing credentials.
        Used for: cropped frame chunks, annotation databases, video files.

        Args:
            storage_key: S3 key (path) of the file
            expiration: URL expiration time in seconds (default: 900 = 15 minutes)

        Returns:
            Presigned URL valid for specified duration

        Example:
            url = client.generate_presigned_url(
                "tenant_id/video_id/layout.db",
                expiration=900
            )
            # Browser can download using this URL for next 15 minutes
        """
        url = self.s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket_name, "Key": storage_key},
            ExpiresIn=expiration,
        )
        return url

    @staticmethod
    def _guess_content_type(path: Path) -> str | None:
        """Guess MIME type from file extension"""
        extension = path.suffix.lower()
        content_types = {
            ".mp4": "video/mp4",
            ".mov": "video/quicktime",
            ".avi": "video/x-msvideo",
            ".mkv": "video/x-matroska",
            ".webm": "video/webm",  # VP9 chunks
            ".db": "application/x-sqlite3",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
        }
        return content_types.get(extension)

    @staticmethod
    def build_storage_key(tenant_id: str, video_id: str, filename: str) -> str:
        """
        Build a standard storage key for a file.

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            filename: Filename (e.g., "video.mp4", "captions.db")

        Returns:
            Storage key (e.g., "tenant_id/video_id/video.mp4")

        Example:
            key = WasabiClient.build_storage_key(
                "00000000-0000-0000-0000-000000000001",
                "a4f2b8c3-1234-5678-90ab-cdef12345678",
                "video.mp4"
            )
            # Returns: "00000000-0000-0000-0000-000000000001/a4f2b8c3-1234-5678-90ab-cdef12345678/video.mp4"
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
        """
        Build a storage key for a cropped frame chunk (WebM/VP9 format).

        Supports hierarchical modulo-based chunking for progressive loading.

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            chunk_type: Type of chunk (e.g., "cropped_frames")
            chunk_index: Chunk index (0-based)
            version: Optional version number for versioned chunks
            modulo: Optional modulo level (1, 4, 16) for hierarchical loading

        Returns:
            Storage key (e.g., "tenant_id/video_id/cropped_frames_v1/modulo_32/chunk_0000.webm")

        Example:
            key = WasabiClient.build_chunk_storage_key(
                "00000000-0000-0000-0000-000000000001",
                "a4f2b8c3-1234-5678-90ab-cdef12345678",
                "cropped_frames",
                0,
                version=1,
                modulo=32
            )
            # Returns: "00000000-.../cropped_frames_v1/modulo_16/chunk_0000.webm"
        """
        if version is not None:
            chunk_dir = f"{chunk_type}_v{version}"
        else:
            chunk_dir = chunk_type

        if modulo is not None:
            return (
                f"{tenant_id}/{video_id}/{chunk_dir}/modulo_{modulo}/chunk_{chunk_index:04d}.webm"
            )
        else:
            return f"{tenant_id}/{video_id}/{chunk_dir}/chunk_{chunk_index:04d}.webm"

    @staticmethod
    def build_chunk_prefix(
        tenant_id: str,
        video_id: str,
        chunk_type: str,
        version: int | None = None,
    ) -> str:
        """
        Build a storage prefix for all chunks of a specific type/version.

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            chunk_type: Type of chunk (e.g., "cropped_frames")
            version: Optional version number for versioned chunks

        Returns:
            Storage prefix (e.g., "tenant_id/video_id/cropped_frames_v1/")

        Example:
            prefix = WasabiClient.build_chunk_prefix(
                "00000000-0000-0000-0000-000000000001",
                "a4f2b8c3-1234-5678-90ab-cdef12345678",
                "cropped_frames",
                version=1
            )
            # Returns: "00000000-0000-0000-0000-000000000001/a4f2b8c3-1234-5678-90ab-cdef12345678/cropped_frames_v1/"
        """
        if version is not None:
            chunk_dir = f"{chunk_type}_v{version}"
        else:
            chunk_dir = chunk_type
        return f"{tenant_id}/{video_id}/{chunk_dir}/"


def get_wasabi_client() -> WasabiClient:
    """
    Get a Wasabi client instance using environment credentials.

    Returns:
        WasabiClient instance

    Raises:
        ValueError: If credentials are not set in environment
    """
    return WasabiClient()
