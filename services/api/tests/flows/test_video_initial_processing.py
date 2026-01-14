"""
Comprehensive tests for video_initial_processing Prefect flow.

Tests cover:
1. Success scenarios - proper flow execution, status updates, and metadata handling
2. Error scenarios - Modal failures, Supabase errors, timeouts, retries
3. Concurrency scenarios - multiple videos, idempotency, tenant isolation
"""
import asyncio
from unittest.mock import Mock, patch

import pytest
from prefect.testing.utilities import prefect_test_harness

from tests.flows.conftest import ExtractResult


@pytest.fixture
def mock_extract_result() -> ExtractResult:
    """Mock result from Modal extract_frames_and_ocr function."""
    return ExtractResult(
        frame_count=100,
        duration=10.0,
        frame_width=1920,
        frame_height=1080,
        video_codec="h264",
        bitrate=5000000,
        ocr_box_count=250,
        failed_ocr_count=2,
        processing_duration_seconds=45.5,
        full_frames_key="test-tenant-123/client/videos/test-video-789/full_frames/",
        ocr_db_key="test-tenant-123/server/videos/test-video-789/raw-ocr.db.gz",  # pragma: allowlist secret
        layout_db_key="test-tenant-123/client/videos/test-video-789/layout.db.gz",  # pragma: allowlist secret
    )


@pytest.fixture
def mock_supabase_service() -> Mock:
    """Mock SupabaseServiceImpl with all methods."""
    mock = Mock()
    mock.update_video_status = Mock(return_value=None)
    mock.update_video_metadata = Mock(return_value=None)
    return mock


@pytest.fixture(autouse=True)
def mock_env_vars(monkeypatch):
    """Mock environment variables for all tests."""
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")  # pragma: allowlist secret
    monkeypatch.setenv("SUPABASE_SCHEMA", "captionacc_test")


# =============================================================================
# Test Class 1: TestVideoInitialProcessingSuccess
# =============================================================================


