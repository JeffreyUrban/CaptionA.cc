"""
Pytest fixtures for Service Integration Tests.

This module provides shared fixtures and utilities for testing service integration:
- Mock external services (Prefect, Supabase, Modal)
- Test data builders for video records and tenant data
- Environment variable helpers
- Mock result objects from Modal functions

These fixtures are specifically designed for integration tests that verify
service orchestration logic without calling actual external APIs.
"""

import os
from collections.abc import Generator
from dataclasses import dataclass
from typing import Any, Optional
from unittest.mock import AsyncMock, Mock

import httpx
import pytest


# =============================================================================
# Environment Variable Fixtures
# =============================================================================


@pytest.fixture
def mock_env_vars() -> Generator[dict[str, str], None, None]:
    """
    Mock environment variables for integration tests.

    Sets up required environment variables for testing service integration
    without needing actual credentials. Restores original environment after test.

    Returns:
        Dictionary of environment variables set for the test

    Example:
        def test_service_init(mock_env_vars):
            # Environment variables are already set
            assert os.environ["SUPABASE_URL"] == "http://test-supabase.local"
    """
    original_env = os.environ.copy()

    test_env = {
        "SUPABASE_URL": "http://test-supabase.local",
        "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",  # pragma: allowlist secret
        "SUPABASE_SCHEMA": "captionacc_test",
        "PREFECT_API_URL": "http://test-prefect.local/api",
        "PREFECT_API_KEY": "test-prefect-key",  # pragma: allowlist secret
        "WASABI_ENDPOINT": "https://test-wasabi.local",
        "WASABI_ACCESS_KEY": "test-access-key",  # pragma: allowlist secret
        "WASABI_SECRET_KEY": "test-secret-key",  # pragma: allowlist secret
        "WASABI_BUCKET": "test-bucket",
        "MODAL_TOKEN_ID": "test-modal-token-id",
        "MODAL_TOKEN_SECRET": "test-modal-token-secret",  # pragma: allowlist secret,
    }

    os.environ.update(test_env)

    yield test_env

    # Restore original environment
    os.environ.clear()
    os.environ.update(original_env)


@pytest.fixture
def integration_test_config(mock_env_vars: dict[str, str]) -> dict[str, Any]:
    """
    Configuration dictionary for integration tests.

    Provides a centralized configuration object with all test settings.
    Useful for tests that need to verify configuration propagation.

    Args:
        mock_env_vars: Environment variables fixture

    Returns:
        Dictionary containing test configuration values

    Example:
        def test_config_loading(integration_test_config):
            assert integration_test_config["supabase_url"] == "http://test-supabase.local"
    """
    return {
        "supabase_url": mock_env_vars["SUPABASE_URL"],
        "supabase_key": mock_env_vars["SUPABASE_SERVICE_ROLE_KEY"],
        "supabase_schema": mock_env_vars["SUPABASE_SCHEMA"],
        "prefect_api_url": mock_env_vars["PREFECT_API_URL"],
        "prefect_api_key": mock_env_vars["PREFECT_API_KEY"],
        "wasabi_endpoint": mock_env_vars["WASABI_ENDPOINT"],
        "wasabi_access_key": mock_env_vars["WASABI_ACCESS_KEY"],
        "wasabi_secret_key": mock_env_vars["WASABI_SECRET_KEY"],
        "wasabi_bucket": mock_env_vars["WASABI_BUCKET"],
    }


# =============================================================================
# Mock Prefect Client Fixtures
# =============================================================================


@pytest.fixture
def mock_prefect_response_data() -> dict[str, Any]:
    """
    Sample Prefect API response data.

    Provides realistic response structures from Prefect API endpoints.

    Returns:
        Dictionary with sample flow run data

    Example:
        def test_flow_parsing(mock_prefect_response_data):
            flow_run_id = mock_prefect_response_data["flow_runs"][0]["id"]
            assert flow_run_id == "flow-run-123"
    """
    return {
        "flow_runs": [
            {
                "id": "flow-run-123",
                "name": "video-initial-processing",
                "state": {
                    "type": "COMPLETED",
                    "name": "Completed",
                    "timestamp": "2024-01-15T12:00:00Z",
                },
                "parameters": {
                    "video_id": "video-123",
                    "tenant_id": "tenant-456",
                    "storage_key": "tenant-456/client/videos/video-123/video.mp4",
                },
                "start_time": "2024-01-15T11:55:00Z",
                "end_time": "2024-01-15T12:00:00Z",
                "total_run_time": 300.0,
            }
        ],
        "deployment": {
            "id": "deployment-abc",
            "name": "video-processing-deployment",
            "flow_id": "flow-xyz",
        },
    }


