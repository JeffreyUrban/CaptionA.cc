"""Wasabi storage operations for boundary inference.

Handles uploads/downloads of:
- Layout databases (for OCR viz and spatial metadata)
- Boundaries databases (inference results)
- Signed URLs for VP9/WebM chunks
"""

import os
from pathlib import Path

import boto3
from botocore.client import Config
from rich.console import Console

console = Console(stderr=True)


class WasabiStorage:
    """Wasabi S3 client for inference operations.

    Usage:
        storage = WasabiStorage()

        # Download layout.db
        layout_db = storage.download_layout_db(tenant_id, video_id, local_dir)

        # Upload boundaries.db
        storage.upload_boundaries_db(
            local_path, tenant_id, video_id,
            boundaries_version=1, model_version="abc123", run_id="550e8400"
        )

        # Generate signed URLs for chunks
        signed_urls = storage.generate_chunk_signed_urls(
            tenant_id, video_id, cropped_frames_version=1,
            chunk_indices=[0, 1, 16, 32], modulos=[16, 16, 16, 4]
        )
    """

    def __init__(
        self,
        access_key: str | None = None,
        secret_key: str | None = None,
        bucket_name: str = "caption-acc-prod",
        region: str = "us-east-1",
    ):
        """Initialize Wasabi storage client.

        Args:
            access_key: Wasabi access key (defaults to env var)
            secret_key: Wasabi secret key (defaults to env var)
            bucket_name: S3 bucket name
            region: Wasabi region
        """
        self.access_key = (
            access_key or os.environ.get("WASABI_ACCESS_KEY_READWRITE") or os.environ.get("WASABI_ACCESS_KEY")
        )
        self.secret_key = (
            secret_key or os.environ.get("WASABI_SECRET_KEY_READWRITE") or os.environ.get("WASABI_SECRET_KEY")
        )
        self.bucket_name = bucket_name
        self.region = region

        if not self.access_key or not self.secret_key:
            raise ValueError("Wasabi credentials required. Set WASABI_ACCESS_KEY and WASABI_SECRET_KEY")

        # Initialize S3 client
        self.s3_client = boto3.client(
            "s3",
            endpoint_url=f"https://s3.{region}.wasabisys.com",
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            config=Config(signature_version="s3v4"),
        )

    def download_layout_db(
        self,
        tenant_id: str,
        video_id: str,
        local_dir: Path,
    ) -> Path:
        """Download layout.db from Wasabi.

        The layout.db contains:
        - OCR visualization image (in video_layout_config)
        - Spatial metadata (anchor_type, crop coordinates)
        - Video metadata (frame dimensions, etc.)

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            local_dir: Local directory to save database

        Returns:
            Path to downloaded layout.db

        Raises:
            Exception: If download fails
        """
        storage_key = f"videos/{tenant_id}/{video_id}/layout.db"
        local_path = local_dir / "layout.db"

        # Create directory if needed
        local_path.parent.mkdir(parents=True, exist_ok=True)

        console.print(f"[cyan]Downloading layout.db from Wasabi...[/cyan]")
        console.print(f"  Storage key: {storage_key}")

        self.s3_client.download_file(
            self.bucket_name,
            storage_key,
            str(local_path),
        )

        file_size_mb = local_path.stat().st_size / 1024 / 1024
        console.print(f"[green]✓ Downloaded layout.db ({file_size_mb:.2f} MB)[/green]")

        return local_path

    def upload_boundaries_db(
        self,
        local_path: Path,
        tenant_id: str,
        video_id: str,
        boundaries_version: int,
        model_version: str,
        run_id: str,
    ) -> str:
        """Upload boundaries database to Wasabi.

        Filename format: v{version}_model-{model_hash[:8]}_run-{run_uuid}.db
        Storage location: videos/{tenant}/{video}/boundaries/{filename}

        Args:
            local_path: Path to local boundaries database
            tenant_id: Tenant UUID
            video_id: Video UUID
            boundaries_version: Boundaries version number
            model_version: Full model checkpoint hash
            run_id: Inference run UUID

        Returns:
            Storage key of uploaded file

        Raises:
            FileNotFoundError: If local file doesn't exist
            Exception: If upload fails
        """
        if not local_path.exists():
            raise FileNotFoundError(f"Boundaries database not found: {local_path}")

        # Build storage key
        from caption_boundaries.inference.boundaries_db import get_db_filename

        filename = get_db_filename(boundaries_version, model_version, run_id)
        storage_key = f"videos/{tenant_id}/{video_id}/boundaries/{filename}"

        console.print(f"[cyan]Uploading boundaries database to Wasabi...[/cyan]")
        console.print(f"  Storage key: {storage_key}")

        file_size_mb = local_path.stat().st_size / 1024 / 1024

        self.s3_client.upload_file(
            str(local_path),
            self.bucket_name,
            storage_key,
            ExtraArgs={"ContentType": "application/x-sqlite3"},
        )

        console.print(f"[green]✓ Uploaded boundaries database ({file_size_mb:.2f} MB)[/green]")

        return storage_key

    def generate_chunk_signed_urls(
        self,
        tenant_id: str,
        video_id: str,
        cropped_frames_version: int,
        chunk_indices: list[int],
        modulos: list[int],
        expiration: int = 3600,
    ) -> dict[int, str]:
        """Generate signed URLs for VP9/WebM chunks.

        Allows Modal function to download chunks directly from Wasabi without credentials.

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            cropped_frames_version: Frame version number
            chunk_indices: List of chunk indices to generate URLs for
            modulos: List of modulo levels (same length as chunk_indices)
            expiration: URL expiration in seconds (default: 1 hour)

        Returns:
            Mapping of chunk_index -> signed_url

        Example:
            urls = storage.generate_chunk_signed_urls(
                tenant_id="tenant-uuid",
                video_id="video-uuid",
                cropped_frames_version=1,
                chunk_indices=[0, 16, 32],
                modulos=[16, 16, 4],
                expiration=3600
            )
            # Returns: {0: "https://...", 16: "https://...", 32: "https://..."}
        """
        if len(chunk_indices) != len(modulos):
            raise ValueError("chunk_indices and modulos must have same length")

        signed_urls = {}

        console.print(f"[cyan]Generating signed URLs for {len(chunk_indices)} chunks...[/cyan]")

        for chunk_index, modulo in zip(chunk_indices, modulos):
            # Build storage key
            storage_key = (
                f"videos/{tenant_id}/{video_id}/"
                f"cropped_frames_v{cropped_frames_version}/"
                f"modulo_{modulo}/chunk_{chunk_index:04d}.webm"
            )

            # Generate presigned URL
            url = self.s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket_name, "Key": storage_key},
                ExpiresIn=expiration,
            )

            signed_urls[chunk_index] = url

        console.print(f"[green]✓ Generated {len(signed_urls)} signed URLs (valid for {expiration}s)[/green]")

        return signed_urls

    def file_exists(self, storage_key: str) -> bool:
        """Check if file exists in Wasabi.

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


def get_wasabi_storage() -> WasabiStorage:
    """Get WasabiStorage instance using environment credentials.

    Returns:
        WasabiStorage instance

    Raises:
        ValueError: If credentials not set in environment
    """
    return WasabiStorage()
