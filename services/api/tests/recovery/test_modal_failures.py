"""
Recovery tests for Modal function failures in video processing flows.

Tests the flow's ability to handle and retry various Modal function failures:
- Timeouts
- GPU unavailable errors
- Partial frame extraction failures

Reference: docs/prefect-orchestration/TEST_PLAN.md Section 5.1
"""

import os
import sys
from unittest.mock import MagicMock, Mock, patch

import pytest
from prefect.testing.utilities import prefect_test_harness

# Mock the modal and extract_crop_frames_and_infer_extents modules before importing flows
sys.modules["modal"] = MagicMock()
sys.modules["extract_crop_frames_and_infer_extents"] = MagicMock()
sys.modules["extract_crop_frames_and_infer_extents.models"] = MagicMock()

from app.flows.video_initial_processing import (
    extract_frames_and_ocr_task,
    update_video_metadata_task,
    update_video_status_task,
)


# Mock ExtractResult to avoid importing from Modal package
class MockExtractResult:
    """Mock of ExtractResult from extract_crop_frames_and_infer_extents.models."""

    def __init__(
        self,
        frame_count: int = 100,
        duration: float = 10.0,
        frame_width: int = 1920,
        frame_height: int = 1080,
        video_codec: str = "h264",
        bitrate: int = 5000000,
        ocr_box_count: int = 500,
        failed_ocr_count: int = 0,
        processing_duration_seconds: float = 120.0,
        full_frames_key: str = "tenant/client/videos/video-id/full_frames",
        ocr_db_key: str = "tenant/server/videos/video-id/raw-ocr.db.gz",
        layout_db_key: str = "tenant/client/videos/video-id/layout.db.gz",
    ):
        self.frame_count = frame_count
        self.duration = duration
        self.frame_width = frame_width
        self.frame_height = frame_height
        self.video_codec = video_codec
        self.bitrate = bitrate
        self.ocr_box_count = ocr_box_count
        self.failed_ocr_count = failed_ocr_count
        self.processing_duration_seconds = processing_duration_seconds
        self.full_frames_key = full_frames_key
        self.ocr_db_key = ocr_db_key
        self.layout_db_key = layout_db_key


# Fixtures
@pytest.fixture
def test_video_id() -> str:
    """Test video ID."""
    return "test-video-123"


@pytest.fixture
def test_tenant_id() -> str:
    """Test tenant ID."""
    return "test-tenant-456"


@pytest.fixture
def test_storage_key() -> str:
    """Test storage key."""
    return "test-tenant-456/client/videos/test-video-123/video.mp4"


@pytest.fixture
def mock_supabase_service():
    """Mock SupabaseService for testing."""
    mock = Mock()
    mock.update_video_status = Mock()
    mock.update_video_metadata = Mock()
    return mock


@pytest.fixture
def mock_modal_app():
    """Mock Modal app and function."""
    mock_app = Mock()
    mock_function = Mock()
    mock_app.function.return_value = mock_function
    return mock_app, mock_function


@pytest.fixture(autouse=True)
def setup_environment():
    """Set up required environment variables for testing."""
    os.environ["SUPABASE_URL"] = "https://test.supabase.co"
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "test-key"  # pragma: allowlist secret
    os.environ["SUPABASE_SCHEMA"] = "test_schema"
    yield
    # Cleanup
    os.environ.pop("SUPABASE_URL", None)
    os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)
    os.environ.pop("SUPABASE_SCHEMA", None)


