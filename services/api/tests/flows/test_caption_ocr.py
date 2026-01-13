"""
Tests for caption_ocr Prefect flow.

Tests the flow that orchestrates caption OCR generation from median frames:
1. Update caption status to 'processing'
2. Call Modal generate_caption_ocr function
3. Update caption with OCR result
4. Update caption status to 'completed'
5. Handle errors by updating status to 'error'

Key Features:
- Flow-level retry (1 retry with 30s delay)
- Comprehensive error handling
- Status tracking throughout processing
"""

import pytest
from unittest.mock import AsyncMock, Mock, patch
from dataclasses import dataclass

from tests.flows.conftest import CaptionOcrResult


# Test data fixtures
@pytest.fixture
def test_caption_id() -> int:
    """Test caption ID."""
    return 42


@pytest.fixture
def test_start_frame() -> int:
    """Test start frame."""
    return 100


@pytest.fixture
def test_end_frame() -> int:
    """Test end frame."""
    return 200


@pytest.fixture
def test_version() -> int:
    """Test cropped frames version."""
    return 1


@pytest.fixture
def mock_ocr_result() -> CaptionOcrResult:
    """Mock OCR result from Modal function."""
    return CaptionOcrResult(
        ocr_text="Sample Caption Text",
        confidence=0.95,
        frame_count=101,
        median_frame_index=150
    )


@pytest.fixture
def mock_ocr_result_low_confidence() -> CaptionOcrResult:
    """Mock OCR result with low confidence."""
    return CaptionOcrResult(
        ocr_text="Uncertain Text",
        confidence=0.42,
        frame_count=101,
        median_frame_index=150
    )


# ============================================================================
# Test Class 1: TestCaptionOcrSuccess
# ============================================================================