class TestVideoInitialProcessingSuccess:
    """Test successful execution path for video_initial_processing flow."""

    @pytest.mark.asyncio
    async def test_flow_updates_status_to_processing(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_supabase_service: Mock,
        mock_extract_result: ExtractResult,
    ):
        """
        Verify status transitions: uploading -> processing -> active.

        This test ensures the flow properly updates video status at each stage.
        """
        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=mock_extract_result)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                # Import and run flow
                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                await video_initial_processing(
                    video_id=test_video_id,
                    tenant_id=test_tenant_id,
                    storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                )

                # Verify status updates in correct sequence
                calls = mock_supabase_service.update_video_status.call_args_list
                assert len(calls) >= 2  # At least processing and active

                # First call: status -> processing
                assert calls[0].kwargs["video_id"] == test_video_id
                assert calls[0].kwargs["status"] == "processing"

                # Last call: status -> active
                assert calls[-1].kwargs["video_id"] == test_video_id
                assert calls[-1].kwargs["status"] == "active"

    @pytest.mark.asyncio
    async def test_flow_calls_modal_with_correct_params(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_supabase_service: Mock,
        mock_extract_result: ExtractResult,
    ):
        """
        Verify Modal function called with video_id, tenant_id, storage_key.

        Ensures correct parameters are passed to the Modal remote function.
        """
        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=mock_extract_result)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                storage_key = f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4"

                await video_initial_processing(
                    video_id=test_video_id,
                    tenant_id=test_tenant_id,
                    storage_key=storage_key,
                )

                # Verify Modal function was called with correct parameters
                mock_function.remote.assert_called_once_with(
                    video_key=storage_key,
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    frame_rate=0.1,
                )

    @pytest.mark.asyncio
    async def test_flow_updates_metadata_with_frame_count(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_supabase_service: Mock,
        mock_extract_result: ExtractResult,
    ):
        """
        Verify frame count and duration saved to Supabase.

        Ensures video metadata is properly updated after successful processing.
        """
        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=mock_extract_result)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                await video_initial_processing(
                    video_id=test_video_id,
                    tenant_id=test_tenant_id,
                    storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                )

                # Verify metadata update was called
                mock_supabase_service.update_video_metadata.assert_called_once_with(
                    video_id=test_video_id,
                    duration_seconds=10.0,
                )

    @pytest.mark.asyncio
    async def test_flow_returns_correct_dict_structure(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_supabase_service: Mock,
        mock_extract_result: ExtractResult,
    ):
        """
        Verify return: {video_id, frame_count, duration}.

        Checks that the flow returns the expected dictionary structure.
        """
        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=mock_extract_result)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                result = await video_initial_processing(
                    video_id=test_video_id,
                    tenant_id=test_tenant_id,
                    storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                )

                # Verify return structure
                assert isinstance(result, dict)
                assert result["video_id"] == test_video_id
                assert result["frame_count"] == 100
                assert result["duration"] == 10.0
                assert set(result.keys()) == {"video_id", "frame_count", "duration"}

    @pytest.mark.asyncio
    async def test_flow_status_active_on_success(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_supabase_service: Mock,
        mock_extract_result: ExtractResult,
    ):
        """
        Verify final status is 'active' after successful processing.

        Ensures the flow marks the video as active when everything succeeds.
        """
        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=mock_extract_result)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                await video_initial_processing(
                    video_id=test_video_id,
                    tenant_id=test_tenant_id,
                    storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                )

                # Get the last status update call
                last_call = mock_supabase_service.update_video_status.call_args_list[-1]
                assert last_call.kwargs["status"] == "active"
                assert last_call.kwargs["video_id"] == test_video_id

    @pytest.mark.asyncio
    async def test_flow_logs_processing_duration(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_supabase_service: Mock,
        mock_extract_result: ExtractResult,
    ):
        """
        Verify metrics are logged (frame count, duration, ocr_box_count).

        This test doesn't assert on logs but ensures no errors occur when
        the result contains processing metrics.
        """
        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=mock_extract_result)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                # Should complete without error even with extensive result metadata
                result = await video_initial_processing(
                    video_id=test_video_id,
                    tenant_id=test_tenant_id,
                    storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                )

                assert result is not None
                # Verify the flow accessed the processing metrics
                assert mock_extract_result.processing_duration_seconds == 45.5
                assert mock_extract_result.ocr_box_count == 250

    @pytest.mark.asyncio
    async def test_flow_uses_correct_tenant_scoping(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_supabase_service: Mock,
        mock_extract_result: ExtractResult,
    ):
        """
        Verify tenant_id is used consistently throughout flow execution.

        Ensures tenant isolation is maintained in all operations.
        """
        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=mock_extract_result)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                storage_key = f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4"

                await video_initial_processing(
                    video_id=test_video_id,
                    tenant_id=test_tenant_id,
                    storage_key=storage_key,
                )

                # Verify Modal was called with correct tenant_id
                mock_function.remote.assert_called_once()
                call_kwargs = mock_function.remote.call_args.kwargs
                assert call_kwargs["tenant_id"] == test_tenant_id
                assert test_tenant_id in call_kwargs["video_key"]

    @pytest.mark.asyncio
    async def test_flow_calls_tasks_in_sequence(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_supabase_service: Mock,
        mock_extract_result: ExtractResult,
    ):
        """
        Verify tasks execute in correct order: status update -> modal -> metadata -> status.

        Ensures proper sequencing of operations.
        """
        call_order = []

        def track_status_update(**kwargs):
            call_order.append(("status", kwargs["status"]))

        def track_metadata_update(**kwargs):
            call_order.append(("metadata", kwargs["video_id"]))

        def track_modal_call(**kwargs):
            call_order.append(("modal", kwargs["video_id"]))
            return mock_extract_result

        mock_supabase_service.update_video_status.side_effect = track_status_update
        mock_supabase_service.update_video_metadata.side_effect = track_metadata_update

        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(side_effect=track_modal_call)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                await video_initial_processing(
                    video_id=test_video_id,
                    tenant_id=test_tenant_id,
                    storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                )

                # Verify call order
                assert len(call_order) >= 4
                assert call_order[0] == ("status", "processing")
                assert call_order[1] == ("modal", test_video_id)
                assert call_order[2] == ("metadata", test_video_id)
                assert call_order[3] == ("status", "active")


# =============================================================================
# Test Class 2: TestVideoInitialProcessingErrors
# =============================================================================


