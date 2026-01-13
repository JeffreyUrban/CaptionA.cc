# Interface Contracts - FINALIZED

**Status:** ✅ All interface contracts approved and ready for parallel implementation

**Date:** 2026-01-12

---

## Contract Files (Source of Truth)

All interfaces are defined in **executable Python code** with full type hints and documentation:

### Modal Functions
**Location:** `/data-pipelines/captionacc-modal/src/captionacc_modal/`

1. **`models.py`** - Data models:
   - `CropRegion` - Normalized crop coordinates with validation
   - `ExtractResult` - Frame extraction + OCR results (with video metadata and performance metrics)
   - `CropInferResult` - Cropping + inference results (with label counts and performance metrics)
   - `CaptionOcrResult` - OCR results with confidence

2. **`functions.py`** - Function protocols:
   - `ExtractFramesAndOcr` - T4 GPU, 30min timeout
   - `CropAndInferCaptionFrameExtents` - A10G GPU, 60min timeout
   - `GenerateCaptionOcr` - T4 GPU, 5min timeout

### API Services
**Location:** `/services/api/app/services/`

1. **`supabase_service.py`** - SupabaseService protocol:
   - Video status and metadata updates
   - Server lock management (non-blocking, per-database)
   - Tenant tier lookup

2. **`wasabi_service.py`** - WasabiService protocol:
   - Upload/download operations
   - Delete operations (trust caller, no safety checks)
   - File existence and listing
   - Presigned URL generation

3. **`caption_service.py`** - CaptionService protocol:
   - Caption OCR updates (API manages download/modify/upload)
   - Caption status updates

4. **`priority_service.py`** - Concrete implementation:
   - `calculate_flow_priority()` - Configurable age boosting
   - `get_priority_tags()` - Observability tags
   - `TenantTier` enum

---

## Key Design Decisions

### 1. Enhanced ExtractResult ✅
```python
@dataclass
class ExtractResult:
    # Video metadata
    frame_count: int
    duration: float
    frame_width: int           # NEW
    frame_height: int          # NEW
    video_codec: str           # NEW
    bitrate: int               # NEW

    # OCR statistics
    ocr_box_count: int
    failed_ocr_count: int      # NEW

    # Performance
    processing_duration_seconds: float  # NEW

    # Storage paths
    full_frames_key: str
    ocr_db_key: str
    layout_db_key: str
```

### 2. Label Counts in CropInferResult ✅
```python
@dataclass
class CropInferResult:
    version: int
    frame_count: int
    label_counts: dict[str, int]  # Changed from single count
    # Example: {"caption_start": 45, "caption_end": 42, "no_change": 1200}
    processing_duration_seconds: float  # NEW
    caption_frame_extents_db_key: str
    cropped_frames_prefix: str
```

### 3. Simplified Lock Management ✅
```python
def acquire_server_lock(
    video_id: str,
    database_name: str,           # Per-database granularity
    lock_holder_user_id: Optional[str] = None,
    timeout_seconds: int = 300    # Reserved for future
) -> bool  # Non-blocking: immediate return
```
- Removed: `lock_type` parameter
- Behavior: Non-blocking, returns False if already locked
- System and user locks treated identically

### 4. Configurable Priority ✅
```python
def calculate_flow_priority(
    tenant_tier: str,
    request_time: Optional[datetime] = None,
    enable_age_boosting: bool = True,
    age_boost_per_minutes: int = 60,    # +1 point per N minutes
    age_boost_cap: int = 20,            # Max boost points
    base_priority_override: Optional[int] = None
) -> int
```
- Removed: `video_size_bytes` parameter
- Default: +1 point per 60 minutes, cap at 20 points

### 5. CaptionService for Updates ✅
```python
class CaptionService(Protocol):
    def update_caption_ocr(
        video_id: str,
        tenant_id: str,
        caption_id: int,
        ocr_text: str,
        confidence: float,
    ) -> None
```
- API endpoint manages download/modify/upload of captions.db
- captions.db contains OCR text (authoritative source)

### 6. Fail-Fast Error Handling ✅
- Modal functions raise exceptions on errors
- No partial results returned
- Future enhancement documented for partial results
- Location: `/data-pipelines/captionacc-modal/src/captionacc_modal/functions.py`