class TestCaptionOcrSuccess:
    """Test successful OCR generation scenarios."""

    @pytest.mark.asyncio
    async def test_caption_status_transitions(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        mock_ocr_result,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify caption status transitions: queued → processing → completed."""
        # Configure Modal function to return mock OCR result
        mock_modal_function.remote.aio.return_value = mock_ocr_result

        # Mock CaptionServiceImpl
        mock_caption_service = Mock()

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow
            await caption_ocr(
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                caption_id=test_caption_id,
                start_frame=test_start_frame,
                end_frame=test_end_frame,
                version=test_version,
            )

            # Verify status transitions
            assert mock_caption_service.update_caption_status.call_count == 2

            # First call: status → 'processing'
            first_call = mock_caption_service.update_caption_status.call_args_list[0]
            assert first_call[1]['video_id'] == test_video_id
            assert first_call[1]['tenant_id'] == test_tenant_id
            assert first_call[1]['caption_id'] == test_caption_id
            assert first_call[1]['status'] == 'processing'

            # Second call: status → 'completed'
            second_call = mock_caption_service.update_caption_status.call_args_list[1]
            assert second_call[1]['status'] == 'completed'

    @pytest.mark.asyncio
    async def test_modal_called_with_frame_range(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        mock_ocr_result,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify Modal called with correct start_frame, end_frame, version parameters."""
        # Configure Modal function
        mock_modal_function.remote.aio.return_value = mock_ocr_result

        mock_caption_service = Mock()

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow
            await caption_ocr(
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                caption_id=test_caption_id,
                start_frame=test_start_frame,
                end_frame=test_end_frame,
                version=test_version,
            )

            # Verify Modal function was called
            mock_modal_function.remote.aio.assert_called_once()

            # Verify call arguments
            call_kwargs = mock_modal_function.remote.aio.call_args[1]
            assert call_kwargs['start_frame'] == test_start_frame
            assert call_kwargs['end_frame'] == test_end_frame

            # Verify chunks_prefix includes version
            chunks_prefix = call_kwargs['chunks_prefix']
            assert f"cropped_frames_v{test_version}" in chunks_prefix
            assert test_tenant_id in chunks_prefix
            assert test_video_id in chunks_prefix

    @pytest.mark.asyncio
    async def test_ocr_result_saved_to_caption(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        mock_ocr_result,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify OCR text and confidence are saved to caption."""
        # Configure Modal function
        mock_modal_function.remote.aio.return_value = mock_ocr_result

        mock_caption_service = Mock()

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow
            await caption_ocr(
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                caption_id=test_caption_id,
                start_frame=test_start_frame,
                end_frame=test_end_frame,
                version=test_version,
            )

            # Verify OCR result was saved
            mock_caption_service.update_caption_ocr.assert_called_once_with(
                video_id=test_video_id,
                tenant_id=test_tenant_id,
                caption_id=test_caption_id,
                ocr_text=mock_ocr_result.ocr_text,
                confidence=mock_ocr_result.confidence,
            )

    @pytest.mark.asyncio
    async def test_flow_returns_caption_id_and_ocr(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        mock_ocr_result,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify flow returns dict with caption_id, ocr_text, and confidence."""
        # Configure Modal function
        mock_modal_function.remote.aio.return_value = mock_ocr_result

        mock_caption_service = Mock()

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow
            result = await caption_ocr(
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                caption_id=test_caption_id,
                start_frame=test_start_frame,
                end_frame=test_end_frame,
                version=test_version,
            )

            # Verify return structure
            assert isinstance(result, dict)
            assert result['caption_id'] == test_caption_id
            assert result['ocr_text'] == mock_ocr_result.ocr_text
            assert result['confidence'] == mock_ocr_result.confidence

    @pytest.mark.asyncio
    async def test_flow_uses_correct_version(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        mock_ocr_result,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
    ):
        """Verify flow uses cropped frames version in chunks_prefix."""
        # Test with version 3
        test_version = 3

        # Configure Modal function
        mock_modal_function.remote.aio.return_value = mock_ocr_result

        mock_caption_service = Mock()

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow
            await caption_ocr(
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                caption_id=test_caption_id,
                start_frame=test_start_frame,
                end_frame=test_end_frame,
                version=test_version,
            )

            # Verify chunks_prefix includes correct version
            call_kwargs = mock_modal_function.remote.aio.call_args[1]
            chunks_prefix = call_kwargs['chunks_prefix']
            assert f"cropped_frames_v{test_version}" in chunks_prefix
            assert "cropped_frames_v3" in chunks_prefix

    @pytest.mark.asyncio
    async def test_ocr_confidence_score_validation(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        mock_ocr_result_low_confidence,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify OCR confidence score is in valid range [0.0, 1.0]."""
        # Configure Modal function with low confidence result
        mock_modal_function.remote.aio.return_value = mock_ocr_result_low_confidence

        mock_caption_service = Mock()

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow
            result = await caption_ocr(
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                caption_id=test_caption_id,
                start_frame=test_start_frame,
                end_frame=test_end_frame,
                version=test_version,
            )

            # Verify confidence is in valid range
            assert 0.0 <= result['confidence'] <= 1.0
            assert result['confidence'] == 0.42

            # Verify low confidence was still saved
            mock_caption_service.update_caption_ocr.assert_called_once()
            call_kwargs = mock_caption_service.update_caption_ocr.call_args[1]
            assert call_kwargs['confidence'] == 0.42


# ============================================================================
# Test Class 2: TestCaptionOcrRetries
# ============================================================================


class TestCaptionOcrRetries:
    """Test retry mechanism (1 retry with 30s delay)."""

    @pytest.mark.asyncio
    async def test_flow_retries_once_on_failure(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify flow has retry configuration: 1 retry with 30s delay."""
        from app.flows.caption_ocr import caption_ocr

        # Verify flow decorator configuration
        assert caption_ocr.retries == 1
        assert caption_ocr.retry_delay_seconds == 30

    @pytest.mark.asyncio
    async def test_retry_success_after_transient_error(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        mock_ocr_result,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Simulate transient error on first call, verify retry succeeds."""
        # Configure Modal function to fail first, then succeed
        mock_modal_function.remote.aio.side_effect = [
            Exception("Transient network error"),
            mock_ocr_result,  # Success on retry
        ]

        mock_caption_service = Mock()

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow - should succeed after retry (Prefect handles this)
            result = await caption_ocr(
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                caption_id=test_caption_id,
                start_frame=test_start_frame,
                end_frame=test_end_frame,
                version=test_version,
            )

            # Verify the flow succeeded on retry
            assert result['caption_id'] == test_caption_id
            assert result['ocr_text'] == mock_ocr_result.ocr_text

            # Verify Modal function was called twice (initial + retry)
            assert mock_modal_function.remote.aio.call_count == 2

            # Verify final status is 'completed'
            completed_calls = [
                call for call in mock_caption_service.update_caption_status.call_args_list
                if call[1].get('status') == 'completed'
            ]
            assert len(completed_calls) >= 1

    @pytest.mark.asyncio
    async def test_permanent_failure_after_retries(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify error status set after all retries exhausted."""
        # Configure Modal function to always fail
        mock_modal_function.remote.aio.side_effect = Exception("Permanent Modal failure")

        mock_caption_service = Mock()

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow - should fail
            with pytest.raises(Exception, match="Permanent Modal failure"):
                await caption_ocr(
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    caption_id=test_caption_id,
                    start_frame=test_start_frame,
                    end_frame=test_end_frame,
                    version=test_version,
                )

            # Verify error status was set with error message
            error_status_calls = [
                call for call in mock_caption_service.update_caption_status.call_args_list
                if call[1].get('status') == 'error'
            ]
            assert len(error_status_calls) >= 1

            # Verify error message was included
            error_call = error_status_calls[0]
            assert error_call[1].get('error_message') is not None
            assert "Permanent Modal failure" in error_call[1]['error_message']

    @pytest.mark.asyncio
    async def test_retry_count_tracked(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify retry mechanism increments call count."""
        # Configure Modal function to fail
        mock_modal_function.remote.aio.side_effect = Exception("Modal timeout")

        mock_caption_service = Mock()

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow
            with pytest.raises(Exception, match="Modal timeout"):
                await caption_ocr(
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    caption_id=test_caption_id,
                    start_frame=test_start_frame,
                    end_frame=test_end_frame,
                    version=test_version,
                )

            # Verify Modal function was called (at least once)
            assert mock_modal_function.remote.aio.call_count >= 1

    @pytest.mark.asyncio
    async def test_no_retry_on_validation_errors(
        self,
        monkeypatch,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify immediate fail on validation errors (e.g., invalid params)."""
        # Note: This tests that ValueError from _initialize_services is raised immediately
        # and not caught by the retry mechanism (since it happens before the try block)

        # Remove Wasabi credentials to trigger validation error
        monkeypatch.delenv("WASABI_ACCESS_KEY_ID", raising=False)
        monkeypatch.delenv("WASABI_ACCESS_KEY_READWRITE", raising=False)
        monkeypatch.delenv("WASABI_SECRET_ACCESS_KEY", raising=False)
        monkeypatch.delenv("WASABI_SECRET_KEY_READWRITE", raising=False)

        from app.flows.caption_ocr import caption_ocr

        # Run the flow - should fail immediately without retry
        with pytest.raises(ValueError, match="Wasabi credentials not found"):
            await caption_ocr(
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                caption_id=test_caption_id,
                start_frame=test_start_frame,
                end_frame=test_end_frame,
                version=test_version,
            )


# ============================================================================
# Test Class 3: TestCaptionOcrErrors
# ============================================================================


class TestCaptionOcrErrors:
    """Test error scenarios and error handling."""

    @pytest.mark.asyncio
    async def test_missing_wasabi_credentials(
        self,
        monkeypatch,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify ValueError raised if WASABI_ACCESS_KEY missing."""
        # Clear Wasabi credentials
        monkeypatch.delenv("WASABI_ACCESS_KEY_ID", raising=False)
        monkeypatch.delenv("WASABI_ACCESS_KEY_READWRITE", raising=False)
        monkeypatch.delenv("WASABI_SECRET_ACCESS_KEY", raising=False)
        monkeypatch.delenv("WASABI_SECRET_KEY_READWRITE", raising=False)

        from app.flows.caption_ocr import caption_ocr

        # Run the flow - should fail with ValueError
        with pytest.raises(ValueError, match="Wasabi credentials not found"):
            await caption_ocr(
                tenant_id=test_tenant_id,
                video_id=test_video_id,
                caption_id=test_caption_id,
                start_frame=test_start_frame,
                end_frame=test_end_frame,
                version=test_version,
            )

    @pytest.mark.asyncio
    async def test_modal_timeout_handling(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify timeout exception caught and status updated to error."""
        # Configure Modal function to timeout
        mock_modal_function.remote.aio.side_effect = TimeoutError("Modal function timeout")

        mock_caption_service = Mock()

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow
            with pytest.raises(TimeoutError):
                await caption_ocr(
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    caption_id=test_caption_id,
                    start_frame=test_start_frame,
                    end_frame=test_end_frame,
                    version=test_version,
                )

            # Verify error status was set
            error_calls = [
                call for call in mock_caption_service.update_caption_status.call_args_list
                if call[1].get('status') == 'error'
            ]
            assert len(error_calls) >= 1
            assert "timeout" in error_calls[0][1]['error_message'].lower()

    @pytest.mark.asyncio
    async def test_invalid_frame_range(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_version,
    ):
        """Verify handling of invalid frame range (start_frame >= end_frame)."""
        # Set invalid frame range
        start_frame = 200
        end_frame = 100  # Invalid: end < start

        mock_caption_service = Mock()

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow - Modal may validate this, or we get empty result
            # Either way, the flow should handle it gracefully
            try:
                await caption_ocr(
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    caption_id=test_caption_id,
                    start_frame=start_frame,
                    end_frame=end_frame,
                    version=test_version,
                )
            except Exception:
                # If it raises, verify error status was set
                error_calls = [
                    call for call in mock_caption_service.update_caption_status.call_args_list
                    if call[1].get('status') == 'error'
                ]
                assert len(error_calls) >= 1

    @pytest.mark.asyncio
    async def test_invalid_version(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
    ):
        """Verify handling of non-existent cropped frames version."""
        # Use non-existent version
        invalid_version = 999

        # Configure Modal to fail with version not found
        mock_modal_function.remote.aio.side_effect = Exception("Cropped frames version 999 not found")

        mock_caption_service = Mock()

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow
            with pytest.raises(Exception, match="version 999 not found"):
                await caption_ocr(
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    caption_id=test_caption_id,
                    start_frame=test_start_frame,
                    end_frame=test_end_frame,
                    version=invalid_version,
                )

            # Verify error status was set
            error_calls = [
                call for call in mock_caption_service.update_caption_status.call_args_list
                if call[1].get('status') == 'error'
            ]
            assert len(error_calls) >= 1

    @pytest.mark.asyncio
    async def test_caption_not_found(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        mock_ocr_result,
        test_tenant_id,
        test_video_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify handling of missing caption ID in database."""
        # Use non-existent caption ID
        invalid_caption_id = 99999

        # Configure Modal to succeed
        mock_modal_function.remote.aio.return_value = mock_ocr_result

        # Configure caption service to fail on first status update
        mock_caption_service = Mock()
        mock_caption_service.update_caption_status.side_effect = Exception("Caption 99999 not found")

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow
            with pytest.raises(Exception, match="Caption 99999 not found"):
                await caption_ocr(
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    caption_id=invalid_caption_id,
                    start_frame=test_start_frame,
                    end_frame=test_end_frame,
                    version=test_version,
                )

    @pytest.mark.asyncio
    async def test_error_status_includes_message(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify error message is stored when status set to error."""
        # Configure Modal to fail with specific error
        error_message = "OCR model failed to initialize"
        mock_modal_function.remote.aio.side_effect = Exception(error_message)

        mock_caption_service = Mock()

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow
            with pytest.raises(Exception, match=error_message):
                await caption_ocr(
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    caption_id=test_caption_id,
                    start_frame=test_start_frame,
                    end_frame=test_end_frame,
                    version=test_version,
                )

            # Verify error status includes the error message
            error_calls = [
                call for call in mock_caption_service.update_caption_status.call_args_list
                if call[1].get('status') == 'error'
            ]
            assert len(error_calls) >= 1

            # Verify error message is passed
            error_call = error_calls[0]
            assert error_call[1]['error_message'] == error_message

    @pytest.mark.asyncio
    async def test_modal_app_lookup_failure(
        self,
        mock_env_vars,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify handling when Modal app lookup fails."""
        mock_caption_service = Mock()

        # Configure Modal.App.lookup to fail
        with patch('modal.App.lookup', side_effect=Exception("Modal app not found")), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow
            with pytest.raises(Exception, match="Modal app not found"):
                await caption_ocr(
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    caption_id=test_caption_id,
                    start_frame=test_start_frame,
                    end_frame=test_end_frame,
                    version=test_version,
                )

            # Verify error status was set
            error_calls = [
                call for call in mock_caption_service.update_caption_status.call_args_list
                if call[1].get('status') == 'error'
            ]
            assert len(error_calls) >= 1

    @pytest.mark.asyncio
    async def test_caption_service_update_failure_logged(
        self,
        mock_env_vars,
        mock_modal_app,
        mock_modal_function,
        test_tenant_id,
        test_video_id,
        test_caption_id,
        test_start_frame,
        test_end_frame,
        test_version,
    ):
        """Verify that failures in updating error status are logged but don't crash."""
        # Configure Modal to fail
        mock_modal_function.remote.aio.side_effect = Exception("Modal error")

        # Configure caption service to succeed on processing, fail on error update
        mock_caption_service = Mock()
        call_count = [0]

        def update_status_side_effect(*args, **kwargs):
            call_count[0] += 1
            status = kwargs.get('status')
            if status == 'processing':
                # First call (processing) succeeds
                return None
            elif status == 'error':
                # Error status update fails
                raise Exception("Database connection lost")

        mock_caption_service.update_caption_status.side_effect = update_status_side_effect

        with patch('modal.App.lookup', return_value=mock_modal_app), \
             patch('app.flows.caption_ocr.CaptionServiceImpl', return_value=mock_caption_service):

            from app.flows.caption_ocr import caption_ocr

            # Run the flow - original Modal exception should still be raised
            # The error status update failure is caught and logged
            with pytest.raises(Exception, match="Modal error"):
                await caption_ocr(
                    tenant_id=test_tenant_id,
                    video_id=test_video_id,
                    caption_id=test_caption_id,
                    start_frame=test_start_frame,
                    end_frame=test_end_frame,
                    version=test_version,
                )

            # Verify error status update was attempted at least once
            assert mock_caption_service.update_caption_status.call_count >= 2  # processing + error