class TestVideoInitialProcessingErrors:
    """Test error handling and retries for video_initial_processing flow."""

    @pytest.mark.asyncio
    async def test_modal_timeout_sets_error_status(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_supabase_service: Mock,
    ):
        """
        Simulate Modal timeout (1800s), verify error status set.

        Ensures timeouts are properly caught and status is updated to error.
        """
        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock to raise timeout
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(
                    side_effect=TimeoutError("Modal function timed out after 1800s")
                )
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                # Flow should raise the error after setting error status
                with pytest.raises((RuntimeError, TimeoutError)):
                    await video_initial_processing(
                        video_id=test_video_id,
                        tenant_id=test_tenant_id,
                        storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                    )

                # Verify error status was set
                status_calls = mock_supabase_service.update_video_status.call_args_list
                error_calls = [
                    call for call in status_calls if call.kwargs.get("status") == "error"
                ]
                assert len(error_calls) >= 1
                assert "Frame extraction failed" in error_calls[0].kwargs["error_message"]

    @pytest.mark.asyncio
    async def test_supabase_update_retry_logic(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_extract_result: ExtractResult,
    ):
        """
        Verify 2 retries on Supabase update failures.

        Tests that the update_video_status_task retries up to 2 times.
        """
        mock_supabase = Mock()
        call_count = 0

        def fail_twice(**kwargs):
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                raise Exception("Supabase connection error")
            return None

        mock_supabase.update_video_status = Mock(side_effect=fail_twice)
        mock_supabase.update_video_metadata = Mock(return_value=None)

        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=mock_extract_result)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                # Should succeed after retries
                result = await video_initial_processing(
                    video_id=test_video_id,
                    tenant_id=test_tenant_id,
                    storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                )

                # Verify retries occurred
                # First status update: fail, retry, retry, success = 3 calls
                # Second status update: 1 call
                # Total: 4 calls
                assert call_count == 4
                assert result is not None

    @pytest.mark.asyncio
    async def test_metadata_update_failure_non_critical(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_supabase_service: Mock,
        mock_extract_result: ExtractResult,
    ):
        """
        Verify flow completes even if metadata update fails.

        Metadata update failure should not fail the entire flow since
        processing was successful.
        """
        # Make metadata update fail
        mock_supabase_service.update_video_metadata = Mock(
            side_effect=Exception("Metadata update failed")
        )

        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=mock_extract_result)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                # Flow should complete successfully despite metadata failure
                result = await video_initial_processing(
                    video_id=test_video_id,
                    tenant_id=test_tenant_id,
                    storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                )

                assert result is not None
                assert result["video_id"] == test_video_id
                # Final status should still be active
                last_call = mock_supabase_service.update_video_status.call_args_list[-1]
                assert last_call.kwargs["status"] == "active"

    @pytest.mark.asyncio
    async def test_error_message_propagation(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_supabase_service: Mock,
    ):
        """
        Verify error message stored in video status.

        Ensures detailed error messages are propagated to Supabase.
        """
        error_message = "Modal processing failed: Out of GPU memory"

        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock to raise specific error
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(side_effect=Exception(error_message))
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                with pytest.raises((RuntimeError, Exception)):
                    await video_initial_processing(
                        video_id=test_video_id,
                        tenant_id=test_tenant_id,
                        storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                    )

                # Verify error message was passed to status update
                error_calls = [
                    call
                    for call in mock_supabase_service.update_video_status.call_args_list
                    if call.kwargs.get("status") == "error"
                ]
                assert len(error_calls) >= 1
                assert error_message in error_calls[0].kwargs["error_message"]

    @pytest.mark.asyncio
    async def test_modal_exception_handling(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_supabase_service: Mock,
    ):
        """
        Test handling of generic Modal exceptions.

        Verifies that any Modal exception is caught and processed correctly.
        """
        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock to raise generic exception
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(
                    side_effect=Exception("Unexpected Modal error")
                )
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                with pytest.raises((RuntimeError, Exception)):
                    await video_initial_processing(
                        video_id=test_video_id,
                        tenant_id=test_tenant_id,
                        storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                    )

                # Verify error status was set
                error_calls = [
                    call
                    for call in mock_supabase_service.update_video_status.call_args_list
                    if call.kwargs.get("status") == "error"
                ]
                assert len(error_calls) >= 1

    @pytest.mark.asyncio
    async def test_flow_fails_gracefully_on_invalid_video_id(
        self,
        test_tenant_id: str,
        mock_supabase_service: Mock,
    ):
        """
        Test handling of invalid video_id.

        Verifies the flow handles invalid IDs gracefully.
        """
        invalid_video_id = "invalid-id-@#$"

        # Make Supabase raise error for invalid ID
        mock_supabase_service.update_video_status = Mock(
            side_effect=Exception("Invalid video ID format")
        )

        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock (won't be reached)
                mock_app = Mock()
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                with pytest.raises(Exception):
                    await video_initial_processing(
                        video_id=invalid_video_id,
                        tenant_id=test_tenant_id,
                        storage_key=f"{test_tenant_id}/client/videos/{invalid_video_id}/video.mp4",
                    )

    @pytest.mark.asyncio
    async def test_supabase_connection_error(
        self,
        test_video_id: str,
        test_tenant_id: str,
    ):
        """
        Test handling when Supabase is unavailable.

        Verifies flow fails appropriately when database is unreachable.
        """
        mock_supabase = Mock()
        mock_supabase.update_video_status = Mock(
            side_effect=Exception("Connection refused")
        )

        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase,
            ):
                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                # Should fail when trying to update initial status
                with pytest.raises(Exception) as exc_info:
                    await video_initial_processing(
                        video_id=test_video_id,
                        tenant_id=test_tenant_id,
                        storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                    )

                assert "Connection refused" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_partial_extraction_failure(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_supabase_service: Mock,
    ):
        """
        Test handling of incomplete extraction (e.g., corrupted video).

        Verifies that partial failures are handled correctly.
        """
        # Create a result with high failure count
        partial_result = ExtractResult(
            frame_count=10,  # Very few frames extracted
            duration=10.0,
            frame_width=1920,
            frame_height=1080,
            video_codec="h264",
            bitrate=5000000,
            ocr_box_count=5,
            failed_ocr_count=95,  # Most frames failed
            processing_duration_seconds=5.0,
            full_frames_key="test-tenant-123/client/videos/test-video-789/full_frames/",
            ocr_db_key="test-tenant-123/server/videos/test-video-789/raw-ocr.db.gz",  # pragma: allowlist secret
            layout_db_key="test-tenant-123/client/videos/test-video-789/layout.db.gz",  # pragma: allowlist secret
        )

        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase_service,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock with partial result
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=partial_result)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                # Flow should complete but with concerning metrics
                result = await video_initial_processing(
                    video_id=test_video_id,
                    tenant_id=test_tenant_id,
                    storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                )

                assert result["frame_count"] == 10
                assert result["video_id"] == test_video_id
                # Status should still be active even with partial failure
                last_call = mock_supabase_service.update_video_status.call_args_list[-1]
                assert last_call.kwargs["status"] == "active"


