# Interface Usage Examples

This document shows how to use the interface contracts in code.

## Modal Function Usage (from Prefect flows)

```python
# In a Prefect flow that calls Modal functions
import modal
from captionacc_modal import (
    CropRegion,
    ExtractResult,
    CropInferResult,
    CaptionOcrResult,
)

# Get Modal app handle
modal_app = modal.App.lookup("captionacc-processing")

# Get function handles - these conform to the Protocol interfaces
extract_fn = modal_app.functions["extract_frames_and_ocr"]
crop_infer_fn = modal_app.functions["crop_and_infer_caption_frame_extents"]
caption_ocr_fn = modal_app.functions["generate_caption_ocr"]

# Call functions - return types match the data models
result: ExtractResult = extract_fn.remote(
    video_key="tenant-123/client/videos/video-456/video.mp4",
    tenant_id="tenant-123",
    video_id="video-456",
    frame_rate=0.1
)

# Type checker knows these fields exist
print(f"Extracted {result.frame_count} frames")
print(f"Duration: {result.duration} seconds")
print(f"OCR boxes: {result.ocr_box_count}")
```

## Service Usage (from Prefect flows)

```python
# In a Prefect flow that uses services
from app.services import (
    SupabaseService,
    WasabiService,
    calculate_flow_priority,
)

# Service instances conform to Protocol interfaces
def my_flow(
    supabase: SupabaseService,  # Any object matching protocol works
    wasabi: WasabiService,
    video_id: str,
):
    # Update video status
    supabase.update_video_status(
        video_id=video_id,
        status="processing"
    )

    # Download from Wasabi
    video_bytes = wasabi.download_to_bytes(
        key=f"tenant/client/videos/{video_id}/video.mp4"
    )

    # Calculate priority
    priority = calculate_flow_priority(
        tenant_tier="premium",
        request_time=datetime.now(),
        enable_age_boosting=True  # Default
    )
```

## Type Checking with Protocols

```python
# Modal function implementation must match Protocol
from captionacc_modal.functions import ExtractFramesAndOcr
from captionacc_modal.models import ExtractResult

# This implementation conforms to the Protocol
class MyExtractImpl:
    def __call__(
        self,
        video_key: str,
        tenant_id: str,
        video_id: str,
        frame_rate: float = 0.1,
    ) -> ExtractResult:
        # Implementation here
        return ExtractResult(
            frame_count=100,
            duration=60.0,
            ocr_box_count=50,
            full_frames_key="...",
            ocr_db_key="...",
            layout_db_key="...",
        )

# Type checker validates this conforms to Protocol
def use_extract_fn(fn: ExtractFramesAndOcr):
    result = fn(
        video_key="test.mp4",
        tenant_id="test",
        video_id="test",
    )
    assert isinstance(result, ExtractResult)

# Works with any implementation matching the Protocol
use_extract_fn(MyExtractImpl())
```

## Service Implementation Example

```python
# Service implementation must match Protocol
from app.services import SupabaseService
from typing import Optional

class SupabaseServiceImpl:
    """Concrete implementation of SupabaseService Protocol"""

    def __init__(self, url: str, key: str):
        self.url = url
        self.key = key
        # Initialize Supabase client

    def update_video_status(
        self,
        video_id: str,
        status: Optional[str] = None,
        caption_status: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> None:
        # Implementation here
        pass

    def update_video_metadata(
        self,
        video_id: str,
        frame_count: Optional[int] = None,
        duration_seconds: Optional[float] = None,
        cropped_frames_version: Optional[int] = None,
    ) -> None:
        # Implementation here
        pass

    # ... implement all other methods from Protocol

# Type checker validates this conforms to Protocol
def use_supabase(service: SupabaseService):
    service.update_video_status(
        video_id="test",
        status="processing"
    )

# Works with any implementation matching the Protocol
use_supabase(SupabaseServiceImpl(url="...", key="..."))
```

## Benefits of Code-Based Interfaces

1. **Type Safety:**
   ```python
   # Type checker catches this error
   result = extract_fn.remote(
       video_key="test.mp4",
       # Missing required parameters!
   )
   # Error: Missing required keyword-only arguments
   ```

2. **IDE Autocomplete:**
   ```python
   result: ExtractResult = extract_fn.remote(...)
   result.  # IDE shows: frame_count, duration, ocr_box_count, etc.
   ```

3. **Refactoring Safety:**
   ```python
   # If we rename a field in ExtractResult:
   @dataclass
   class ExtractResult:
       num_frames: int  # Renamed from frame_count

   # All usages are caught by type checker:
   print(result.frame_count)  # Error: ExtractResult has no attribute frame_count
   ```

4. **Documentation in Code:**
   ```python
   # Hover over function in IDE shows full docstring
   extract_fn.remote(...)
   # Shows: Extract frames from video and run OCR...
   ```

5. **Testable Contracts:**
   ```python
   def test_extract_result_contract():
       """Verify ExtractResult has required fields"""
       result = ExtractResult(
           frame_count=1,
           duration=1.0,
           ocr_box_count=0,
           full_frames_key="",
           ocr_db_key="",
           layout_db_key="",
       )
       assert hasattr(result, 'frame_count')
       assert hasattr(result, 'duration')
   ```

## Parallel Development Workflow

Developer 1 (Modal function implementer):
```python
# Can import and implement against Protocol
from captionacc_modal.functions import ExtractFramesAndOcr
from captionacc_modal.models import ExtractResult

@app.function(gpu="T4", timeout=1800)
def extract_frames_and_ocr(...) -> ExtractResult:
    # Implementation here
    pass
```

Developer 2 (Flow implementer):
```python
# Can write flow code using Protocol types
from captionacc_modal import ExtractResult

def my_flow():
    # Type checker knows result is ExtractResult
    result: ExtractResult = extract_fn.remote(...)

    # Can use fields before implementation exists
    print(result.frame_count)
```

Both can work in parallel - type checker validates the contract!
