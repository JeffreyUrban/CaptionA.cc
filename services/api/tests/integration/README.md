# Integration Test Fixtures

This directory contains integration test fixtures and utilities for testing service orchestration without calling external APIs.

## Available Fixtures

### Environment Variables

- `mock_env_vars`: Sets up test environment variables (Supabase, Prefect, Modal, Wasabi)
- `integration_test_config`: Configuration dictionary derived from environment variables

### Mock Services

- `mock_supabase_service`: Mock Supabase service with pre-configured responses
- `mock_prefect_client`: Mock Prefect httpx.AsyncClient for API calls
- `mock_modal_app`: Mock Modal App with function lookup

### Mock Results

- `mock_extract_result`: Mock result from Modal `extract_frames_and_ocr` function
- `mock_crop_infer_result`: Mock result from Modal `crop_and_infer_caption_frame_extents` function
- `mock_caption_ocr_result`: Mock result from Modal `generate_caption_ocr` function

### Test Data

- `mock_video_record`: Sample video record from Supabase
- `mock_tenant_record`: Sample tenant record from Supabase

## Builder Functions

Use these to create custom test data:

```python
from tests.integration.conftest import (
    build_video_record,
    build_tenant_record,
    build_extract_result,
    build_crop_infer_result,
)

# Create custom video record
video = build_video_record(
    video_id="custom-video",
    status="error",
    error_message="Processing failed"
)

# Create custom tenant record
tenant = build_tenant_record(
    tenant_id="free-tenant",
    subscription_tier="free",
    video_count=3
)

# Create custom extract result
extract = build_extract_result(
    frame_count=100,
    ocr_box_count=50
)

# Create custom crop/infer result
crop = build_crop_infer_result(
    version=2,
    label_counts={"caption_start": 10, "caption_end": 10, "no_change": 80}
)
```

## Example Usage

### Testing a Flow with Mock Services

```python
import pytest
from unittest.mock import patch

@pytest.mark.integration
async def test_video_processing_flow(
    mock_env_vars,
    mock_supabase_service,
    mock_modal_app,
    mock_extract_result
):
    """Test video processing flow with mocked services."""
    
    with patch('app.flows.video_initial_processing.SupabaseServiceImpl', 
               return_value=mock_supabase_service), \
         patch('app.flows.video_initial_processing.modal.App.lookup',
               return_value=mock_modal_app):
        
        # Run the flow
        result = await video_initial_processing(
            video_id="video-123",
            tenant_id="tenant-456",
            storage_key="tenant-456/client/videos/video-123/video.mp4"
        )
        
        # Verify service interactions
        assert mock_supabase_service.update_video_status.called
        assert result["frame_count"] == mock_extract_result.frame_count
```

### Testing with Custom Data

```python
@pytest.mark.integration
def test_with_custom_video(mock_supabase_service):
    """Test with custom video record."""
    from tests.integration.conftest import build_video_record
    
    # Create custom video for this test
    video = build_video_record(
        video_id="test-video",
        status="processing",
        duration_seconds=60.0
    )
    
    # Configure mock to return custom video
    mock_supabase_service.get_video_metadata.return_value = video
    
    # Test code here
    metadata = mock_supabase_service.get_video_metadata("test-video")
    assert metadata["duration_seconds"] == 60.0
```

## Mock Dataclasses

Direct instantiation is also available:

```python
from tests.integration.conftest import (
    MockExtractResult,
    MockCropInferResult,
    MockCaptionOcrResult,
)

# Create mock result objects directly
extract = MockExtractResult(
    frame_count=500,
    ocr_box_count=200,
    duration=50.0
)

crop = MockCropInferResult(
    version=3,
    frame_count=500
)

ocr = MockCaptionOcrResult(
    ocr_text="Custom caption",
    confidence=0.88
)
```

## Test Markers

Use these markers to categorize integration tests:

- `@pytest.mark.integration`: Mark as integration test
- `@pytest.mark.slow`: Mark as slow-running (>1 second)
- `@pytest.mark.external`: Mark as requiring external services

## Notes

- All fixtures restore original state after tests (environment variables, etc.)
- Mock services track method calls for verification
- Builder functions provide defaults but accept custom values
- Focus on testing orchestration logic, not external service behavior
