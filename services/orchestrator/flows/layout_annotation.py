"""
Layout Annotation Workflow - Upload/Download layout.db

Handles layout annotation database synchronization with Wasabi:
1. Download video.db and fullOCR.db from Wasabi (for annotation UI)
2. Download existing layout.db if it exists (to continue annotations)
3. Upload updated layout.db after user annotations
4. Detect crop region changes and trigger cropped frames regeneration if needed

Layout.db contains:
- full_frame_box_labels: User annotations marking caption regions
- box_classification_model: Trained Naive Bayes model for layout prediction
"""

import hashlib
from pathlib import Path
from typing import Any

from prefect import flow, task

from supabase_client import CroppedFramesVersionRepository
from wasabi_client import WasabiClient, get_wasabi_client

# Default tenant for development
DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001"


@task(
    name="download-database-from-wasabi",
    tags=["wasabi", "download"],
    log_prints=True,
)
def download_database_from_wasabi(
    tenant_id: str,
    video_id: str,
    db_name: str,
    local_path: str,
) -> tuple[str, str]:
    """
    Download a database file from Wasabi and compute its hash.

    Args:
        tenant_id: Tenant UUID
        video_id: Video UUID
        db_name: Database filename (e.g., "video.db", "fullOCR.db", "layout.db")
        local_path: Local path to save the database

    Returns:
        Tuple of (local_path, sha256_hash)
    """
    print(f"[Wasabi] Downloading {db_name}")

    client = get_wasabi_client()
    storage_key = WasabiClient.build_storage_key(tenant_id, video_id, db_name)

    # Check if file exists
    if not client.file_exists(storage_key):
        print(f"[Wasabi] {db_name} does not exist yet (will be created)")
        return "", ""

    client.download_file(storage_key=storage_key, local_path=local_path)

    # Compute SHA-256 hash
    sha256_hash = hashlib.sha256()
    with open(local_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256_hash.update(chunk)

    hash_hex = sha256_hash.hexdigest()

    print(f"[Wasabi] {db_name} downloaded: {local_path}")
    print(f"[Wasabi] SHA-256: {hash_hex}")

    return local_path, hash_hex


@task(
    name="upload-layout-db-to-wasabi",
    tags=["wasabi", "upload"],
    log_prints=True,
)
def upload_layout_db_to_wasabi(
    tenant_id: str,
    video_id: str,
    local_path: str,
) -> str:
    """
    Upload layout.db to Wasabi.

    Args:
        tenant_id: Tenant UUID
        video_id: Video UUID
        local_path: Local path to layout.db

    Returns:
        Storage key where layout.db was uploaded
    """
    print("[Wasabi] Uploading layout.db")

    client = get_wasabi_client()
    storage_key = WasabiClient.build_storage_key(tenant_id, video_id, "layout.db")

    client.upload_file(
        local_path=local_path,
        storage_key=storage_key,
        content_type="application/x-sqlite3",
    )

    print(f"[Wasabi] layout.db uploaded: {storage_key}")

    return storage_key


@task(
    name="detect-crop-region-change",
    tags=["detection"],
    log_prints=True,
)
def detect_crop_region_change(
    video_id: str,
    layout_db_path: str,
) -> tuple[bool, dict[str, int] | None]:
    """
    Detect if crop region have changed in layout.db.

    Compares the current crop region with the crop region used in the active
    cropped frames version (if it exists).

    Args:
        video_id: Video UUID
        layout_db_path: Path to layout.db

    Returns:
        Tuple of (crop_region_changed, new_crop_region)
    """
    print("[Detection] Checking for crop region changes")

    # Get crop region from layout.db
    # This requires reading the full_frame_box_labels table and computing crop region
    # For now, we'll return a placeholder
    # TODO: Implement actual crop region extraction from layout.db

    print("[Detection] TODO: Extract crop region from layout.db")

    # Get active cropped frames version
    versions_repo = CroppedFramesVersionRepository()
    active_version = versions_repo.get_active_version(video_id)

    if not active_version:
        print("[Detection] No active cropped frames version exists")
        return True, None  # Treat as changed if no version exists

    previous_crop_region = active_version.get("crop_region")
    print(f"[Detection] Previous crop region: {previous_crop_region}")

    # TODO: Compare crop region
    crop_region_changed = False  # Placeholder

    return crop_region_changed, previous_crop_region  # type: ignore[return-value]


@flow(
    name="upload-layout-db",
    log_prints=True,
)
def upload_layout_db_flow(
    video_id: str,
    layout_db_path: str,
    tenant_id: str = DEFAULT_TENANT_ID,
    trigger_crop_regen: bool = True,
) -> dict[str, Any]:
    """
    Upload layout.db to Wasabi after user annotations.

    This flow:
    1. Uploads layout.db to Wasabi
    2. Detects if crop region changed
    3. Optionally triggers cropped frames regeneration if crop region changed

    Args:
        video_id: Video UUID
        layout_db_path: Local path to annotated layout.db
        tenant_id: Tenant UUID (defaults to demo tenant)
        trigger_crop_regen: Whether to auto-trigger crop regeneration on crop region change

    Returns:
        Dict with upload status and whether crop regeneration was triggered
    """
    print(f"📤 Uploading layout.db for video: {video_id}")

    try:
        # Step 1: Upload layout.db to Wasabi
        print("\n📤 Step 1/2: Uploading layout.db to Wasabi...")
        storage_key = upload_layout_db_to_wasabi(
            tenant_id=tenant_id,
            video_id=video_id,
            local_path=layout_db_path,
        )

        # Step 2: Detect crop region changes
        print("\n🔍 Step 2/2: Detecting crop region changes...")
        crop_region_changed, previous_crop_region = detect_crop_region_change(
            video_id=video_id,
            layout_db_path=layout_db_path,
        )

        crop_regen_triggered = False

        if crop_region_changed and trigger_crop_regen:
            print("\n⚠️  Crop region have changed!")
            print("🎬 Triggering cropped frames regeneration...")

            # TODO: Queue crop-frames-to-webm flow
            # from .crop_frames_to_webm import crop_frames_to_webm_flow
            # crop_frames_to_webm_flow(video_id=video_id, tenant_id=tenant_id)

            crop_regen_triggered = True
            print("✅ Cropped frames regeneration queued")

        print("\n✅ Layout.db upload complete!")

        return {
            "video_id": video_id,
            "storage_key": storage_key,
            "crop_region_changed": crop_region_changed,
            "crop_regen_triggered": crop_regen_triggered,
            "status": "completed",
        }

    except Exception as e:
        print(f"\n❌ Layout.db upload failed: {e}")
        raise


@flow(
    name="download-for-layout-annotation",
    log_prints=True,
)
def download_for_layout_annotation_flow(
    video_id: str,
    output_dir: str,
    tenant_id: str = DEFAULT_TENANT_ID,
) -> dict[str, Any]:
    """
    Download necessary files for layout annotation.

    This flow:
    1. Downloads video.db from Wasabi (full frames for annotation UI)
    2. Downloads fullOCR.db from Wasabi (OCR results for suggested regions)
    3. Downloads layout.db from Wasabi if it exists (to continue annotations)

    Args:
        video_id: Video UUID
        output_dir: Local directory to download files
        tenant_id: Tenant UUID (defaults to demo tenant)

    Returns:
        Dict with paths to downloaded files
    """
    print(f"📥 Downloading files for layout annotation: {video_id}")

    try:
        # Ensure output directory exists
        Path(output_dir).mkdir(parents=True, exist_ok=True)

        # Step 1: Download video.db
        print("\n📥 Step 1/3: Downloading video.db...")
        video_db_path = str(Path(output_dir) / "video.db")
        video_db_path, video_db_hash = download_database_from_wasabi(
            tenant_id=tenant_id,
            video_id=video_id,
            db_name="video.db",
            local_path=video_db_path,
        )

        if not video_db_path:
            raise RuntimeError("video.db not found in Wasabi - video not processed yet")

        # Step 2: Download fullOCR.db
        print("\n📥 Step 2/3: Downloading fullOCR.db...")
        full_ocr_db_path = str(Path(output_dir) / "fullOCR.db")
        full_ocr_db_path, full_ocr_db_hash = download_database_from_wasabi(
            tenant_id=tenant_id,
            video_id=video_id,
            db_name="fullOCR.db",
            local_path=full_ocr_db_path,
        )

        if not full_ocr_db_path:
            raise RuntimeError("fullOCR.db not found in Wasabi - OCR not complete yet")

        # Step 3: Download layout.db (optional - may not exist yet)
        print("\n📥 Step 3/3: Downloading layout.db (if exists)...")
        layout_db_path = str(Path(output_dir) / "layout.db")
        layout_db_path, layout_db_hash = download_database_from_wasabi(
            tenant_id=tenant_id,
            video_id=video_id,
            db_name="layout.db",
            local_path=layout_db_path,
        )

        layout_exists = bool(layout_db_path)
        if layout_exists:
            print("✅ layout.db exists - continuing previous annotations")
        else:
            print("ℹ️  layout.db does not exist - starting fresh annotations")

        print("\n✅ Download complete!")

        return {
            "video_id": video_id,
            "status": "completed",
            "video_db_path": video_db_path,
            "fullOCR_db_path": full_ocr_db_path,
            "layout_db_path": layout_db_path if layout_exists else None,
            "layout_exists": layout_exists,
        }

    except Exception as e:
        print(f"\n❌ Download failed: {e}")
        raise