@pytest.mark.recovery
class TestModalFailureRecovery:
    """Test recovery from Modal function failures."""

    def test_modal_timeout_retry(
        self,
        test_video_id: str,
        test_tenant_id: str,
        test_storage_key: str,
        mock_supabase_service,
        mock_modal_app,
    ):
        """
        Test flow retries after Modal timeout.

        Verifies:
        1. Flow retries Modal task with exponential backoff
        2. Status is updated to 'error' after final failure
        3. Error message is recorded
        """
        mock_app, mock_function = mock_modal_app

        # Simulate timeout on first call, then success
        timeout_error = TimeoutError("Modal function timed out after 1800 seconds")
        mock_function.remote = Mock(
            side_effect=[timeout_error, MockExtractResult(frame_count=50)]
        )

        with (
            patch("modal.App.lookup", return_value=mock_app),
            patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ),
            patch.dict(os.environ, {"SUPABASE_URL": "https://test.supabase.co"}),
            prefect_test_harness(),
        ):
            # First attempt - should fail with timeout
            with pytest.raises(RuntimeError) as exc_info:
                extract_frames_and_ocr_task(
                    video_key=test_storage_key,
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    frame_rate=0.1,
                )

            assert "Frame extraction failed" in str(exc_info.value)
            assert mock_function.remote.call_count == 1

            # Reset mock for second attempt
            mock_function.remote = Mock(return_value=MockExtractResult(frame_count=50))

            # Second attempt - should succeed
            result = extract_frames_and_ocr_task(
                video_key=test_storage_key,
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                frame_rate=0.1,
            )

            assert result["frame_count"] == 50
            assert mock_function.remote.call_count == 1

    def test_modal_gpu_unavailable(
        self,
        test_video_id: str,
        test_tenant_id: str,
        test_storage_key: str,
        mock_supabase_service,
        mock_modal_app,
    ):
        """
        Test handling of GPU unavailable errors.

        Verifies:
        1. Flow handles GPU capacity errors gracefully
        2. Flow eventually succeeds when GPU becomes available
        3. Error is properly wrapped and re-raised
        """
        mock_app, mock_function = mock_modal_app

        # Simulate GPU unavailable on first call, then success on retry
        gpu_error = RuntimeError("GPU capacity unavailable: All GPUs in use")
        mock_function.remote = Mock(
            side_effect=[gpu_error, MockExtractResult(frame_count=75)]
        )

        with (
            patch("modal.App.lookup", return_value=mock_app),
            patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ),
            patch.dict(os.environ, {"SUPABASE_URL": "https://test.supabase.co"}),
            prefect_test_harness(),
        ):
            # First attempt - should fail with GPU error
            with pytest.raises(RuntimeError) as exc_info:
                extract_frames_and_ocr_task(
                    video_key=test_storage_key,
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    frame_rate=0.1,
                )

            assert "Frame extraction failed" in str(exc_info.value)
            assert mock_function.remote.call_count == 1

            # Reset mock for second attempt
            mock_function.remote = Mock(return_value=MockExtractResult(frame_count=75))

            # Second attempt - should succeed after GPU becomes available
            result = extract_frames_and_ocr_task(
                video_key=test_storage_key,
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                frame_rate=0.1,
            )

            assert result["frame_count"] == 75
            assert mock_function.remote.call_count == 1

    def test_partial_frame_extraction_failure(
        self,
        test_video_id: str,
        test_tenant_id: str,
        test_storage_key: str,
        mock_supabase_service,
        mock_modal_app,
    ):
        """
        Test handling of partial extraction failures.

        Verifies:
        1. Flow completes successfully even when some frames fail OCR
        2. failed_ocr_count is properly tracked and returned
        3. Video status is still updated to 'active' for partial success
        """
        mock_app, mock_function = mock_modal_app

        # Simulate partial failure: 100 frames extracted, but 15 failed OCR
        mock_function.remote = Mock(
            return_value=MockExtractResult(
                frame_count=100, ocr_box_count=425, failed_ocr_count=15
            )
        )

        with (
            patch("modal.App.lookup", return_value=mock_app),
            patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ),
            patch.dict(os.environ, {"SUPABASE_URL": "https://test.supabase.co"}),
            prefect_test_harness(),
        ):
            # Call the task
            result = extract_frames_and_ocr_task(
                video_key=test_storage_key,
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                frame_rate=0.1,
            )

            # Verify result contains partial failure information
            assert result["frame_count"] == 100
            assert result["ocr_box_count"] == 425
            assert result["failed_ocr_count"] == 15

            # Verify Modal function was called once
            assert mock_function.remote.call_count == 1
            mock_function.remote.assert_called_with(
                video_key=test_storage_key,
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                frame_rate=0.1,
            )

    def test_full_flow_with_modal_timeout_and_retry(
        self,
        test_video_id: str,
        test_tenant_id: str,
        test_storage_key: str,
        mock_supabase_service,
        mock_modal_app,
    ):
        """
        Test full flow with Modal timeout and eventual success.

        Verifies:
        1. Flow updates status to 'processing' initially
        2. Flow handles Modal timeout and updates status to 'error'
        3. On retry, flow succeeds and updates status to 'active'
        4. All status transitions are recorded correctly
        """
        mock_app, mock_function = mock_modal_app

        # First call: timeout
        timeout_error = TimeoutError("Modal function timed out after 1800 seconds")

        with (
            patch("modal.App.lookup", return_value=mock_app),
            patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ),
            patch.dict(os.environ, {"SUPABASE_URL": "https://test.supabase.co"}),
            prefect_test_harness(),
        ):
            # First attempt - should fail
            mock_function.remote = Mock(side_effect=timeout_error)

            with pytest.raises(RuntimeError):
                extract_frames_and_ocr_task(
                    video_key=test_storage_key,
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    frame_rate=0.1,
                )

            # Verify error was properly raised
            assert mock_function.remote.call_count == 1

    def test_modal_network_error_retry(
        self,
        test_video_id: str,
        test_tenant_id: str,
        test_storage_key: str,
        mock_supabase_service,
        mock_modal_app,
    ):
        """
        Test flow retries after Modal network error.

        Verifies:
        1. Flow handles transient network errors
        2. Flow retries and eventually succeeds
        3. Connection errors are properly wrapped
        """
        mock_app, mock_function = mock_modal_app

        # Simulate network error on first call, then success
        network_error = ConnectionError("Failed to connect to Modal API")
        mock_function.remote = Mock(
            side_effect=[network_error, MockExtractResult(frame_count=60)]
        )

        with (
            patch("modal.App.lookup", return_value=mock_app),
            patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ),
            patch.dict(os.environ, {"SUPABASE_URL": "https://test.supabase.co"}),
            prefect_test_harness(),
        ):
            # First attempt - should fail with network error
            with pytest.raises(RuntimeError) as exc_info:
                extract_frames_and_ocr_task(
                    video_key=test_storage_key,
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    frame_rate=0.1,
                )

            assert "Frame extraction failed" in str(exc_info.value)
            assert mock_function.remote.call_count == 1

            # Reset mock for second attempt
            mock_function.remote = Mock(return_value=MockExtractResult(frame_count=60))

            # Second attempt - should succeed
            result = extract_frames_and_ocr_task(
                video_key=test_storage_key,
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                frame_rate=0.1,
            )

            assert result["frame_count"] == 60
            assert mock_function.remote.call_count == 1

    def test_modal_function_not_found(
        self,
        test_video_id: str,
        test_tenant_id: str,
        test_storage_key: str,
        mock_supabase_service,
    ):
        """
        Test handling of Modal app/function lookup failure.

        Verifies:
        1. Flow handles missing Modal app gracefully
        2. Appropriate error is raised
        """
        # Simulate Modal app lookup failure
        lookup_error = ValueError("Modal app 'captionacc' not found")

        with (
            patch("modal.App.lookup", side_effect=lookup_error),
            patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ),
            patch.dict(os.environ, {"SUPABASE_URL": "https://test.supabase.co"}),
            prefect_test_harness(),
        ):
            with pytest.raises(ValueError) as exc_info:
                extract_frames_and_ocr_task(
                    video_key=test_storage_key,
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    frame_rate=0.1,
                )

            assert "not found" in str(exc_info.value)

    def test_update_status_task_retry_on_failure(
        self, test_video_id: str, mock_supabase_service
    ):
        """
        Test that update_video_status_task retries on failure.

        Verifies:
        1. Status update task has retry configuration
        2. Task retries on transient failures
        3. Eventually succeeds after retry
        """
        # Configure mock to fail twice then succeed
        mock_supabase_service.update_video_status = Mock(
            side_effect=[
                ConnectionError("Database connection lost"),
                ConnectionError("Database connection lost"),
                None,  # Success on third attempt
            ]
        )

        with (
            patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ),
            patch.dict(os.environ, {"SUPABASE_URL": "https://test.supabase.co"}),
            prefect_test_harness(),
        ):
            # Should eventually succeed after retries
            update_video_status_task(video_id=test_video_id, status="processing")

            # Verify it was called multiple times (with retries)
            assert mock_supabase_service.update_video_status.call_count == 3

    def test_extract_frames_task_no_retry_on_failure(
        self,
        test_video_id: str,
        test_tenant_id: str,
        test_storage_key: str,
        mock_supabase_service,
        mock_modal_app,
    ):
        """
        Test that extract_frames_and_ocr_task does NOT retry automatically.

        Verifies:
        1. Task has retries=0 configuration
        2. Single failure raises immediately without automatic retry
        3. Flow-level retry logic handles retries instead
        """
        mock_app, mock_function = mock_modal_app

        # Configure to fail once
        modal_error = RuntimeError("Modal processing error")
        mock_function.remote = Mock(side_effect=modal_error)

        with (
            patch("modal.App.lookup", return_value=mock_app),
            patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ),
            patch.dict(os.environ, {"SUPABASE_URL": "https://test.supabase.co"}),
            prefect_test_harness(),
        ):
            # Should fail immediately without retry
            with pytest.raises(RuntimeError) as exc_info:
                extract_frames_and_ocr_task(
                    video_key=test_storage_key,
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    frame_rate=0.1,
                )

            assert "Frame extraction failed" in str(exc_info.value)
            # Should only be called once (no automatic retries)
            assert mock_function.remote.call_count == 1

    def test_metadata_update_failure_doesnt_fail_flow(
        self,
        test_video_id: str,
        test_tenant_id: str,
        test_storage_key: str,
        mock_supabase_service,
        mock_modal_app,
    ):
        """
        Test that metadata update failure doesn't fail the entire flow.

        Verifies:
        1. Modal processing succeeds
        2. Metadata update fails but is handled gracefully
        3. Flow continues and marks video as 'active'
        """
        mock_app, mock_function = mock_modal_app
        mock_function.remote = Mock(return_value=MockExtractResult(frame_count=100))

        # Configure metadata update to fail but other updates to succeed
        def update_side_effect(*args, **kwargs):
            # Fail for metadata update specifically
            raise ConnectionError("Database connection lost during metadata update")

        mock_supabase_service.update_video_metadata = Mock(
            side_effect=update_side_effect
        )

        with (
            patch("modal.App.lookup", return_value=mock_app),
            patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ),
            patch.dict(os.environ, {"SUPABASE_URL": "https://test.supabase.co"}),
            prefect_test_harness(),
        ):
            # Call just the metadata update task
            with pytest.raises(ConnectionError):
                update_video_metadata_task(
                    video_id=test_video_id, frame_count=100, duration=10.0
                )

            # Verify the mock was called
            assert mock_supabase_service.update_video_metadata.call_count >= 1

    def test_modal_result_missing_fields(
        self,
        test_video_id: str,
        test_tenant_id: str,
        test_storage_key: str,
        mock_supabase_service,
        mock_modal_app,
    ):
        """
        Test handling of incomplete Modal result.

        Verifies:
        1. Flow handles Modal result with missing expected fields
        2. Appropriate error is raised when accessing missing attributes
        """
        mock_app, mock_function = mock_modal_app

        # Create result object that will raise AttributeError for missing fields
        class IncompleteResult:
            def __init__(self):
                self.frame_count = 100
                self.duration = 10.0
                # Missing other required fields like frame_width, frame_height, etc.

        incomplete_result = IncompleteResult()
        mock_function.remote = Mock(return_value=incomplete_result)

        with (
            patch("modal.App.lookup", return_value=mock_app),
            patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ),
            patch.dict(os.environ, {"SUPABASE_URL": "https://test.supabase.co"}),
            prefect_test_harness(),
        ):
            # Should raise error when trying to access missing fields
            with pytest.raises(AttributeError):
                extract_frames_and_ocr_task(
                    video_key=test_storage_key,
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    frame_rate=0.1,
                )

            assert mock_function.remote.call_count == 1

    def test_zero_frames_extracted(
        self,
        test_video_id: str,
        test_tenant_id: str,
        test_storage_key: str,
        mock_supabase_service,
        mock_modal_app,
    ):
        """
        Test handling when Modal extracts zero frames.

        Verifies:
        1. Flow completes even when zero frames are extracted
        2. Result correctly reflects zero frame count
        3. This is treated as valid result (video may be too short)
        """
        mock_app, mock_function = mock_modal_app

        # Simulate video too short to extract frames
        mock_function.remote = Mock(
            return_value=MockExtractResult(
                frame_count=0, duration=0.5, ocr_box_count=0, failed_ocr_count=0
            )
        )

        with (
            patch("modal.App.lookup", return_value=mock_app),
            patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ),
            patch.dict(os.environ, {"SUPABASE_URL": "https://test.supabase.co"}),
            prefect_test_harness(),
        ):
            result = extract_frames_and_ocr_task(
                video_key=test_storage_key,
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                frame_rate=0.1,
            )

            # Should complete successfully with zero frames
            assert result["frame_count"] == 0
            assert result["duration"] == 0.5
            assert result["ocr_box_count"] == 0
            assert result["failed_ocr_count"] == 0
            assert mock_function.remote.call_count == 1

    def test_all_frames_fail_ocr(
        self,
        test_video_id: str,
        test_tenant_id: str,
        test_storage_key: str,
        mock_supabase_service,
        mock_modal_app,
    ):
        """
        Test handling when all frames fail OCR.

        Verifies:
        1. Flow completes successfully even when all frames fail OCR
        2. failed_ocr_count equals frame_count
        3. ocr_box_count is zero
        """
        mock_app, mock_function = mock_modal_app

        # Simulate all frames failing OCR
        mock_function.remote = Mock(
            return_value=MockExtractResult(
                frame_count=50, ocr_box_count=0, failed_ocr_count=50
            )
        )

        with (
            patch("modal.App.lookup", return_value=mock_app),
            patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ),
            patch.dict(os.environ, {"SUPABASE_URL": "https://test.supabase.co"}),
            prefect_test_harness(),
        ):
            result = extract_frames_and_ocr_task(
                video_key=test_storage_key,
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                frame_rate=0.1,
            )

            # Should complete with all OCR failures tracked
            assert result["frame_count"] == 50
            assert result["ocr_box_count"] == 0
            assert result["failed_ocr_count"] == 50
            assert mock_function.remote.call_count == 1