@pytest.fixture
async def mock_prefect_client(
    mock_prefect_response_data: dict[str, Any],
) -> AsyncMock:
    """
    Mock httpx.AsyncClient for Prefect API calls.

    Simulates Prefect API responses for testing flow orchestration.
    Pre-configured with common responses for flow runs and deployments.

    Args:
        mock_prefect_response_data: Sample response data fixture

    Returns:
        AsyncMock configured to simulate Prefect API client

    Example:
        async def test_flow_trigger(mock_prefect_client):
            response = await mock_prefect_client.post("/flow_runs")
            assert response.status_code == 200
            assert "flow_run_id" in response.json()
    """
    mock_client = AsyncMock(spec=httpx.AsyncClient)

    # Mock successful flow run creation
    create_response = Mock()
    create_response.status_code = 200
    create_response.json.return_value = {
        "id": "new-flow-run-456",
        "state": {"type": "SCHEDULED"},
    }

    # Mock flow run query
    query_response = Mock()
    query_response.status_code = 200
    query_response.json.return_value = mock_prefect_response_data

    # Configure mock client responses
    mock_client.post.return_value = create_response
    mock_client.get.return_value = query_response

    return mock_client


# =============================================================================
# Mock Supabase Service Fixtures
# =============================================================================


@pytest.fixture
def mock_video_record() -> dict[str, Any]:
    """
    Sample video record from Supabase.

    Represents a video record as returned from the Supabase videos table.
    Includes all fields needed for video processing workflows.

    Returns:
        Dictionary with video metadata

    Example:
        def test_video_processing(mock_video_record):
            video_id = mock_video_record["id"]
            assert video_id == "video-123"
            assert mock_video_record["status"] == "processing"
    """
    return {
        "id": "video-123",
        "tenant_id": "tenant-456",
        "storage_key": "tenant-456/client/videos/video-123/video.mp4",
        "file_size_bytes": 10485760,  # 10 MB
        "duration_seconds": 120.5,
        "status": "processing",
        "caption_status": None,
        "current_cropped_frames_version": None,
        "created_at": "2024-01-15T10:00:00Z",
        "updated_at": "2024-01-15T11:00:00Z",
    }


@pytest.fixture
def mock_tenant_record() -> dict[str, Any]:
    """
    Sample tenant record from Supabase.

    Represents a tenant record with subscription and usage information.

    Returns:
        Dictionary with tenant metadata

    Example:
        def test_tenant_tier(mock_tenant_record):
            tier = mock_tenant_record["subscription_tier"]
            assert tier in ["free", "premium", "enterprise"]
    """
    return {
        "id": "tenant-456",
        "name": "Test Tenant",
        "subscription_tier": "premium",
        "storage_used_bytes": 524288000,  # 500 MB
        "video_count": 42,
        "created_at": "2023-06-01T00:00:00Z",
        "updated_at": "2024-01-15T10:00:00Z",
    }


@pytest.fixture
def mock_supabase_service(
    mock_video_record: dict[str, Any],
    mock_tenant_record: dict[str, Any],
) -> Mock:
    """
    Mock SupabaseService implementation.

    Provides a mock Supabase service with pre-configured responses for common
    operations. Tracks all method calls for verification in tests.

    Args:
        mock_video_record: Sample video record fixture
        mock_tenant_record: Sample tenant record fixture

    Returns:
        Mock object implementing SupabaseService protocol

    Example:
        def test_status_update(mock_supabase_service):
            mock_supabase_service.update_video_status(
                video_id="video-123",
                status="active"
            )
            assert mock_supabase_service.update_video_status.called
    """
    mock_service = Mock()

    # Configure method mocks
    mock_service.update_video_status = Mock(return_value=None)
    mock_service.update_video_metadata = Mock(return_value=None)
    mock_service.acquire_server_lock = Mock(return_value=True)
    mock_service.release_server_lock = Mock(return_value=None)
    mock_service.get_tenant_tier = Mock(
        return_value=mock_tenant_record["subscription_tier"]
    )
    mock_service.get_video_metadata = Mock(return_value=mock_video_record)

    return mock_service


