"""Pytest fixtures for Prefect flow tests."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, Mock
from dataclasses import dataclass
import sys

import pytest

# Mock modal and extract_crop_frames_and_infer_extents modules before any imports
sys.modules['modal'] = MagicMock()
sys.modules['extract_crop_frames_and_infer_extents'] = MagicMock()
sys.modules['extract_crop_frames_and_infer_extents.models'] = MagicMock()

from app.services.caption_service import CaptionService
from app.services.supabase_service import SupabaseServiceImpl


# Mock CropRegion and CropInferResult since extract_crop_frames_and_infer_extents is not installed in test environment
@dataclass
class CropRegion:
    """Normalized crop region coordinates (0.0 to 1.0)."""
    crop_left: float
    crop_top: float
    crop_right: float
    crop_bottom: float

    def __post_init__(self):
        """Validate crop region coordinates."""
        assert 0.0 <= self.crop_left < self.crop_right <= 1.0, \
            f"Invalid horizontal crop: {self.crop_left} to {self.crop_right}"
        assert 0.0 <= self.crop_top < self.crop_bottom <= 1.0, \
            f"Invalid vertical crop: {self.crop_top} to {self.crop_bottom}"


@dataclass
class CropInferResult:
    """Result from crop_and_infer_caption_frame_extents Modal function."""
    version: int
    frame_count: int
    label_counts: dict[str, int]
    processing_duration_seconds: float
    caption_frame_extents_db_key: str
    cropped_frames_prefix: str


# Register mock classes with the mocked module
sys.modules['extract_crop_frames_and_infer_extents.models'].CropRegion = CropRegion
sys.modules['extract_crop_frames_and_infer_extents.models'].CropInferResult = CropInferResult


@dataclass
class CaptionOcrResult:
    """Result from generate_caption_ocr Modal function."""
    ocr_text: str
    confidence: float
    frame_count: int
    median_frame_index: int = None


sys.modules['extract_crop_frames_and_infer_extents.models'].CaptionOcrResult = CaptionOcrResult


@dataclass
class ExtractResult:
    """
    Result from extract_frames_and_ocr Modal function.
    Initial video processing: frame extraction + OCR.
    """
    # Video metadata
    frame_count: int
    duration: float
    frame_width: int
    frame_height: int
    video_codec: str
    bitrate: int

    # OCR statistics
    ocr_box_count: int
    failed_ocr_count: int

    # Performance metrics
    processing_duration_seconds: float

    # Wasabi storage keys (outputs uploaded to S3)
    full_frames_key: str
    ocr_db_key: str
    layout_db_key: str


@pytest.fixture
def test_video_id() -> str:
    """Test video ID."""
    return "test-video-789"


@pytest.fixture
def test_tenant_id() -> str:
    """Test tenant ID."""
    return "test-tenant-123"


@pytest.fixture
def test_crop_region_dict() -> dict[str, float]:
    """Test crop region as dictionary."""
    return {
        "crop_left": 0.1,
        "crop_top": 0.2,
        "crop_right": 0.9,
        "crop_bottom": 0.8,
    }


@pytest.fixture
def test_crop_region() -> CropRegion:
    """Test crop region as CropRegion object."""
    return CropRegion(
        crop_left=0.1,
        crop_top=0.2,
        crop_right=0.9,
        crop_bottom=0.8,
    )


@pytest.fixture
def mock_modal_result() -> CropInferResult:
    """Mock result from Modal crop_and_infer_caption_frame_extents function."""
    return CropInferResult(
        version=1,
        frame_count=500,
        label_counts={
            "caption_start": 45,
            "caption_end": 42,
            "no_change": 413,
        },
        processing_duration_seconds=12.5,
        caption_frame_extents_db_key="test-tenant-123/server/videos/test-video-789/caption_frame_extents_v1.db",  # pragma: allowlist secret
        cropped_frames_prefix="test-tenant-123/client/videos/test-video-789/cropped_frames_v1/",
    )


@pytest.fixture
def mock_env_vars(monkeypatch):
    """
    Set up environment variables for flow testing.

    Configures all required environment variables for Prefect flows:
    - Supabase connection (URL and service role key)
    - Wasabi S3 credentials (access key, secret key, bucket name)

    This fixture uses monkeypatch to ensure test isolation.
    """
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    monkeypatch.setenv("WASABI_ACCESS_KEY_ID", "test-access")
    monkeypatch.setenv("WASABI_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("WASABI_BUCKET", "test-bucket")


@pytest.fixture
def mock_supabase_service() -> Mock:
    """
    Mock SupabaseServiceImpl for all flows.

    Provides a Mock with all Supabase service methods:
    - Lock management methods (acquire_server_lock, release_server_lock)
    - Status update methods (update_video_status)
    - Metadata update methods (update_video_metadata)

    Default return values:
    - acquire_server_lock: True (lock acquired successfully)
    - All other methods: None

    Usage:
        def test_flow(mock_supabase_service):
            # Customize behavior as needed
            mock_supabase_service.acquire_server_lock.return_value = False
            # ... test logic
    """
    mock = Mock()

    # Configure default return values
    mock.acquire_server_lock.return_value = True
    mock.release_server_lock.return_value = None
    mock.update_video_status.return_value = None
    mock.update_video_metadata.return_value = None

    return mock


@pytest.fixture
def mock_caption_service() -> Mock:
    """
    Mock CaptionService for caption_ocr flow.

    Provides a Mock with CaptionService methods:
    - update_caption_ocr: Update caption OCR text in captions.db
    - update_caption_status: Update caption processing status

    Default return values:
    - All methods: None

    Usage:
        def test_flow(mock_caption_service):
            # Verify caption OCR update was called
            mock_caption_service.update_caption_ocr.assert_called_once_with(
                video_id="...",
                tenant_id="...",
                caption_id=1,
                ocr_text="Hello world",
                confidence=0.95
            )
    """
    return Mock()


@pytest.fixture
def mock_modal_function() -> MagicMock:
    """
    Mock Modal function with remote.aio method.

    Provides a MagicMock representing a Modal function with an async remote call interface.
    The function has a remote.aio method that returns an AsyncMock for testing async flows.

    Usage:
        def test_flow(mock_modal_function):
            # Configure return value for Modal function call
            mock_modal_function.remote.aio.return_value = mock_result
    """
    mock_fn = MagicMock()
    mock_fn.remote.aio = AsyncMock()
    return mock_fn


@pytest.fixture
def mock_modal_app(mock_modal_function: MagicMock) -> Mock:
    """
    Mock Modal app lookup for all functions.

    Returns a mock Modal app that has a function() method returning mock_modal_function.
    This fixture provides the app returned by modal.App.lookup().

    The mock function includes:
    - remote.aio method for async invocations
    - Configurable return values for testing different scenarios

    Usage:
        def test_flow(mock_modal_app, mock_modal_function):
            # Configure the Modal function return value
            mock_modal_function.remote.aio.return_value = expected_result

            # Run flow - Modal app.function() will return mock_modal_function
            result = await my_flow()
    """
    mock_app = Mock()
    mock_app.function.return_value = mock_modal_function
    return mock_app


@pytest.fixture
def mock_settings() -> Mock:
    """Mock settings object."""
    mock = Mock()
    mock.supabase_url = "https://test.supabase.co"
    mock.supabase_service_role_key = "test-service-role-key"
    mock.supabase_schema = "public"
    return mock


@pytest.fixture
def expected_modal_result_dict() -> dict[str, Any]:
    """Expected dictionary result from Modal function."""
    return {
        "version": 1,
        "frame_count": 500,
        "caption_frame_extents_db_key": "test-tenant-123/server/videos/test-video-789/caption_frame_extents_v1.db",  # pragma: allowlist secret
        "cropped_frames_prefix": "test-tenant-123/client/videos/test-video-789/cropped_frames_v1/",
        "label_counts": {
            "caption_start": 45,
            "caption_end": 42,
            "no_change": 413,
        },
        "processing_duration_seconds": 12.5,
    }


@pytest.fixture
def expected_flow_result() -> dict[str, Any]:
    """Expected result from crop_and_infer flow."""
    return {
        "video_id": "test-video-789",
        "cropped_frames_version": 1,
        "frame_count": 500,
        "status": "completed",
    }
