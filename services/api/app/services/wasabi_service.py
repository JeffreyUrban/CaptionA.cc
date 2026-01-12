"""
Wasabi S3 storage service interface and implementation.
Handles all object storage operations for video processing workflows.
"""
from typing import BinaryIO, Optional, Protocol
from pathlib import Path


class WasabiService(Protocol):
    """
    Interface for Wasabi S3 storage operations.
    Use Protocol for structural typing - implementations don't need to inherit.
    """

    # Upload operations
    def upload_file(
        self,
        key: str,
        data: bytes | BinaryIO,
        content_type: Optional[str] = None
    ) -> str:
        """
        Upload file to Wasabi S3.

        Args:
            key: S3 object key (full path)
            data: File data (bytes or file-like object)
            content_type: MIME type (e.g., 'image/jpeg', 'application/gzip')

        Returns:
            S3 key of uploaded file
        """
        ...

    def upload_from_path(
        self,
        key: str,
        local_path: Path | str,
        content_type: Optional[str] = None
    ) -> str:
        """
        Upload file from local filesystem to Wasabi S3.

        Args:
            key: S3 object key (full path)
            local_path: Local file path
            content_type: MIME type (auto-detected if None)

        Returns:
            S3 key of uploaded file
        """
        ...

    # Download operations
    def download_file(
        self,
        key: str,
        local_path: Path | str
    ) -> None:
        """
        Download file from Wasabi S3 to local filesystem.

        Args:
            key: S3 object key (full path)
            local_path: Local destination path
        """
        ...

    def download_to_bytes(self, key: str) -> bytes:
        """
        Download file from Wasabi S3 to memory.

        Args:
            key: S3 object key (full path)

        Returns:
            File contents as bytes
        """
        ...

    # Delete operations
    def delete_file(self, key: str) -> None:
        """
        Delete single file from Wasabi S3.

        Args:
            key: S3 object key (full path)
        """
        ...

    def delete_prefix(self, prefix: str) -> int:
        """
        Delete all files with given prefix from Wasabi S3.
        Used for cleaning up failed processing attempts.

        Args:
            prefix: S3 key prefix (e.g., 'tenant/client/videos/uuid/cropped_frames_v1/')

        Returns:
            Number of files deleted

        Warning:
            This is a destructive operation that deletes ALL files matching the prefix.
            Caller is responsible for providing correct prefix.
            No safety checks are performed - this is for programmatic use only.

        Usage Example:
            ```python
            # Clean up failed crop attempt
            deleted = wasabi.delete_prefix(
                f"{tenant_id}/client/videos/{video_id}/cropped_frames_v1/"
            )
            logger.info(f"Cleaned up {deleted} files from failed processing")
            ```
        """
        ...

    # Existence checks
    def file_exists(self, key: str) -> bool:
        """
        Check if file exists in Wasabi S3.

        Args:
            key: S3 object key (full path)

        Returns:
            True if file exists
        """
        ...

    # List operations
    def list_files(
        self,
        prefix: str,
        max_keys: Optional[int] = None
    ) -> list[str]:
        """
        List files with given prefix in Wasabi S3.

        Args:
            prefix: S3 key prefix
            max_keys: Maximum number of keys to return (None for all)

        Returns:
            List of S3 keys matching prefix
        """
        ...

    # URL generation
    def generate_presigned_url(
        self,
        key: str,
        expiration_seconds: int = 3600
    ) -> str:
        """
        Generate presigned URL for temporary file access.

        Args:
            key: S3 object key (full path)
            expiration_seconds: URL expiration time

        Returns:
            Presigned URL
        """
        ...


# Concrete implementation placeholder
class WasabiServiceImpl:
    """
    Concrete implementation of WasabiService.
    To be extracted from /services/orchestrator/wasabi_client.py
    """

    def __init__(
        self,
        access_key: str,
        secret_key: str,
        bucket: str,
        region: str = "us-east-1"
    ):
        """
        Initialize Wasabi S3 client.

        Args:
            access_key: Wasabi access key
            secret_key: Wasabi secret key
            bucket: S3 bucket name
            region: Wasabi region
        """
        self.access_key = access_key
        self.secret_key = secret_key
        self.bucket = bucket
        self.region = region
        # TODO: Initialize boto3 S3 client

    # Implement all methods from WasabiService protocol
    # Extract implementation from orchestrator service