# =============================================================================
# Mock Modal Result Fixtures
# =============================================================================


@dataclass
class MockExtractResult:
    """
    Mock result from Modal extract_frames_and_ocr function.

    Simulates the ExtractResult returned by the Modal frame extraction function.
    Use this to test flow logic without calling actual Modal functions.

    Attributes:
        frame_count: Total frames extracted
        duration: Video duration in seconds
        frame_width: Frame width in pixels
        frame_height: Frame height in pixels
        video_codec: Video codec (e.g., "h264", "vp9")
        bitrate: Video bitrate in bits per second
        ocr_box_count: Total OCR text boxes detected
        failed_ocr_count: Number of frames where OCR failed
        processing_duration_seconds: Total processing time
        full_frames_key: Path to full_frames/ directory in S3
        ocr_db_key: Path to raw-ocr.db.gz in S3
        layout_db_key: Path to layout.db.gz in S3

    Example:
        def test_with_extract_result(mock_extract_result):
            assert mock_extract_result.frame_count == 1000
            assert mock_extract_result.ocr_box_count > 0
    """

    frame_count: int = 1000
    duration: float = 100.0
    frame_width: int = 1920
    frame_height: int = 1080
    video_codec: str = "h264"
    bitrate: int = 5000000
    ocr_box_count: int = 450
    failed_ocr_count: int = 5
    processing_duration_seconds: float = 120.5
    full_frames_key: str = "tenant-456/client/videos/video-123/full_frames/"
    ocr_db_key: str = "tenant-456/server/videos/video-123/raw-ocr.db.gz"
    layout_db_key: str = "tenant-456/client/videos/video-123/layout.db.gz"


@dataclass
class MockCropInferResult:
    """
    Mock result from Modal crop_and_infer_caption_frame_extents function.

    Simulates the CropInferResult returned by the Modal cropping and inference function.
    Use this to test caption processing flows without GPU operations.

    Attributes:
        version: Cropped frames version number
        frame_count: Number of frames in cropped output
        label_counts: Count of each inferred label
        processing_duration_seconds: Total processing time
        caption_frame_extents_db_key: Path to caption_frame_extents.db.gz in S3
        cropped_frames_prefix: Path prefix to cropped_frames_v{N}/ directory

    Example:
        def test_with_crop_infer_result(mock_crop_infer_result):
            assert mock_crop_infer_result.version == 1
            assert "caption_start" in mock_crop_infer_result.label_counts
    """

    version: int = 1
    frame_count: int = 1000
    label_counts: Optional[dict[str, int]] = None
    processing_duration_seconds: float = 180.0
    caption_frame_extents_db_key: str = (
        "tenant-456/server/videos/video-123/caption_frame_extents.db.gz"
    )
    cropped_frames_prefix: str = "tenant-456/client/videos/video-123/cropped_frames_v1/"

    def __post_init__(self):
        """Initialize default label_counts if not provided."""
        if self.label_counts is None:
            self.label_counts = {
                "caption_start": 45,
                "caption_end": 42,
                "no_change": 913,
            }


@dataclass
class MockCaptionOcrResult:
    """
    Mock result from Modal generate_caption_ocr function.

    Simulates the CaptionOcrResult returned by the Modal caption OCR function.
    Use this to test individual caption OCR processing.

    Attributes:
        ocr_text: Extracted text from median frame
        confidence: OCR confidence score (0.0 to 1.0)
        frame_count: Number of frames used to generate median
        median_frame_index: Index of the middle frame

    Example:
        def test_with_caption_ocr_result(mock_caption_ocr_result):
            assert mock_caption_ocr_result.confidence > 0.8
            assert len(mock_caption_ocr_result.ocr_text) > 0
    """

    ocr_text: str = "Sample caption text"
    confidence: float = 0.95
    frame_count: int = 50
    median_frame_index: Optional[int] = 25