### 7. Wasabi Delete - Trust Caller ✅
```python
def delete_prefix(prefix: str) -> int:
    """
    Warning: Destructive operation - deletes ALL files.
    No safety checks - programmatic use only.
    """
```
- No prefix length restrictions
- No confirmation required
- Standard boto3 behavior

### 8. No Priority API ✅
- Priority calculation not exposed via API endpoints
- Priority should be invisible to users
- Can add later if support needs arise

---

## Parallel Implementation Ready

With all interfaces finalized, these work streams can proceed **in parallel**:

### Stream 1: Modal Functions (3 developers)
✅ **Ready:** All function protocols and data models defined
- Dev 1: Implement `extract_frames_and_ocr`
- Dev 2: Implement `crop_and_infer_caption_frame_extents`
- Dev 3: Implement `generate_caption_ocr`

**Dependencies:** None (interfaces are complete)

### Stream 2: Service Extraction (3 developers)
✅ **Ready:** All service protocols defined
- Dev 1: Extract and adapt SupabaseService
- Dev 2: Extract and adapt WasabiService
- Dev 3: Implement CaptionService

**Dependencies:** None (can extract from orchestrator service)

### Stream 3: Flow Implementation (3 developers)
✅ **Ready:** After Streams 1 & 2 complete
- Dev 1: Implement `video_initial_processing` flow
- Dev 2: Implement `crop_and_infer` flow
- Dev 3: Implement `caption_ocr` flow

**Dependencies:** Modal function and service interfaces (already defined)

### Stream 4: API Integration (2 developers)
✅ **Ready:** After Stream 3 complete
- Dev 1: Webhook handler + Prefect agent integration
- Dev 2: API endpoints + configuration

**Dependencies:** Flows must be defined

---

## Type Safety Guarantees

All interfaces use Python Protocols for structural typing:

```python
# Modal implementations must match protocols
from captionacc_modal.functions import ExtractFramesAndOcr

@app.function(gpu="T4", timeout=1800)
def extract_frames_and_ocr(...) -> ExtractResult:
    # Implementation validates against protocol
    pass

# Service implementations must match protocols
from app.services import SupabaseService

class SupabaseServiceImpl:
    # Methods validate against protocol
    def update_video_status(...) -> None:
        pass
```

**Benefits:**
- Type checker validates all implementations
- IDE provides autocomplete and hover docs
- Refactoring is safe (all usages updated)
- Implementations can be tested in isolation

---

## Documentation

### Code Documentation (Source of Truth)
- `/data-pipelines/captionacc-modal/src/captionacc_modal/models.py`
- `/data-pipelines/captionacc-modal/src/captionacc_modal/functions.py`
- `/services/api/app/services/supabase_service.py`
- `/services/api/app/services/wasabi_service.py`
- `/services/api/app/services/caption_service.py`
- `/services/api/app/services/priority_service.py`

### Supporting Documentation
- `/docs/prefect-orchestration/INTERFACE_DECISIONS.md` - All design decisions
- `/docs/prefect-orchestration/INTERFACE_USAGE_EXAMPLE.md` - Usage examples
- `/data-pipelines/captionacc-modal/INTERFACE_CONTRACT.md` - Modal function details

---

## Review Checklist

- [x] Modal data models complete with all fields
- [x] Modal function protocols with exact signatures
- [x] Service protocols with all required methods
- [x] Priority service with configurable age boosting
- [x] CaptionService for OCR updates
- [x] Lock management simplified (non-blocking)
- [x] Error handling strategy documented
- [x] All decisions documented with rationale
- [x] Usage examples provided
- [x] Type hints complete
- [x] Docstrings comprehensive

---

## Next Steps

1. ✅ **Interfaces finalized** - No further changes expected
2. 🟡 **Begin parallel implementation** - Streams 1 & 2 can start immediately
3. ⏳ **Stream 3 after 1 & 2** - Flow implementation
4. ⏳ **Stream 4 after 3** - API integration
5. ⏳ **Integration testing** - End-to-end verification
6. ⏳ **Deployment** - Production rollout

---

## Questions or Clarifications

For any questions during implementation:
1. Check the Protocol definition in code (source of truth)
2. Review INTERFACE_DECISIONS.md for rationale
3. Check usage examples in INTERFACE_USAGE_EXAMPLE.md
4. If still unclear, ask before implementing (don't guess)

**All interfaces are frozen - changes require coordination across all teams.**
