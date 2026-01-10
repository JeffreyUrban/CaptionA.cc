"""
Wasabi S3 Client for OCR Service

Minimal client for downloading video.db files from Wasabi storage.
"""

import os
from pathlib import Path

import boto3
from botocore.client import Config


class WasabiClient:
    """Minimal Wasabi client for downloading video databases"""

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
            access_key: Wasabi access key (defaults to env var)
            secret_key: Wasabi secret key (defaults to env var)
            bucket_name: S3 bucket name
            region: Wasabi region
        """
        self.access_key = access_key or os.environ.get("WASABI_ACCESS_KEY")
        self.secret_key = secret_key or os.environ.get("WASABI_SECRET_KEY")
        self.bucket_name = bucket_name
        self.region = region

        if not self.access_key or not self.secret_key:
            raise ValueError("Wasabi credentials required. Set WASABI_ACCESS_KEY and WASABI_SECRET_KEY")

        # Initialize S3 client for Wasabi
        self.s3_client = boto3.client(
            "s3",
            endpoint_url=f"https://s3.{region}.wasabisys.com",
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            config=Config(signature_version="s3v4"),
        )

    def download_file(self, storage_key: str, local_path: str | Path) -> Path:
        """
        Download a file from Wasabi.

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

    @staticmethod
    def build_storage_key(tenant_id: str, video_id: str, filename: str) -> str:
        """
        Build a standard storage key for a file.

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            filename: Filename (e.g., "video.db")

        Returns:
            Storage key (e.g., "tenant_id/video_id/video.db")
        """
        return f"{tenant_id}/{video_id}/{filename}"


def get_wasabi_client() -> WasabiClient:
    """Get a Wasabi client instance using environment credentials."""
    return WasabiClient()
