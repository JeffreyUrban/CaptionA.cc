# Interface Contracts Review

This document summarizes all interface contracts for parallel implementation. Review and approve before starting parallel work streams.

## 1. Modal Function Interfaces

**Location:** `/data-pipelines/captionacc-modal/src/captionacc_modal/models.py`

### Data Models

```python
@dataclass
class CropRegion:
    """Normalized crop region coordinates (0.0 to 1.0)"""
    crop_left: float
    crop_top: float
    crop_right: float
    crop_bottom: float

@dataclass
class ExtractResult:
    """Result from extract_frames_and_ocr Modal function"""
    frame_count: int              # Total frames extracted
    duration: float               # Video duration in seconds
    ocr_box_count: int           # Total OCR detections
    full_frames_key: str         # S3 path to full_frames/
    ocr_db_key: str              # S3 path to raw-ocr.db.gz
    layout_db_key: str           # S3 path to layout.db.gz

@dataclass
class CropInferResult:
    """Result from crop_and_infer_caption_frame_extents Modal function"""
    version: int                 # Cropped frames version number
    frame_count: int             # Number of frames in output
    caption_frame_extents_count: int     # Number of caption frame extents detected
    caption_frame_extents_db_key: str    # S3 path to caption_frame_extents.db
    cropped_frames_prefix: str   # S3 path prefix to cropped_frames_v{N}/

@dataclass
class CaptionOcrResult:
    """Result from generate_caption_ocr Modal function"""
    ocr_text: str                # Extracted text
    confidence: float            # OCR confidence (0.0 to 1.0)
    frame_count: int             # Frames used to generate median
    median_frame_index: Optional[int] = None  # Debug info
```

### Function Signatures

```python
# Function 1: Extract frames and OCR (T4 GPU, 30 min timeout)
def extract_frames_and_ocr(
    video_key: str,
    tenant_id: str,
    video_id: str,
    frame_rate: float = 0.1
) -> ExtractResult

# Function 2: Crop and infer caption frame extents (A10G GPU, 60 min timeout)
def crop_and_infer_caption_frame_extents(
    video_key: str,
    tenant_id: str,
    video_id: str,
    crop_region: CropRegion,
    frame_rate: float = 10.0
) -> CropInferResult

# Function 3: Generate caption OCR (T4 GPU, 5 min timeout)
def generate_caption_ocr(
    chunks_prefix: str,
    start_frame: int,
    end_frame: int
) -> CaptionOcrResult
```

---

## 2. Supabase Service Interface

**Location:** `/services/api/app/services/supabase_service.py`

### Protocol Definition

```python
class SupabaseService(Protocol):
    """Interface for Supabase database operations"""

    # Video status updates
    def update_video_status(
        self,
        video_id: str,
        status: Optional[str] = None,           # uploading, processing, active, error
        caption_status: Optional[str] = None,   # processing, ready, error
        error_message: Optional[str] = None
    ) -> None

    def update_video_metadata(
        self,
        video_id: str,
        frame_count: Optional[int] = None,
        duration_seconds: Optional[float] = None,
        cropped_frames_version: Optional[int] = None
    ) -> None

    # Server lock management
    def acquire_server_lock(
        self,
        video_id: str,
        database_name: str,          # 'layout', 'captions'
        lock_type: str,              # 'processing', 'inference'
        lock_holder_user_id: Optional[str] = None,
        timeout_seconds: int = 300
    ) -> bool

    def release_server_lock(
        self,
        video_id: str,
        database_name: str
    ) -> None

    # Caption operations
    def update_caption_ocr_status(
        self,
        video_id: str,
        caption_id: int,
        status: str,                # queued, processing, completed, error
        caption_ocr: Optional[str] = None,
        confidence: Optional[float] = None,
        error_message: Optional[str] = None
    ) -> None

    # Tenant information
    def get_tenant_tier(self, tenant_id: str) -> str  # free, premium, enterprise

    def get_video_metadata(self, video_id: str) -> dict
```

**Implementation:** Extract from `/services/orchestrator/supabase_client.py`

---

## 3. Wasabi Service Interface

**Location:** `/services/api/app/services/wasabi_service.py`

### Protocol Definition

```python
class WasabiService(Protocol):
    """Interface for Wasabi S3 storage operations"""

    # Upload operations
    def upload_file(
        self,
        key: str,
        data: bytes | BinaryIO,
        content_type: Optional[str] = None
    ) -> str

    def upload_from_path(
        self,
        key: str,
        local_path: Path | str,
        content_type: Optional[str] = None
    ) -> str

    # Download operations
    def download_file(self, key: str, local_path: Path | str) -> None

    def download_to_bytes(self, key: str) -> bytes

    # Delete operations
    def delete_file(self, key: str) -> None

    def delete_prefix(self, prefix: str) -> int  # Returns count deleted

    # Existence checks
    def file_exists(self, key: str) -> bool

    # List operations
    def list_files(
        self,
        prefix: str,
        max_keys: Optional[int] = None
    ) -> list[str]

    # URL generation
    def generate_presigned_url(
        self,
        key: str,
        expiration_seconds: int = 3600
    ) -> str
```

**Implementation:** Extract from `/services/orchestrator/wasabi_client.py`

---

## 4. Priority Service

**Location:** `/services/api/app/services/priority_service.py`

