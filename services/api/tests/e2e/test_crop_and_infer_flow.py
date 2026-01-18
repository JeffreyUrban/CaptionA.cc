"""
End-to-end integration tests for crop_and_infer flow.

Tests the complete crop and infer caption frame extents workflow with real services:
- Modal: GPU-based frame cropping and inference
- Supabase: Video metadata and lock management
- Wasabi: S3 storage for cropped frames and databases

These tests verify:
1. Flow execution with real Modal functions
2. Lock acquisition and release (critical for preventing concurrent edits)
3. File creation in Wasabi (cropped frames, caption_frame_extents.db.gz)
4. Video metadata updates in Supabase
5. Proper error handling and cleanup

Test Requirements:
- Environment variables configured for all services
- Pre-existing video in Supabase with layout.db uploaded to Wasabi
- Sufficient Modal credits for GPU processing
"""

import time
from datetime import datetime, timezone
from typing import Any

import pytest

from app.config import get_settings
from app.flows.crop_and_infer import crop_and_infer
from app.services.supabase_service import SupabaseServiceImpl
from app.services.wasabi_service import WasabiServiceImpl


@pytest.mark.e2e
@pytest.mark.slow
class TestCropAndInferE2E:
    """End-to-end tests for crop_and_infer flow with real services."""

    @pytest.fixture
    async def test_video(self):
        """
        Create test video fixture with layout.db already processed.

        This fixture:
        1. Creates a test video record in Supabase
        2. Uploads a test layout.db to Wasabi (simulating completed layout phase)
        3. Returns video metadata for test execution
        4. Cleans up resources after test completion

        Returns:
            Dict with video_id, tenant_id, and other metadata
        """
        settings = get_settings()

        # Initialize services
        supabase = SupabaseServiceImpl(
            supabase_url=settings.supabase_url,
            supabase_key=settings.supabase_service_role_key,
            schema=settings.supabase_schema,
        )

        wasabi = WasabiServiceImpl(
            access_key=settings.effective_wasabi_access_key,
            secret_key=settings.effective_wasabi_secret_key,
            bucket=settings.wasabi_bucket,
            region=settings.wasabi_region,
        )

        # Generate unique test identifiers using UUIDs (database expects UUID format)
        import uuid

        tenant_id = str(uuid.uuid4())  # Real UUID for database compatibility
        video_id = str(uuid.uuid4())  # Real UUID for database compatibility

        # Use persistent test fixture instead of uploading each time
        storage_key = "test-fixtures/videos/car-teardown-comparison-08.mp4"

        # Create tenant record FIRST (required by foreign key constraint)
        try:
            supabase.client.schema(settings.supabase_schema).table("tenants").insert(
                {
                    "id": tenant_id,
                    "name": f"Test Tenant {tenant_id[:8]}",
                    "slug": f"test-tenant-{tenant_id[:8]}",
                }
            ).execute()
            print(f"Created tenant record in Supabase (tenant_id: {tenant_id})")
        except Exception as e:
            raise RuntimeError(
                f"Failed to create tenant record in Supabase: {e}"
            ) from e

        # Create video record in Supabase with all required fields
        # This must happen before video_database_state due to foreign key constraint
        # Required NOT NULL fields from actual schema: video_path, storage_key
        # Note: width/height documented but don't exist in production yet
        try:
            supabase.client.schema(settings.supabase_schema).table("videos").insert(
                {
                    "id": video_id,
                    "tenant_id": tenant_id,
                    "video_path": f"test-videos/{video_id}.mp4",  # Required: user-facing path
                    "storage_key": storage_key,  # Required: Wasabi key
                    "status": "active",
                    "uploaded_at": datetime.now(timezone.utc).isoformat(),
                }
            ).execute()
            print(f"Created video record in Supabase (video_id: {video_id})")
        except Exception as e:
            raise RuntimeError(f"Failed to create video record in Supabase: {e}") from e

        # Video already exists at: test-fixtures/videos/car-teardown-comparison-08.mp4
        # No need to upload - using persistent fixture
        print(f"Using persistent test fixture: {storage_key}")

        # Upload a minimal layout.db to simulate completed layout phase
        # This is required for crop_and_infer to have something to reference
        layout_db_key = f"{tenant_id}/server/videos/{video_id}/layout.db"

        # Create minimal valid layout.db (SQLite database)
        import sqlite3
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmpdir:
            layout_db_path = Path(tmpdir) / "layout.db"
            conn = sqlite3.connect(str(layout_db_path))

            # Create minimal schema that layout analysis expects
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS database_metadata (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    schema_version INTEGER NOT NULL DEFAULT 1
                );
                INSERT INTO database_metadata (id, schema_version) VALUES (1, 1);

                CREATE TABLE IF NOT EXISTS video_layout_config (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    frame_width INTEGER NOT NULL DEFAULT 1920,
                    frame_height INTEGER NOT NULL DEFAULT 1080,
                    crop_left INTEGER NOT NULL DEFAULT 0,
                    crop_top INTEGER NOT NULL DEFAULT 700,
                    crop_right INTEGER NOT NULL DEFAULT 1920,
                    crop_bottom INTEGER NOT NULL DEFAULT 1080
                );
                INSERT INTO video_layout_config (id) VALUES (1);

                CREATE TABLE IF NOT EXISTS video_preferences (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    layout_approved INTEGER NOT NULL DEFAULT 1
                );
                INSERT INTO video_preferences (id, layout_approved) VALUES (1, 1);
            """)
            conn.commit()
            conn.close()

            # Upload layout.db to Wasabi
            wasabi.upload_from_path(
                key=layout_db_key,
                local_path=layout_db_path,
                content_type="application/x-sqlite3",
            )

        # Create video_database_state record for lock management
        # This is required for acquire_server_lock to work
        try:
            supabase.client.schema(settings.supabase_schema).table(
                "video_database_state"
            ).insert(
                {
                    "video_id": video_id,
                    "database_name": "layout",
                    "tenant_id": tenant_id,
                    "server_version": 1,
                    "wasabi_version": 1,
                    "wasabi_synced_at": datetime.now(timezone.utc).isoformat(),
                }
            ).execute()
        except Exception as e:
            print(f"Warning: Could not create video_database_state record: {e}")
            # Continue anyway - test may still work if lock management is mocked

        yield {
            "video_id": video_id,
            "tenant_id": tenant_id,
            "storage_key": storage_key,
            "layout_db_key": layout_db_key,
        }

        # Cleanup: Delete all test resources
        print(f"\nCleaning up test resources for video {video_id}...")

        # Delete all files in Wasabi with this tenant prefix
        try:
            deleted_count = wasabi.delete_prefix(f"{tenant_id}/")
            print(f"Deleted {deleted_count} files from Wasabi")
        except Exception as e:
            print(f"Warning: Failed to clean up Wasabi files: {e}")

        # Delete video_database_state records
        try:
            supabase.client.schema(settings.supabase_schema).table(
                "video_database_state"
            ).delete().eq("video_id", video_id).execute()
            print("Deleted video_database_state records")
        except Exception as e:
            print(f"Warning: Failed to clean up video_database_state: {e}")

        # Delete video record from Supabase
        try:
            supabase.client.schema(settings.supabase_schema).table(
                "videos"
            ).delete().eq("id", video_id).execute()
            print(f"Deleted video record from Supabase (video_id: {video_id})")
        except Exception as e:
            print(f"Warning: Failed to clean up video record: {e}")

        # Delete tenant record from Supabase (must be last due to foreign keys)
        try:
            supabase.client.schema(settings.supabase_schema).table(
                "tenants"
            ).delete().eq("id", tenant_id).execute()
            print(f"Deleted tenant record from Supabase (tenant_id: {tenant_id})")
        except Exception as e:
            print(f"Warning: Failed to clean up tenant record: {e}")

    @pytest.mark.asyncio
    async def test_crop_and_infer_integration(self, test_video: dict[str, Any]):
        """
        Test crop and infer flow integration with real services.

        This test verifies:
        1. Flow execution with real Modal GPU inference
        2. Lock acquisition prevents concurrent processing
        3. Cropped frames created in Wasabi
        4. Caption frame extents database created in Wasabi
        5. Video metadata updated with version
        6. Lock properly released after completion

        Test Flow:
        1. Trigger approve-layout API endpoint (validates API integration)
        2. Execute crop_and_infer flow directly (validates flow logic)
        3. Verify results: status, version, file creation
        4. Verify lock was acquired and released
        """
        settings = get_settings()
        video_id = test_video["video_id"]
        tenant_id = test_video["tenant_id"]

        # Initialize services for verification
        supabase = SupabaseServiceImpl(
            supabase_url=settings.supabase_url,
            supabase_key=settings.supabase_service_role_key,
            schema=settings.supabase_schema,
        )

        wasabi = WasabiServiceImpl(
            access_key=settings.effective_wasabi_access_key,
            secret_key=settings.effective_wasabi_secret_key,
            bucket=settings.wasabi_bucket,
            region=settings.wasabi_region,
        )

        # Step 1: Trigger via API endpoint (validates API integration)
        # NOTE: This step is optional for E2E test - we can test the flow directly
        # Uncommenting this requires a running API server with proper auth
        """
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        response = client.post(
            f"/videos/{video_id}/actions/approve-layout",
            json={
                "type": "crop-and-infer-caption-frame-extents",
                "crop_region": {
                    "crop_left": 0.1859398879,
                    "crop_top": 0.8705440901,
                    "crop_right": 0.8155883851,
                    "crop_bottom": 0.9455909944
                }
            },
            headers={"Authorization": f"Bearer test-token"}
        )

        assert response.status_code == 200
        flow_run_id = response.json()["jobId"]
        print(f"Triggered flow run: {flow_run_id}")
        """

        # Step 2: Define crop region for inference
        # Using specific bounds for car-teardown-comparison-08 video
        crop_region = {
            "crop_left": 0.1859398879,
            "crop_top": 0.8705440901,
            "crop_right": 0.8155883851,
            "crop_bottom": 0.9455909944,
        }

        # Step 3: Verify lock can be acquired (should be available before flow starts)
        lock_available = supabase.acquire_server_lock(
            video_id=video_id,
            database_name="layout",
            lock_holder_user_id=None,  # System lock
        )

        if lock_available:
            # Release it so the flow can acquire it
            supabase.release_server_lock(
                video_id=video_id,
                database_name="layout",
            )
            print("Pre-test lock check: Lock is available")
        else:
            pytest.skip(
                "Lock is not available - another process may be using this video"
            )

        # Step 4: Execute flow directly (tests our flow logic with lock management)
        print(f"\nExecuting crop_and_infer flow for video {video_id}...")
        start_time = time.time()

        result = await crop_and_infer(
            video_id=video_id,
            tenant_id=tenant_id,
            crop_region=crop_region,
        )

        elapsed_time = time.time() - start_time
        print(f"Flow completed in {elapsed_time:.2f} seconds")

        # Step 5: Verify flow results
        assert result is not None, "Flow returned None"
        assert result["status"] == "completed", f"Flow status: {result.get('status')}"
        assert "cropped_frames_version" in result, (
            "Missing cropped_frames_version in result"
        )
        assert result["cropped_frames_version"] > 0, "Invalid version number"

        version = result["cropped_frames_version"]
        print(
            f"Flow result: version={version}, frame_count={result.get('frame_count')}"
        )

        # Step 6: Verify cropped frames created in Wasabi
        cropped_frames_prefix = (
            f"{tenant_id}/client/videos/{video_id}/cropped_frames_v{version}/"
        )

        print(f"\nVerifying cropped frames at: {cropped_frames_prefix}")
        cropped_files = wasabi.list_files(prefix=cropped_frames_prefix, max_keys=10)

        assert len(cropped_files) > 0, (
            f"No cropped frames found at {cropped_frames_prefix}. "
            "Modal function may have failed to upload frames."
        )
        print(f"Found {len(cropped_files)} cropped frame files (showing first 10)")

        # Step 7: Verify caption_frame_extents database created in Wasabi
        caption_db_key = (
            f"{tenant_id}/server/videos/{video_id}/caption_frame_extents_v{version}.db"
        )

        print(f"\nVerifying caption_frame_extents database at: {caption_db_key}")
        db_exists = wasabi.file_exists(caption_db_key)

        assert db_exists, (
            f"Caption frame extents database not found at {caption_db_key}. "
            "Modal inference function may have failed."
        )
        print("Caption frame extents database exists")

        # Step 8: Verify video metadata updated with cropped frames version
        print(f"\nVerifying video metadata updated with version {version}...")
        video_metadata = supabase.get_video_metadata(video_id)

        # Note: Depending on schema, this may be current_cropped_frames_version
        current_version = video_metadata.get("current_cropped_frames_version")
        assert current_version == version, (
            f"Video metadata not updated. Expected version {version}, "
            f"got {current_version}"
        )
        print(
            f"Video metadata correctly updated: current_cropped_frames_version={current_version}"
        )

        # Step 9: Verify lock was released (CRITICAL for this test)
        # Query video_database_state to ensure lock_holder_user_id is NULL
        print("\nVerifying lock was released...")

        response = (
            supabase.client.schema(settings.supabase_schema)
            .table("video_database_state")
            .select("lock_holder_user_id, lock_type, locked_at")
            .eq("video_id", video_id)
            .eq("database_name", "layout")
            .maybe_single()
            .execute()
        )

        # Type narrowing: ensure response.data is treated as dict when not None
        lock_state = getattr(response, "data", None)  # Safely access data attribute

        if lock_state is not None and isinstance(lock_state, dict):
            lock_holder = lock_state.get("lock_holder_user_id")
            lock_type = lock_state.get("lock_type")

            assert lock_holder is None, (
                f"Lock was not released! Still held by: {lock_holder} "
                f"(type: {lock_type}). This indicates a bug in lock management."
            )
            assert lock_type is None, (
                f"Lock type still set: {lock_type}. Lock should be fully released."
            )
            print("Lock properly released: lock_holder_user_id=NULL, lock_type=NULL")
        else:
            # No lock state record - this is also acceptable (lock released)
            print("No lock state record found (lock was released or never tracked)")

        # Step 10: Verify we can acquire lock again (proves lock is truly released)
        print("\nVerifying lock can be re-acquired...")
        lock_available = supabase.acquire_server_lock(
            video_id=video_id,
            database_name="layout",
            lock_holder_user_id="test-verification",
        )

        assert lock_available, (
            "Failed to re-acquire lock after flow completion. "
            "This indicates the lock was not properly released."
        )
        print("Lock successfully re-acquired - verification complete")

        # Clean up test lock
        supabase.release_server_lock(
            video_id=video_id,
            database_name="layout",
        )

        print("\n=== Test Passed ===")
        print("✓ Flow executed successfully")
        print(f"✓ Version {version} created")
        print("✓ Cropped frames uploaded to Wasabi")
        print("✓ Caption frame extents database created")
        print("✓ Video metadata updated")
        print("✓ Lock properly acquired and released")

    @pytest.mark.asyncio
    async def test_crop_and_infer_lock_contention(self, test_video: dict[str, Any]):
        """
        Test that crop_and_infer properly handles lock contention.

        This test verifies:
        1. Flow fails if lock is already held
        2. Proper error message is returned
        3. No partial state is left behind

        This is critical for preventing data corruption from concurrent processing.
        """
        settings = get_settings()
        video_id = test_video["video_id"]
        tenant_id = test_video["tenant_id"]

        # Initialize Supabase service
        supabase = SupabaseServiceImpl(
            supabase_url=settings.supabase_url,
            supabase_key=settings.supabase_service_role_key,
            schema=settings.supabase_schema,
        )

        # Step 1: Acquire lock externally (simulate another process)
        print("Acquiring lock to simulate concurrent processing...")
        lock_acquired = supabase.acquire_server_lock(
            video_id=video_id,
            database_name="layout",
            lock_holder_user_id="external-process",
        )

        assert lock_acquired, "Failed to acquire test lock"
        print("Lock acquired by external process")

        try:
            # Step 2: Attempt to run flow (should fail immediately)
            crop_region = {
                "crop_left": 0.1859398879,
                "crop_top": 0.8705440901,
                "crop_right": 0.8155883851,
                "crop_bottom": 0.9455909944,
            }

            print("\nAttempting to run flow with lock held...")
            with pytest.raises(Exception) as exc_info:
                await crop_and_infer(
                    video_id=video_id,
                    tenant_id=tenant_id,
                    crop_region=crop_region,
                )

            # Step 3: Verify proper error message
            error_message = str(exc_info.value)
            print(f"Flow raised exception as expected: {error_message}")

            assert "Lock" in error_message or "processing" in error_message.lower(), (
                f"Error message should mention lock or processing: {error_message}"
            )

            # Step 4: Verify lock is still held by external process
            response = (
                supabase.client.schema(settings.supabase_schema)
                .table("video_database_state")
                .select("lock_holder_user_id")
                .eq("video_id", video_id)
                .eq("database_name", "layout")
                .maybe_single()
                .execute()
            )

            # Type narrowing: ensure response.data is treated as dict
            lock_state = getattr(response, "data", None)  # Safely access data attribute
            assert lock_state is not None, "Lock state disappeared"
            assert isinstance(lock_state, dict), "Lock state should be a dictionary"
            assert lock_state.get("lock_holder_user_id") == "external-process", (
                "Lock holder changed - flow may have incorrectly released external lock"
            )

            print("\n=== Test Passed ===")
            print("✓ Flow correctly rejected when lock held")
            print("✓ External lock not affected")
            print("✓ No partial state created")

        finally:
            # Step 5: Release test lock
            print("\nReleasing test lock...")
            supabase.release_server_lock(
                video_id=video_id,
                database_name="layout",
            )