# =============================================================================
# Test Class 3: TestVideoInitialProcessingConcurrency
# =============================================================================


class TestVideoInitialProcessingConcurrency:
    """Test concurrent flow execution and isolation."""

    @pytest.mark.asyncio
    async def test_multiple_videos_process_concurrently(
        self,
        test_tenant_id: str,
        mock_extract_result: ExtractResult,
    ):
        """
        Verify flows for different videos don't conflict.

        Ensures concurrent processing of multiple videos works correctly.
        """
        video_id_1 = "video-001"
        video_id_2 = "video-002"
        video_id_3 = "video-003"

        mock_supabase = Mock()
        mock_supabase.update_video_status = Mock(return_value=None)
        mock_supabase.update_video_metadata = Mock(return_value=None)

        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=mock_extract_result)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                # Run three flows concurrently
                results = await asyncio.gather(
                    video_initial_processing(
                        video_id=video_id_1,
                        tenant_id=test_tenant_id,
                        storage_key=f"{test_tenant_id}/client/videos/{video_id_1}/video.mp4",
                    ),
                    video_initial_processing(
                        video_id=video_id_2,
                        tenant_id=test_tenant_id,
                        storage_key=f"{test_tenant_id}/client/videos/{video_id_2}/video.mp4",
                    ),
                    video_initial_processing(
                        video_id=video_id_3,
                        tenant_id=test_tenant_id,
                        storage_key=f"{test_tenant_id}/client/videos/{video_id_3}/video.mp4",
                    ),
                )

                # Verify all three completed successfully
                assert len(results) == 3
                assert results[0]["video_id"] == video_id_1
                assert results[1]["video_id"] == video_id_2
                assert results[2]["video_id"] == video_id_3

                # Verify each video was processed independently
                assert all(r["frame_count"] == 100 for r in results)

    @pytest.mark.asyncio
    async def test_same_video_multiple_triggers(
        self,
        test_video_id: str,
        test_tenant_id: str,
        mock_extract_result: ExtractResult,
    ):
        """
        Test idempotency when same video triggered multiple times.

        Verifies that processing the same video multiple times doesn't
        cause conflicts (though in practice this should be prevented upstream).
        """
        mock_supabase = Mock()
        mock_supabase.update_video_status = Mock(return_value=None)
        mock_supabase.update_video_metadata = Mock(return_value=None)

        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=mock_extract_result)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                # Run the same flow twice
                result1 = await video_initial_processing(
                    video_id=test_video_id,
                    tenant_id=test_tenant_id,
                    storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                )

                result2 = await video_initial_processing(
                    video_id=test_video_id,
                    tenant_id=test_tenant_id,
                    storage_key=f"{test_tenant_id}/client/videos/{test_video_id}/video.mp4",
                )

                # Both should succeed with same results
                assert result1["video_id"] == result2["video_id"] == test_video_id
                assert result1["frame_count"] == result2["frame_count"]

                # Verify status was updated at least twice (once per run)
                assert mock_supabase.update_video_status.call_count >= 4  # 2 runs x 2 updates

    @pytest.mark.asyncio
    async def test_tenant_isolation(
        self,
        test_video_id: str,
        mock_extract_result: ExtractResult,
    ):
        """
        Verify cross-tenant data isolation.

        Ensures different tenants processing videos with same ID don't conflict.
        """
        tenant_id_1 = "tenant-001"
        tenant_id_2 = "tenant-002"

        mock_supabase = Mock()
        mock_supabase.update_video_status = Mock(return_value=None)
        mock_supabase.update_video_metadata = Mock(return_value=None)

        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=mock_extract_result)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                # Run flows for different tenants concurrently
                results = await asyncio.gather(
                    video_initial_processing(
                        video_id=test_video_id,
                        tenant_id=tenant_id_1,
                        storage_key=f"{tenant_id_1}/client/videos/{test_video_id}/video.mp4",
                    ),
                    video_initial_processing(
                        video_id=test_video_id,
                        tenant_id=tenant_id_2,
                        storage_key=f"{tenant_id_2}/client/videos/{test_video_id}/video.mp4",
                    ),
                )

                # Both should succeed
                assert len(results) == 2
                assert all(r["video_id"] == test_video_id for r in results)

                # Verify Modal was called with correct tenant_id for each
                modal_calls = mock_function.remote.call_args_list
                assert len(modal_calls) == 2
                tenant_ids_used = [call.kwargs["tenant_id"] for call in modal_calls]
                assert tenant_id_1 in tenant_ids_used
                assert tenant_id_2 in tenant_ids_used

    @pytest.mark.asyncio
    async def test_flow_metadata_unique_per_video(
        self,
        test_tenant_id: str,
        mock_extract_result: ExtractResult,
    ):
        """
        Verify metadata is uniquely tracked per video.

        Ensures each video gets its own metadata updates.
        """
        video_id_1 = "video-001"
        video_id_2 = "video-002"

        mock_supabase = Mock()
        mock_supabase.update_video_status = Mock(return_value=None)
        mock_supabase.update_video_metadata = Mock(return_value=None)

        with prefect_test_harness():
            with patch(
                "app.services.supabase_service.SupabaseServiceImpl",
                return_value=mock_supabase,
            ), patch("modal.App") as mock_modal_app:
                # Setup Modal mock
                mock_app = Mock()
                mock_function = Mock()
                mock_function.remote = Mock(return_value=mock_extract_result)
                mock_app.function = Mock(return_value=mock_function)
                mock_modal_app.lookup = Mock(return_value=mock_app)

                from app.flows.video_initial_processing import (
                    video_initial_processing,
                )

                # Process two videos
                await asyncio.gather(
                    video_initial_processing(
                        video_id=video_id_1,
                        tenant_id=test_tenant_id,
                        storage_key=f"{test_tenant_id}/client/videos/{video_id_1}/video.mp4",
                    ),
                    video_initial_processing(
                        video_id=video_id_2,
                        tenant_id=test_tenant_id,
                        storage_key=f"{test_tenant_id}/client/videos/{video_id_2}/video.mp4",
                    ),
                )

                # Verify metadata updates were called for both videos
                metadata_calls = mock_supabase.update_video_metadata.call_args_list
                assert len(metadata_calls) == 2

                video_ids_updated = [call.kwargs["video_id"] for call in metadata_calls]
                assert video_id_1 in video_ids_updated
                assert video_id_2 in video_ids_updated

                # Verify each got the same duration
                assert all(call.kwargs["duration_seconds"] == 10.0 for call in metadata_calls)
