"""
Integration tests for video initial processing flow.

Tests the Prefect flow orchestration logic for video processing:
- Frame extraction via Modal
- Status updates via Supabase
- Metadata updates
- Error handling and recovery

These tests mock external services (Modal, Supabase) to test flow logic,
not the external services themselves.
"""

import os
import sys
import pytest
from unittest.mock import Mock, patch, MagicMock
from prefect.testing.utilities import prefect_test_harness

# Mock modal and extract_crop_frames_and_infer_extents before importing flows (not installed in test environment)
sys.modules["modal"] = MagicMock()
sys.modules["extract_crop_frames_and_infer_extents"] = MagicMock()
sys.modules["extract_crop_frames_and_infer_extents.models"] = MagicMock()

from app.flows.video_initial_processing import video_initial_processing


@pytest.fixture(scope="class")
def prefect_test_env():
    """Set up Prefect test harness for all tests."""
    with prefect_test_harness():
        yield


@pytest.mark.integration
@pytest.mark.usefixtures("prefect_test_env")
class TestVideoInitialProcessingFlow:
    """Integration tests for video initial processing flow."""

    @pytest.fixture
    def mock_services(self):
        """Mock all external services."""
        # Set required environment variables for the flow
        env_vars = {
            "SUPABASE_URL": "http://test-supabase.com",
            "SUPABASE_SERVICE_ROLE_KEY": "test-key",
            "SUPABASE_SCHEMA": "test_schema",
        }

        with patch.dict(os.environ, env_vars):
            # Patch SupabaseServiceImpl at module level
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl"
            ) as mock_supabase_cls:
                # Create mock Supabase service instance
                supabase = Mock()
                supabase.update_video_status = Mock()
                supabase.update_video_metadata = Mock()
                mock_supabase_cls.return_value = supabase

                # Mock Modal extraction result
                extract_result = Mock(
                    frame_count=100,
                    duration=10.0,
                    frame_width=1920,
                    frame_height=1080,
                    video_codec="h264",
                    bitrate=5000000,
                    ocr_box_count=50,
                    failed_ocr_count=0,
                    processing_duration_seconds=45.0,
                    full_frames_key="tenant/client/videos/video-1/full_frames/",
                    ocr_db_key="tenant/server/videos/video-1/raw-ocr.db.gz",  # pragma: allowlist secret
                    layout_db_key="tenant/server/videos/video-1/layout.db.gz",  # pragma: allowlist secret
                )

                # Configure the global modal mock (sys.modules['modal'])
                # This ensures when tasks import modal, they get our configured mock
                import modal

                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=extract_result)
                mock_app.function = Mock(return_value=mock_function)

                # Configure the modal.App.lookup to return our mock app
                # This must be set on the sys.modules['modal'] object itself
                modal.App = Mock()
                modal.App.lookup = Mock(return_value=mock_app)

                yield {
                    "supabase": supabase,
                    "supabase_class": mock_supabase_cls,
                    "modal": modal,
                    "modal_app": mock_app,
                    "modal_function": mock_function,
                    "extract_result": extract_result,
                }

    @pytest.mark.asyncio
    async def test_flow_success(self, mock_services):
        """Test successful flow execution with proper status transitions."""
        # Execute the flow
        result = await video_initial_processing(
            video_id="video-123",
            tenant_id="tenant-456",
            storage_key="tenant-456/client/videos/video-123/video.mp4",
        )

        # Verify flow completed successfully
        assert result["video_id"] == "video-123"
        assert result["frame_count"] == 100
        assert result["duration"] == 10.0

        # Verify Supabase service was initialized correctly
        supabase_class = mock_services["supabase_class"]
        assert supabase_class.called
        # Check that SupabaseServiceImpl was instantiated at least once
        assert supabase_class.call_count >= 1

        # Verify status updates were called
        supabase = mock_services["supabase"]
        assert supabase.update_video_status.call_count == 2

        # First call: set to processing
        first_call = supabase.update_video_status.call_args_list[0]
        assert first_call[1]["video_id"] == "video-123"
        assert first_call[1]["status"] == "processing"

        # Second call: set to active
        second_call = supabase.update_video_status.call_args_list[1]
        assert second_call[1]["video_id"] == "video-123"
        assert second_call[1]["status"] == "active"

        # Verify Modal function was called correctly
        modal_function = mock_services["modal_function"]
        assert modal_function.remote.called
        modal_call = modal_function.remote.call_args
        assert (
            modal_call[1]["video_key"] == "tenant-456/client/videos/video-123/video.mp4"
        )
        assert modal_call[1]["tenant_id"] == "tenant-456"
        assert modal_call[1]["video_id"] == "video-123"
        assert modal_call[1]["frame_rate"] == 0.1

        # Verify metadata update was called
        assert supabase.update_video_metadata.called
        metadata_call = supabase.update_video_metadata.call_args
        assert metadata_call[1]["video_id"] == "video-123"
        assert metadata_call[1]["frame_count"] == 100
        assert metadata_call[1]["duration_seconds"] == 10.0

    @pytest.mark.asyncio
    async def test_flow_handles_modal_failure(self, mock_services):
        """Test flow handles Modal function failure with proper error handling."""
        # Mock Modal failure
        mock_services["modal_function"].remote.side_effect = Exception(
            "Modal function failed: GPU timeout"
        )

        # Execute the flow and expect it to raise
        with pytest.raises(RuntimeError) as exc_info:
            await video_initial_processing(
                video_id="video-123",
                tenant_id="tenant-456",
                storage_key="tenant-456/client/videos/video-123/video.mp4",
            )

        # Verify error message
        assert "Frame extraction failed" in str(exc_info.value)
        assert "GPU timeout" in str(exc_info.value)

        # Verify status updates
        supabase = mock_services["supabase"]
        status_calls = supabase.update_video_status.call_args_list

        # Should have at least 2 calls: processing and error
        assert len(status_calls) >= 2

        # First call: set to processing
        first_call = status_calls[0]
        assert first_call[1]["status"] == "processing"

        # Last call should be error status
        error_calls = [
            call for call in status_calls if call[1].get("status") == "error"
        ]
        assert len(error_calls) > 0
        error_call = error_calls[0]
        assert error_call[1]["video_id"] == "video-123"
        assert error_call[1]["status"] == "error"
        assert "Frame extraction failed" in error_call[1]["error_message"]

    @pytest.mark.asyncio
    async def test_flow_handles_supabase_failure(self, mock_services):
        """Test flow handles Supabase metadata update failure gracefully."""
        # Mock Supabase metadata update failure
        mock_services["supabase"].update_video_metadata.side_effect = Exception(
            "Database connection failed"
        )

        # Execute the flow - metadata failure should not prevent completion
        # The flow logs the error but continues to set status to 'active'
        result = await video_initial_processing(
            video_id="video-123",
            tenant_id="tenant-456",
            storage_key="tenant-456/client/videos/video-123/video.mp4",
        )

        # Verify flow completed successfully despite metadata update failure
        assert result["video_id"] == "video-123"
        assert result["frame_count"] == 100
        assert result["duration"] == 10.0

        # Verify Modal function was called (processing started)
        modal_function = mock_services["modal_function"]
        assert modal_function.remote.called

        # Verify update_video_metadata was attempted
        supabase = mock_services["supabase"]
        assert supabase.update_video_metadata.called

        # Verify final status was still set to 'active' (graceful handling)
        status_calls = supabase.update_video_status.call_args_list
        final_status = status_calls[-1][1]["status"]
        assert final_status == "active"

    @pytest.mark.asyncio
    async def test_flow_handles_initial_status_update_failure(self, mock_services):
        """Test flow handles failure in initial status update."""
        # Mock failure on first status update
        mock_services["supabase"].update_video_status.side_effect = Exception(
            "Failed to connect to Supabase"
        )

        # Execute the flow and expect it to fail fast
        with pytest.raises(Exception) as exc_info:
            await video_initial_processing(
                video_id="video-123",
                tenant_id="tenant-456",
                storage_key="tenant-456/client/videos/video-123/video.mp4",
            )

        # Verify error message
        assert "Failed to connect to Supabase" in str(exc_info.value)

        # Verify Modal function was NOT called (flow failed before processing)
        modal_function = mock_services["modal_function"]
        assert not modal_function.remote.called

    @pytest.mark.asyncio
    async def test_flow_modal_extraction_details(self, mock_services):
        """Test that flow correctly captures all Modal extraction details."""
        # Execute the flow
        result = await video_initial_processing(
            video_id="video-123",
            tenant_id="tenant-456",
            storage_key="tenant-456/client/videos/video-123/video.mp4",
        )

        # Verify Modal function returns expected result structure
        modal_function = mock_services["modal_function"]
        assert modal_function.remote.called

        # Verify result contains all expected fields
        assert "video_id" in result
        assert "frame_count" in result
        assert "duration" in result

        # Verify metadata update received correct values from Modal result
        supabase = mock_services["supabase"]
        metadata_call = supabase.update_video_metadata.call_args

        # Values should match the mock extract_result
        assert metadata_call[1]["frame_count"] == 100
        assert metadata_call[1]["duration_seconds"] == 10.0

    @pytest.mark.asyncio
    async def test_flow_with_different_video_parameters(self, mock_services):
        """Test flow with different video IDs and storage keys."""
        # Test with different parameters
        result = await video_initial_processing(
            video_id="different-video-789",
            tenant_id="different-tenant-999",
            storage_key="different-tenant-999/client/videos/different-video-789/upload.mp4",
        )

        # Verify the flow used the correct parameters
        supabase = mock_services["supabase"]

        # Check status updates used correct video_id
        first_status_call = supabase.update_video_status.call_args_list[0]
        assert first_status_call[1]["video_id"] == "different-video-789"

        # Check Modal was called with correct parameters
        modal_function = mock_services["modal_function"]
        modal_call = modal_function.remote.call_args
        assert modal_call[1]["video_id"] == "different-video-789"
        assert modal_call[1]["tenant_id"] == "different-tenant-999"
        assert (
            modal_call[1]["video_key"]
            == "different-tenant-999/client/videos/different-video-789/upload.mp4"
        )

        # Verify result
        assert result["video_id"] == "different-video-789"

    @pytest.mark.asyncio
    async def test_flow_metadata_update_failure_does_not_block_completion(
        self, mock_services
    ):
        """Test that metadata update failure logs error but allows flow completion."""
        # Mock metadata update to fail
        mock_services["supabase"].update_video_metadata.side_effect = Exception(
            "Metadata table locked"
        )

        # The flow should handle metadata failure gracefully and still complete
        result = await video_initial_processing(
            video_id="video-123",
            tenant_id="tenant-456",
            storage_key="tenant-456/client/videos/video-123/video.mp4",
        )

        # Verify flow completed successfully
        assert result["video_id"] == "video-123"

        # Verify Modal processing completed
        modal_function = mock_services["modal_function"]
        assert modal_function.remote.called

        # Verify metadata update was attempted
        supabase = mock_services["supabase"]
        assert supabase.update_video_metadata.called

        # Verify final status was set to 'active' despite metadata failure
        status_calls = supabase.update_video_status.call_args_list
        final_status = status_calls[-1][1]["status"]
        assert final_status == "active"

    @pytest.mark.asyncio
    async def test_flow_status_transitions_in_correct_order(self, mock_services):
        """Test that status transitions occur in the correct order."""
        # Execute the flow
        await video_initial_processing(
            video_id="video-123",
            tenant_id="tenant-456",
            storage_key="tenant-456/client/videos/video-123/video.mp4",
        )

        # Verify status update call order
        supabase = mock_services["supabase"]
        status_calls = supabase.update_video_status.call_args_list

        # Should have exactly 2 status calls
        assert len(status_calls) == 2

        # Order should be: processing -> active
        assert status_calls[0][1]["status"] == "processing"
        assert status_calls[1][1]["status"] == "active"

        # Both should be for the same video
        assert status_calls[0][1]["video_id"] == "video-123"
        assert status_calls[1][1]["video_id"] == "video-123"

    @pytest.mark.asyncio
    async def test_flow_with_zero_frames_extracted(self, mock_services):
        """Test flow behavior when Modal extracts zero frames (edge case)."""
        # Mock Modal to return zero frames
        mock_services["extract_result"].frame_count = 0
        mock_services["extract_result"].duration = 0.0

        # Execute the flow
        result = await video_initial_processing(
            video_id="video-123",
            tenant_id="tenant-456",
            storage_key="tenant-456/client/videos/video-123/video.mp4",
        )

        # Verify result reflects zero frames
        assert result["frame_count"] == 0
        assert result["duration"] == 0.0

        # Verify metadata update received zero values
        supabase = mock_services["supabase"]
        metadata_call = supabase.update_video_metadata.call_args
        assert metadata_call[1]["frame_count"] == 0
        assert metadata_call[1]["duration_seconds"] == 0.0

        # Flow should still complete successfully
        assert result["video_id"] == "video-123"