### Concrete Implementation

```python
class TenantTier(IntEnum):
    """Base priority by tenant tier"""
    FREE = 50
    PREMIUM = 70
    ENTERPRISE = 90

def calculate_flow_priority(
    tenant_tier: str,
    request_time: Optional[datetime] = None,
    video_size_bytes: Optional[int] = None,
    enable_age_boosting: bool = True,           # Default enabled
    base_priority_override: Optional[int] = None
) -> int:
    """
    Calculate dynamic priority (0-100, higher = more urgent)

    Priority factors:
    - Base: Tenant tier (FREE=50, PREMIUM=70, ENTERPRISE=90)
    - Age boost: +2 per hour, capped at +20 (default enabled)
    - Small video: +5 if < 50MB
    - Override: Optional base priority for testing

    Returns: Priority value (0-100)
    """
    pass  # Implementation provided in file

def get_priority_tags(
    priority: int,
    tenant_id: str,
    tenant_tier: str,
    age_boosting_enabled: bool
) -> list[str]:
    """Generate Prefect tags for observability"""
    pass  # Implementation provided in file
```

**Status:** ✅ Complete implementation (no extraction needed)

---

## 5. Flow Interfaces (Depend on Above)

These will be implemented **after** the above interfaces are complete:

```python
# Flow 1: Video initial processing
@flow(name="captionacc-video-initial-processing")
def captionacc_video_initial_processing(
    video_id: str,
    tenant_id: str,
    storage_key: str
) -> dict:
    """
    Calls: Modal extract_frames_and_ocr()
    Uses: SupabaseService, WasabiService
    """
    pass

# Flow 2: Crop and infer caption frame extents
@flow(name="captionacc-crop-and-infer-caption-frame-extents")
def captionacc_crop_and_infer_caption_frame_extents(
    video_id: str,
    tenant_id: str,
    crop_region: dict
) -> dict:
    """
    Calls: Modal crop_and_infer_caption_frame_extents()
    Uses: SupabaseService (lock management), WasabiService
    """
    pass

# Flow 3: Caption OCR
@flow(name="captionacc-caption-ocr")
def captionacc_caption_ocr(
    tenant_id: str,
    video_id: str,
    caption_id: int,
    start_frame: int,
    end_frame: int,
    version: int
) -> dict:
    """
    Calls: Modal generate_caption_ocr()
    Uses: SupabaseService, WasabiService
    """
    pass
```

---

## Review Checklist

### Modal Interfaces ✅
- [ ] `CropRegion` dataclass structure
- [ ] `ExtractResult` return fields
- [ ] `CropInferResult` return fields
- [ ] `CaptionOcrResult` return fields
- [ ] Function signatures match documentation
- [ ] GPU types and timeouts appropriate

### Service Interfaces ✅
- [ ] SupabaseService covers all database operations
- [ ] WasabiService covers all S3 operations
- [ ] Priority service supports flexible age boosting
- [ ] Method signatures are clear and unambiguous
- [ ] Return types are specified

### Documentation ✅
- [ ] Modal function contract document is clear
- [ ] Processing steps documented for each function
- [ ] Wasabi output paths specified
- [ ] Error handling guidelines provided

---

## Parallel Work Assignments

Once approved, these work streams can proceed in parallel:

### Stream 1: Modal Functions (3 developers)
- **Dev 1:** Implement `extract_frames_and_ocr`
- **Dev 2:** Implement `crop_and_infer_caption_frame_extents`
- **Dev 3:** Implement `generate_caption_ocr`

**Dependencies:** Package structure + agreed interfaces only

### Stream 2: Service Extraction (2-3 developers)
- **Dev 1:** Extract and adapt Supabase service
- **Dev 2:** Extract and adapt Wasabi service
- **Dev 3:** Test priority service (already implemented)

**Dependencies:** None (can start immediately)

### Stream 3: Flow Implementation (3 developers)
**Dependencies:** Streams 1 & 2 complete

- **Dev 1:** Implement `video_initial_processing` flow
- **Dev 2:** Implement `crop_and_infer` flow
- **Dev 3:** Implement `caption_ocr` flow

### Stream 4: API Integration (2 developers)
**Dependencies:** Stream 3 complete

- **Dev 1:** Webhook handler + Prefect agent integration
- **Dev 2:** API endpoints + configuration

---

## Next Steps

1. **Review this document** - Ensure all interfaces are correct
2. **Approve contracts** - Sign off on interfaces before implementation
3. **Create package structure** - Set up Modal package skeleton
4. **Begin parallel work** - Start Streams 1 & 2 simultaneously
5. **Integration testing** - After all streams complete

---

## Questions for Review

1. **Modal interfaces:**
   - Are return types sufficient for flow needs?
   - Should we add more metadata fields?
   - Are timeout values appropriate?

2. **Service interfaces:**
   - Are we missing any database operations?
   - Should lock management be more granular?
   - Do we need additional Wasabi operations?

3. **Priority service:**
   - Is age boosting formula appropriate? (2 points per hour, cap at 20)
   - Should small video threshold be different? (currently 50MB)
   - Do we need additional priority factors?

4. **Error handling:**
   - Should Modal functions return partial results on error?
   - How should flows handle lock acquisition timeout?
   - Retry strategies appropriate?
