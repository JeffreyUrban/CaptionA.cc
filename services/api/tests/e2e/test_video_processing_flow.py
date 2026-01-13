"""
End-to-end test for video upload to processing flow.

Tests the complete integration of video processing with REAL services:
- Modal: Frame extraction and OCR
- Supabase: Database updates and metadata
- Wasabi: File storage and retrieval

This test validates OUR integration code, not the external services themselves.
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.utils.helpers import create_test_video, cleanup_test_video


@pytest.mark.e2e
@pytest.mark.slow
class TestVideoProcessingE2E:
    """End-to-end test for complete video processing flow."""

    @pytest.fixture
    async def test_video(self):
        """Create and upload test video to Wasabi."""
        from app.services.wasabi_service import WasabiServiceImpl

        # Create test video file
        video_file = create_test_video(
            duration=5,  # 5 second video
            fps=30,
            text_overlay="Test Caption E2E",
        )

        # Get settings for credentials
        from app.config import get_settings
        settings = get_settings()

        # Initialize Wasabi client with read-write credentials
        wasabi = WasabiServiceImpl(
            access_key=settings.effective_wasabi_access_key,
            secret_key=settings.effective_wasabi_secret_key,
            bucket=settings.wasabi_bucket,
            region=settings.wasabi_region,
        )

        # Generate unique identifiers for this test run using UUIDs
        import uuid
        tenant_id = str(uuid.uuid4())  # Real UUID for database compatibility
        video_id = str(uuid.uuid4())   # Real UUID for database compatibility
        storage_key = f"{tenant_id}/client/videos/{video_id}/video.mp4"

        # Initialize Supabase to create tenant record first
        from app.services.supabase_service import SupabaseServiceImpl
        supabase = SupabaseServiceImpl(
            supabase_url=settings.supabase_url,
            supabase_key=settings.supabase_service_role_key,
            schema=settings.supabase_schema,
        )

        # Create tenant record FIRST (required by foreign key constraint)
        try:
            supabase.client.schema(settings.supabase_schema).table("tenants").insert({
                "id": tenant_id,
                "name": f"Test Tenant {tenant_id[:8]}",
                "slug": f"test-tenant-{tenant_id[:8]}",
            }).execute()
            print(f"Created tenant record in Supabase (tenant_id: {tenant_id})")
        except Exception as e:
            cleanup_test_video(video_file)
            raise RuntimeError(f"Failed to create tenant record in Supabase: {e}") from e

        # Upload video to Wasabi
        try:
            with open(video_file, "rb") as f:
                wasabi.upload_file(
                    key=storage_key,
                    data=f,
                    content_type="video/mp4",
                )
        except Exception as e:
            # Clean up local file if upload fails
            cleanup_test_video(video_file)
            raise RuntimeError(f"Failed to upload test video to Wasabi: {e}") from e

        # Yield test data
        yield {
            "tenant_id": tenant_id,
            "video_id": video_id,
            "storage_key": storage_key,
            "video_file": video_file,
            "wasabi": wasabi,
        }

        # Cleanup: Delete all test files from Wasabi
        try:
            deleted_count = wasabi.delete_prefix(f"{tenant_id}/")
            print(f"Cleaned up {deleted_count} files from Wasabi (tenant: {tenant_id})")
        except Exception as e:
            print(f"Warning: Failed to clean up Wasabi files: {e}")

        # Cleanup: Delete local video file
        cleanup_test_video(video_file)

    @pytest.mark.asyncio
    async def test_full_video_processing_integration(self, test_video):
        """
        Test complete integration with all real services.

        This test:
        1. Triggers webhook to create flow run (tests webhook handler)
        2. Executes flow directly (tests flow logic with real Modal/Supabase/Wasabi)
        3. Verifies flow execution results
        4. Verifies Supabase was updated correctly
        5. Verifies files were created in Wasabi
        """
        from app.services.supabase_service import SupabaseServiceImpl
        from app.flows.video_initial_processing import video_initial_processing

        video_id = test_video["video_id"]
        tenant_id = test_video["tenant_id"]
        storage_key = test_video["storage_key"]
        wasabi = test_video["wasabi"]

        # Initialize Supabase client using settings
        from app.config import get_settings
        settings = get_settings()

        supabase = SupabaseServiceImpl(
            supabase_url=settings.supabase_url,
            supabase_key=settings.supabase_service_role_key,
            schema=settings.supabase_schema,
        )

        # Step 1: Create video record in Supabase with all required fields
        # This is normally done by the client during upload, but we do it here for testing
        # Required NOT NULL fields from actual schema: video_path, storage_key
        # Note: width/height documented but don't exist in production yet
        try:
            supabase.client.schema(supabase.schema).table("videos").insert(
                {
                    "id": video_id,
                    "tenant_id": tenant_id,
                    "video_path": f"test-videos/{video_id}.mp4",  # Required: user-facing path
                    "storage_key": storage_key,                     # Required: Wasabi key
                    "status": "uploading",
                    "uploaded_at": datetime.now(timezone.utc).isoformat(),
                    "size_bytes": test_video["video_file"].stat().st_size,
                }
            ).execute()
        except Exception as e:
            raise RuntimeError(f"Failed to create video record in Supabase: {e}") from e

        # Step 2: Test webhook trigger (tests our webhook handler)
        # This bypasses actual Supabase webhook but tests our endpoint logic
        app = create_app()
        client = TestClient(app)

        webhook_secret = settings.webhook_secret or "test-webhook-secret"
        webhook_response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": f"Bearer {webhook_secret}"},
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": video_id,
                    "tenant_id": tenant_id,
                    "storage_key": storage_key,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            },
        )

        # Verify webhook response
        assert webhook_response.status_code == 202, (
            f"Webhook failed with status {webhook_response.status_code}: "
            f"{webhook_response.text}"
        )
        webhook_data = webhook_response.json()
        assert webhook_data["success"] is True
        assert "flow_run_id" in webhook_data
        flow_run_id = webhook_data["flow_run_id"]
        print(f"Webhook triggered successfully, flow_run_id: {flow_run_id}")

        # Step 3: Execute flow directly (tests our flow logic)
        # This bypasses Prefect scheduling to focus on OUR code
        # Uses real Modal, Supabase, and Wasabi services
        print(f"Executing video_initial_processing flow for video {video_id}...")
        try:
            result = await video_initial_processing(
                video_id=video_id,
                tenant_id=tenant_id,
                storage_key=storage_key,
            )
        except Exception as e:
            raise RuntimeError(
                f"Flow execution failed for video {video_id}: {e}"
            ) from e

        # Step 4: Verify results from our flow execution
        print(f"Flow result: {result}")
        assert result["video_id"] == video_id
        assert result["frame_count"] > 0, "Frame count should be greater than 0"
        assert result["duration"] > 0, "Duration should be greater than 0"

        # For a 5-second video at 0.1 fps (1 frame per 10 seconds), we should get 1 frame
        # Allow some tolerance for edge cases
        expected_frames = 1  # 5 seconds / 10 seconds per frame = 0.5, rounds to 1
        assert result["frame_count"] >= expected_frames, (
            f"Expected at least {expected_frames} frames for 5-second video at 0.1 fps, "
            f"got {result['frame_count']}"
        )

        # Step 5: Verify Supabase was updated by our flow
        print(f"Verifying Supabase updates for video {video_id}...")
        video_meta = supabase.get_video_metadata(video_id)

        assert video_meta is not None, "Video metadata should exist in Supabase"
        assert video_meta["status"] == "active", (
            f"Video status should be 'active', got '{video_meta['status']}'"
        )
        assert video_meta["duration_seconds"] is not None, "Duration should be set"
        assert video_meta["duration_seconds"] > 0, "Duration should be positive"
        assert abs(video_meta["duration_seconds"] - result["duration"]) < 0.1, (
            f"Duration mismatch: Supabase has {video_meta['duration_seconds']}, "
            f"flow returned {result['duration']}"
        )

        # Step 6: Verify files were created in Wasabi by Modal function
        print(f"Verifying Wasabi files for video {video_id}...")

        # Check full frames directory
        full_frames_prefix = f"{tenant_id}/client/videos/{video_id}/full_frames/"
        frames = wasabi.list_files(prefix=full_frames_prefix)
        assert len(frames) > 0, (
            f"No full frames found at {full_frames_prefix}. "
            f"Expected at least {expected_frames} frame(s)."
        )
        print(f"Found {len(frames)} full frame files")

        # Check raw OCR database
        raw_ocr_key = f"{tenant_id}/server/videos/{video_id}/raw-ocr.db.gz"
        assert wasabi.file_exists(raw_ocr_key), (
            f"Raw OCR database not found at {raw_ocr_key}"
        )
        print(f"Verified raw-ocr.db.gz exists")

        # Check layout database
        layout_db_key = f"{tenant_id}/client/videos/{video_id}/layout.db.gz"
        assert wasabi.file_exists(layout_db_key), (
            f"Layout database not found at {layout_db_key}"
        )
        print(f"Verified layout.db.gz exists")

        # Step 7: Cleanup - Delete video record from Supabase
        try:
            supabase.client.schema(supabase.schema).table("videos").delete().eq(
                "id", video_id
            ).execute()
            print(f"Cleaned up video record from Supabase (video_id: {video_id})")
        except Exception as e:
            print(f"Warning: Failed to clean up video record: {e}")

        # Cleanup - Delete tenant record from Supabase (must be last due to foreign keys)
        try:
            supabase.client.schema(supabase.schema).table("tenants").delete().eq(
                "id", tenant_id
            ).execute()
            print(f"Cleaned up tenant record from Supabase (tenant_id: {tenant_id})")
        except Exception as e:
            print(f"Warning: Failed to clean up tenant record: {e}")

        print(f"✓ E2E test passed for video {video_id}")