@pytest.fixture
def mock_extract_result() -> MockExtractResult:
    """
    Fixture providing a mock ExtractResult.

    Returns a realistic ExtractResult for testing video processing flows.

    Returns:
        MockExtractResult with default values

    Example:
        def test_initial_processing(mock_extract_result):
            # Use in place of actual Modal function result
            result = mock_extract_result
            assert result.frame_count == 1000
    """
    return MockExtractResult()


@pytest.fixture
def mock_crop_infer_result() -> MockCropInferResult:
    """
    Fixture providing a mock CropInferResult.

    Returns a realistic CropInferResult for testing caption processing flows.

    Returns:
        MockCropInferResult with default values

    Example:
        def test_crop_and_infer(mock_crop_infer_result):
            # Use in place of actual Modal function result
            result = mock_crop_infer_result
            assert result.version == 1
    """
    return MockCropInferResult()


@pytest.fixture
def mock_caption_ocr_result() -> MockCaptionOcrResult:
    """
    Fixture providing a mock CaptionOcrResult.

    Returns a realistic CaptionOcrResult for testing OCR processing.

    Returns:
        MockCaptionOcrResult with default values

    Example:
        def test_caption_ocr(mock_caption_ocr_result):
            # Use in place of actual Modal function result
            result = mock_caption_ocr_result
            assert result.confidence > 0.8
    """
    return MockCaptionOcrResult()


# =============================================================================
# Mock Modal Client Fixtures
# =============================================================================


@pytest.fixture
def mock_modal_app(
    mock_extract_result: MockExtractResult,
    mock_crop_infer_result: MockCropInferResult,
    mock_caption_ocr_result: MockCaptionOcrResult,
) -> Mock:
    """
    Mock Modal App with function lookup.

    Simulates Modal App.lookup() and function.remote() calls.
    Pre-configured with mock results for all Modal functions.

    Args:
        mock_extract_result: Mock ExtractResult fixture
        mock_crop_infer_result: Mock CropInferResult fixture
        mock_caption_ocr_result: Mock CaptionOcrResult fixture

    Returns:
        Mock Modal App object

    Example:
        def test_modal_function_call(mock_modal_app):
            extract_fn = mock_modal_app.function("extract_frames_and_ocr")
            result = extract_fn.remote(video_key="...", tenant_id="...", video_id="...")
            assert result.frame_count > 0
    """
    mock_app = Mock()

    # Create mock functions
    mock_extract_fn = Mock()
    mock_extract_fn.remote = Mock(return_value=mock_extract_result)

    mock_crop_infer_fn = Mock()
    mock_crop_infer_fn.remote = Mock(return_value=mock_crop_infer_result)

    mock_caption_ocr_fn = Mock()
    mock_caption_ocr_fn.remote = Mock(return_value=mock_caption_ocr_result)

    # Configure function lookup
    def mock_function_lookup(name: str) -> Mock:
        """Return appropriate mock function based on name."""
        function_map = {
            "extract_frames_and_ocr": mock_extract_fn,
            "crop_and_infer_caption_frame_extents": mock_crop_infer_fn,
            "generate_caption_ocr": mock_caption_ocr_fn,
        }
        return function_map.get(name, Mock())

    mock_app.function = mock_function_lookup

    return mock_app


# =============================================================================
# Test Data Builders
# =============================================================================


