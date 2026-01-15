"""
Wasabi S3 storage service interface and implementation.
Handles all object storage operations for video processing workflows.
"""

import io
import mimetypes
from pathlib import Path
from typing import BinaryIO, Optional, Protocol

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError


class WasabiService(Protocol):
    """
    Interface for Wasabi S3 storage operations.
    Use Protocol for structural typing - implementations don't need to inherit.
    """

    # Upload operations
    def upload_file(
        self, key: str, data: bytes | BinaryIO, content_type: Optional[str] = None
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
        self, key: str, local_path: Path | str, content_type: Optional[str] = None
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
    def download_file(self, key: str, local_path: Path | str) -> None:
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
    def list_files(self, prefix: str, max_keys: Optional[int] = None) -> list[str]:
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
    def generate_presigned_url(self, key: str, expiration_seconds: int = 3600) -> str:
        """
        Generate presigned URL for temporary file access.

        Args:
            key: S3 object key (full path)
            expiration_seconds: URL expiration time

        Returns:
            Presigned URL
        """
        ...


class WasabiServiceImpl:
    """
    Concrete implementation of WasabiService Protocol.
    Extracted and adapted from /services/orchestrator/wasabi_client.py
    """

    def __init__(
        self, access_key: str, secret_key: str, bucket: str, region: str = "us-east-1"
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

        # Initialize boto3 S3 client for Wasabi
        self.s3_client = boto3.client(
            "s3",
            endpoint_url=f"https://s3.{region}.wasabisys.com",
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            config=Config(signature_version="s3v4"),
        )

    # Upload operations
    def upload_file(
        self, key: str, data: bytes | BinaryIO, content_type: Optional[str] = None
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
        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type

        # Handle both bytes and file-like objects
        if isinstance(data, bytes):
            file_obj = io.BytesIO(data)
        else:
            file_obj = data

        self.s3_client.upload_fileobj(
            file_obj,
            self.bucket,
            key,
            ExtraArgs=extra_args,
        )

        return key

    def upload_from_path(
        self, key: str, local_path: Path | str, content_type: Optional[str] = None
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
        local_path = Path(local_path)

        if not local_path.exists():
            raise FileNotFoundError(f"Local file not found: {local_path}")

        # Auto-detect content type if not provided
        if not content_type:
            content_type = self._guess_content_type(local_path)

        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type

        self.s3_client.upload_file(
            str(local_path),
            self.bucket,
            key,
            ExtraArgs=extra_args,
        )

        return key

    # Download operations
    def download_file(self, key: str, local_path: Path | str) -> None:
        """
        Download file from Wasabi S3 to local filesystem.

        Args:
            key: S3 object key (full path)
            local_path: Local destination path
        """
        local_path = Path(local_path)

        # Create parent directories if needed
        local_path.parent.mkdir(parents=True, exist_ok=True)

        self.s3_client.download_file(
            self.bucket,
            key,
            str(local_path),
        )

    def download_to_bytes(self, key: str) -> bytes:
        """
        Download file from Wasabi S3 to memory.

        Args:
            key: S3 object key (full path)

        Returns:
            File contents as bytes
        """
        buffer = io.BytesIO()
        self.s3_client.download_fileobj(self.bucket, key, buffer)
        return buffer.getvalue()

    # Delete operations
    def delete_file(self, key: str) -> None:
        """
        Delete single file from Wasabi S3.

        Args:
            key: S3 object key (full path)
        """
        self.s3_client.delete_object(Bucket=self.bucket, Key=key)

    def delete_prefix(self, prefix: str) -> int:
        """
        Delete all files with given prefix from Wasabi S3.

        WARNING: This is a destructive operation with NO safety checks.
        Caller is responsible for providing the correct prefix.
        This method trusts the caller completely - use with extreme caution.

        Args:
            prefix: S3 key prefix (e.g., 'tenant/client/videos/uuid/cropped_frames_v1/')

        Returns:
            Number of files deleted

        Implementation Note:
            - Uses paginated listing to handle large prefixes
            - Deletes in batches of 1000 (S3 API limit)
            - No confirmation or validation of prefix
        """
        # List all objects with prefix
        paginator = self.s3_client.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=self.bucket, Prefix=prefix)

        delete_count = 0
        for page in pages:
            if "Contents" not in page:
                continue

            # Delete in batches of 1000 (S3 limit)
            objects = [{"Key": obj["Key"]} for obj in page["Contents"]]
            if objects:
                self.s3_client.delete_objects(
                    Bucket=self.bucket,
                    Delete={"Objects": objects},
                )
                delete_count += len(objects)

        return delete_count

    # Existence checks
    def file_exists(self, key: str) -> bool:
        """
        Check if file exists in Wasabi S3.

        Args:
            key: S3 object key (full path)

        Returns:
            True if file exists
        """
        try:
            self.s3_client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError:
            return False

    # List operations
    def list_files(self, prefix: str, max_keys: Optional[int] = None) -> list[str]:
        """
        List files with given prefix in Wasabi S3.

        Args:
            prefix: S3 key prefix
            max_keys: Maximum number of keys to return (None for all)

        Returns:
            List of S3 keys matching prefix
        """
        paginator = self.s3_client.get_paginator("list_objects_v2")

        # Configure pagination with max_keys if specified
        pagination_config = {}
        if max_keys is not None:
            pagination_config["MaxItems"] = max_keys
            pagination_config["PageSize"] = min(max_keys, 1000)  # S3 page limit

        pages = paginator.paginate(
            Bucket=self.bucket,
            Prefix=prefix,
            PaginationConfig=pagination_config if pagination_config else {},
        )

        keys = []
        for page in pages:
            if "Contents" in page:
                keys.extend([obj["Key"] for obj in page["Contents"]])
                # Stop early if we've hit max_keys
                if max_keys is not None and len(keys) >= max_keys:
                    keys = keys[:max_keys]
                    break

        return keys

    # URL generation
    def generate_presigned_url(self, key: str, expiration_seconds: int = 3600) -> str:
        """
        Generate presigned URL for temporary file access.

        Args:
            key: S3 object key (full path)
            expiration_seconds: URL expiration time

        Returns:
            Presigned URL
        """
        url = self.s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expiration_seconds,
        )
        return url

    # Helper methods
    @staticmethod
    def _guess_content_type(path: Path) -> str | None:
        """
        Guess MIME type from file extension.

        Args:
            path: File path

        Returns:
            MIME type string or None
        """
        # Try standard mimetypes library first
        content_type, _ = mimetypes.guess_type(str(path))
        if content_type:
            return content_type

        # Fallback to custom mapping for video/media files
        extension = path.suffix.lower()
        content_types = {
            ".mp4": "video/mp4",
            ".mov": "video/quicktime",
            ".avi": "video/x-msvideo",
            ".mkv": "video/x-matroska",
            ".webm": "video/webm",
            ".db": "application/x-sqlite3",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gz": "application/gzip",
            ".tar": "application/x-tar",
        }
        return content_types.get(extension)
