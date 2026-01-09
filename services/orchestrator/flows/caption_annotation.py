"""
Caption Annotation Workflow - Upload/Download captions.db

Handles caption annotation database synchronization with Wasabi:
1. Download captions.db from Wasabi (if exists - to continue annotations)
2. User annotates caption boundaries and text using cropped frames
3. Upload updated captions.db after user annotations

Captions.db contains:
- captions: Caption boundaries (start/end frame) and text content
- User annotations marking text regions in video

WebM chunks are streamed on-demand by browser using signed URLs,
so this workflow only handles the captions database file.
"""

import hashlib
from pathlib import Path
from typing import Any

from prefect import flow, task

from wasabi_client import WasabiClient, get_wasabi_client

# Default tenant for development
DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001"

@task(
    name="download-captions-db-from-wasabi",
    tags=["wasabi", "download"],
    log_prints=True,
)
def download_captions_db_from_wasabi(
    tenant_id: str,
    video_id: str,
    local_path: str,
) -> tuple[str, str]:
    """
    Download captions.db from Wasabi and compute its hash.

    Args:
        tenant_id: Tenant UUID
        video_id: Video UUID
        local_path: Local path to save the database

    Returns:
        Tuple of (local_path, sha256_hash)
    """
    print("[Wasabi] Downloading captions.db")

    client = get_wasabi_client()
    storage_key = WasabiClient.build_storage_key(tenant_id, video_id, "captions.db")

    # Check if file exists
    if not client.file_exists(storage_key):
        print("[Wasabi] captions.db does not exist yet (will be created)")
        return "", ""

    client.download_file(storage_key=storage_key, local_path=local_path)

    # Compute SHA-256 hash
    sha256_hash = hashlib.sha256()
    with open(local_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256_hash.update(chunk)

    hash_hex = sha256_hash.hexdigest()

    print(f"[Wasabi] captions.db downloaded: {local_path}")
    print(f"[Wasabi] SHA-256: {hash_hex}")

    return local_path, hash_hex

@task(
    name="upload-captions-db-to-wasabi",
    tags=["wasabi", "upload"],
    log_prints=True,
)
def upload_captions_db_to_wasabi(
    tenant_id: str,
    video_id: str,
    local_path: str,
) -> str:
    """
    Upload captions.db to Wasabi.

    Args:
        tenant_id: Tenant UUID
        video_id: Video UUID
        local_path: Local path to captions.db

    Returns:
        Storage key where captions.db was uploaded
    """
    print("[Wasabi] Uploading captions.db")

    client = get_wasabi_client()
    storage_key = WasabiClient.build_storage_key(tenant_id, video_id, "captions.db")

    client.upload_file(
        local_path=local_path,
        storage_key=storage_key,
        content_type="application/x-sqlite3",
    )

    print(f"[Wasabi] captions.db uploaded: {storage_key}")

    return storage_key

@flow(
    name="upload-captions-db",
    log_prints=True,
)
def upload_captions_db_flow(
    video_id: str,
    captions_db_path: str,
    tenant_id: str = DEFAULT_TENANT_ID,
) -> dict[str, Any]:
    """
    Upload captions.db to Wasabi after user annotations.

    This flow:
    1. Uploads captions.db to Wasabi
    2. Sends webhook notification to web app

    Args:
        video_id: Video UUID
        captions_db_path: Local path to annotated captions.db
        tenant_id: Tenant UUID (defaults to demo tenant)

    Returns:
        Dict with upload status
    """
    print(f"📤 Uploading captions.db for video: {video_id}")

    try:
        # Upload captions.db to Wasabi
        print("\n📤 Uploading captions.db to Wasabi...")
        storage_key = upload_captions_db_to_wasabi(
            tenant_id=tenant_id,
            video_id=video_id,
            local_path=captions_db_path,
        )

        print("\n✅ Captions.db upload complete!")

        return {
            "video_id": video_id,
            "storage_key": storage_key,
            "status": "completed",
        }

    except Exception as e:
        print(f"\n❌ Captions.db upload failed: {e}")
        raise


@flow(
    name="download-for-caption-annotation",
    log_prints=True,
)
def download_for_caption_annotation_flow(
    video_id: str,
    output_dir: str,
    tenant_id: str = DEFAULT_TENANT_ID,
) -> dict[str, Any]:
    """
    Download captions.db for caption annotation.

    This flow:
    1. Downloads captions.db from Wasabi if it exists (to continue annotations)

    Note: Cropped frame WebM chunks are streamed on-demand by browser using
    signed URLs, so they don't need to be downloaded in this flow.

    Args:
        video_id: Video UUID
        output_dir: Local directory to download files
        tenant_id: Tenant UUID (defaults to demo tenant)

    Returns:
        Dict with paths to downloaded files
    """
    print(f"📥 Downloading captions.db for annotation: {video_id}")

    try:
        # Ensure output directory exists
        Path(output_dir).mkdir(parents=True, exist_ok=True)

        # Download captions.db (optional - may not exist yet)
        print("\n📥 Downloading captions.db (if exists)...")
        captions_db_path = str(Path(output_dir) / "captions.db")
        captions_db_path, captions_db_hash = download_captions_db_from_wasabi(
            tenant_id=tenant_id,
            video_id=video_id,
            local_path=captions_db_path,
        )

        captions_exists = bool(captions_db_path)
        if captions_exists:
            print("✅ captions.db exists - continuing previous annotations")
        else:
            print("ℹ️  captions.db does not exist - starting fresh annotations")

        print("\n✅ Download complete!")

        return {
            "video_id": video_id,
            "status": "completed",
            "captions_db_path": captions_db_path if captions_exists else None,
            "captions_exists": captions_exists,
        }

    except Exception as e:
        print(f"\n❌ Download failed: {e}")
        raise