def build_video_record(
    video_id: str = "video-123",
    tenant_id: str = "tenant-456",
    status: str = "processing",
    duration_seconds: Optional[float] = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """
    Build a video record with custom values.

    Utility function to create video records with specific attributes.
    Useful for testing different video states and scenarios.

    Args:
        video_id: Video UUID
        tenant_id: Tenant UUID
        status: Video status (uploading, processing, active, error)
        duration_seconds: Video duration (optional)
        **kwargs: Additional fields to override

    Returns:
        Dictionary representing a video record

    Example:
        def test_error_video():
            video = build_video_record(
                video_id="error-video",
                status="error",
                error_message="Processing failed"
            )
            assert video["status"] == "error"
    """
    record = {
        "id": video_id,
        "tenant_id": tenant_id,
        "storage_key": f"{tenant_id}/client/videos/{video_id}/video.mp4",
        "file_size_bytes": 10485760,
        "duration_seconds": duration_seconds,
        "status": status,
        "caption_status": None,
        "current_cropped_frames_version": None,
        "created_at": "2024-01-15T10:00:00Z",
        "updated_at": "2024-01-15T11:00:00Z",
    }
    record.update(kwargs)
    return record


def build_tenant_record(
    tenant_id: str = "tenant-456",
    subscription_tier: str = "premium",
    **kwargs: Any,
) -> dict[str, Any]:
    """
    Build a tenant record with custom values.

    Utility function to create tenant records with specific attributes.
    Useful for testing tier-based behavior and quotas.

    Args:
        tenant_id: Tenant UUID
        subscription_tier: Subscription tier (free, premium, enterprise)
        **kwargs: Additional fields to override

    Returns:
        Dictionary representing a tenant record

    Example:
        def test_free_tier():
            tenant = build_tenant_record(
                tenant_id="free-tenant",
                subscription_tier="free",
                video_count=5
            )
            assert tenant["subscription_tier"] == "free"
    """
    record = {
        "id": tenant_id,
        "name": "Test Tenant",
        "subscription_tier": subscription_tier,
        "storage_used_bytes": 524288000,
        "video_count": 42,
        "created_at": "2023-06-01T00:00:00Z",
        "updated_at": "2024-01-15T10:00:00Z",
    }
    record.update(kwargs)
    return record


def build_extract_result(
    frame_count: int = 1000,
    ocr_box_count: int = 450,
    **kwargs: Any,
) -> MockExtractResult:
    """
    Build an ExtractResult with custom values.

    Utility function to create ExtractResult instances for specific test scenarios.

    Args:
        frame_count: Number of frames extracted
        ocr_box_count: Number of OCR boxes detected
        **kwargs: Additional fields to override

    Returns:
        MockExtractResult instance

    Example:
        def test_short_video():
            result = build_extract_result(
                frame_count=10,
                duration=1.0,
                ocr_box_count=5
            )
            assert result.frame_count == 10
    """
    # Start with default instance and override specific fields
    result = MockExtractResult()
    result.frame_count = frame_count
    result.ocr_box_count = ocr_box_count

    # Apply any additional overrides
    for key, value in kwargs.items():
        if hasattr(result, key):
            setattr(result, key, value)

    return result


def build_crop_infer_result(
    version: int = 1,
    label_counts: Optional[dict[str, int]] = None,
    **kwargs: Any,
) -> MockCropInferResult:
    """
    Build a CropInferResult with custom values.

    Utility function to create CropInferResult instances for specific test scenarios.

    Args:
        version: Cropped frames version
        label_counts: Dictionary of label counts (optional)
        **kwargs: Additional fields to override

    Returns:
        MockCropInferResult instance

    Example:
        def test_inference_labels():
            result = build_crop_infer_result(
                version=2,
                label_counts={"caption_start": 10, "caption_end": 10, "no_change": 80}
            )
            assert result.label_counts["caption_start"] == 10
    """
    defaults = {
        "version": version,
        "label_counts": label_counts,
    }
    defaults.update(kwargs)
    return MockCropInferResult(**defaults)


# =============================================================================
# Integration Test Markers
# =============================================================================


def pytest_configure(config):
    """
    Register custom markers for integration tests.

    Markers:
        integration: Mark test as an integration test
        slow: Mark test as slow-running (>1 second)
        external: Mark test as requiring external services (skip in CI)
    """
    config.addinivalue_line("markers", "integration: mark test as an integration test")
    config.addinivalue_line("markers", "slow: mark test as slow-running (>1 second)")
    config.addinivalue_line(
        "markers", "external: mark test as requiring external services (skip in CI)"
    )
