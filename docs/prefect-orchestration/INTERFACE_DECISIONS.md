# Interface Design Decisions

This document records all design decisions made during interface contract review.

## 1. ExtractResult - Enhanced Metadata ✅

**Decision:** Add video metadata and performance metrics to ExtractResult

**Fields Added:**
```python
@dataclass
class ExtractResult:
    # Video metadata (NEW)
    frame_width: int
    frame_height: int
    video_codec: str
    bitrate: int

    # OCR statistics (NEW)
    failed_ocr_count: int

    # Performance metrics (NEW)
    processing_duration_seconds: float

    # Existing fields...
    frame_count: int
    duration: float
    ocr_box_count: int
    full_frames_key: str
    ocr_db_key: str
    layout_db_key: str
```

**Rationale:**
- One-time operation (first thing we do with video)
- Provides visibility for monitoring and debugging
- Video metadata useful for display and validation
- Performance metrics help identify bottlenecks

---

## 2. CropInferResult - Label Counts Instead of Total ✅

**Decision:** Replace `caption_frame_extents_count` with `label_counts` dictionary

**Changed:**
```python
# BEFORE
caption_frame_extents_count: int  # Just total count

# AFTER
label_counts: dict[str, int]  # Count per label
# Example: {"caption_start": 45, "caption_end": 42, "no_change": 1200}
```

**Rationale:**
- More useful than total count (which is redundant with DB data)
- Provides insight into model behavior (distribution of predictions)
- Helps identify model issues (e.g., all predictions are "no_change")
- No additional cost (must count anyway to compute total)

**Also Added:**
```python
processing_duration_seconds: float  # For performance monitoring
```

---

## 3. Lock Management - Simplified ✅

**Decision:** Remove `lock_type` parameter, keep per-database granularity

**Interface:**
```python
def acquire_server_lock(
    video_id: str,
    database_name: str,                      # 'layout', 'captions'
    lock_holder_user_id: Optional[str] = None,  # User or system lock
    timeout_seconds: int = 300               # Reserved for future
) -> bool  # True if acquired, False if already locked
```

**Key Points:**
- **Granularity:** Per-database (can lock `layout.db` independently of `captions.db`)
- **Lock type removed:** Not needed - purpose is implicit in operation
- **System vs user:** Handled identically (no special behavior)
- **Non-blocking:** Returns immediately if already locked
- **timeout_seconds:** Reserved for future blocking behavior

**Usage:**
```python
# In crop-and-infer flow
if not acquire_server_lock(video_id, "layout"):
    raise Exception("Video is currently being processed")

try:
    # Process video
    pass
finally:
    release_server_lock(video_id, "layout")
```

---

## 4. Priority Calculation - Configurable Age Boosting ✅

**Decision:** Make age boosting rate and cap configurable per-request

**Interface:**
```python
def calculate_flow_priority(
    tenant_tier: str,
    request_time: Optional[datetime] = None,
    enable_age_boosting: bool = True,
    age_boost_per_minutes: int = 60,      # +1 point per N minutes (NEW)
    age_boost_cap: int = 20,              # Maximum age boost points (NEW)
    base_priority_override: Optional[int] = None
) -> int
```

**Default Behavior:**
- **Rate:** +1 priority point per 60 minutes (1 hour)
- **Cap:** Maximum +20 points (after 20 hours)
- **Result:** Free tier (50) catches up to fresh Premium (70) in 20 hours

**Examples:**
```python
# Standard: +1 per hour, cap at 20
priority = calculate_flow_priority("free", request_time, age_boost_per_minutes=60, age_boost_cap=20)

# Faster boost: +1 per 30 minutes, cap at 30
priority = calculate_flow_priority("premium", request_time, age_boost_per_minutes=30, age_boost_cap=30)

# Disable age boosting for batch jobs
priority = calculate_flow_priority("enterprise", enable_age_boosting=False)
```

**Removed:**
- ~~`video_size_bytes` parameter~~ - Size doesn't predict processing time well
- ~~Small video boost (+5 if < 50MB)~~ - Not valuable enough to justify complexity

---

## 5. Caption OCR Updates - API Endpoint Pattern ✅

**Decision:** Use dedicated CaptionService with API endpoint management

**Approach:**
- **NOT in SupabaseService** - Caption updates involve Wasabi file operations
- **NEW CaptionService** - Dedicated service for caption database operations
- **API decides when to download/upload** - Smart caching and transaction management

**Interface:**
```python
class CaptionService(Protocol):
    def update_caption_ocr(
        self,
        video_id: str,
        tenant_id: str,
        caption_id: int,
        ocr_text: str,
        confidence: float,
    ) -> None:
        """
        Update caption OCR text in captions.db.

        Implementation:
        1. Download captions.db.gz from Wasabi (if not cached)
        2. Decompress to SQLite
        3. Update caption record
        4. Compress to gzip
        5. Upload to Wasabi
        6. Invalidate client caches
        """
```

**Key Points:**
- **captions.db contains OCR text** - Authoritative source for caption content
- **API manages lifecycle** - Caching, batching, transaction boundaries
- **Wasabi is source of truth** - Not Supabase (client needs offline access)

**Flow Usage:**
```python
# In caption-ocr flow
caption_service.update_caption_ocr(
    video_id=video_id,
    tenant_id=tenant_id,
    caption_id=caption_id,
    ocr_text=result.ocr_text,
    confidence=result.confidence
)
```

---

## 6. Error Handling - Fail Fast ✅

**Decision:** Modal functions fail fast, no partial results (initially)

**Current Approach:**
```python
# If OCR fails on any frame
raise RuntimeError("OCR failed on frame 23: timeout")

# Orchestration flow handles retry
# No partial data uploaded to Wasabi
```

**Rationale:**
- Simpler error handling in flows
- Clear failure signals
- No partial/incomplete data in storage
- Most errors are transient (retries succeed)

**Future Enhancement (documented in code):**
```python
# Potential future enhancement for resilience
@dataclass
class ExtractResult:
    # ... existing fields ...
    partial: bool = False           # NEW: Indicates partial success
    errors: list[str] = []          # NEW: Per-frame error messages

# Allows flows to accept partial results when appropriate
# Example: 95 frames succeeded, 5 failed OCR
```

**Documentation Location:**
- `/data-pipelines/captionacc-modal/src/captionacc_modal/functions.py`
- Includes rationale and future enhancement notes

---

## 7. Lock Acquisition - Non-Blocking ✅

**Decision:** Immediate return (non-blocking), caller decides retry strategy

**Behavior:**
```python
def acquire_server_lock(
    video_id: str,
    database_name: str,
    lock_holder_user_id: Optional[str] = None,
    timeout_seconds: int = 300  # Reserved for future blocking behavior
) -> bool:
    """
    Non-blocking lock acquisition.
    Returns immediately: True if acquired, False if already locked.
    """
```

**Usage Pattern:**
```python
# Option 1: Fail fast
if not acquire_server_lock(video_id, "layout"):
    raise Exception("Video is currently being processed")

# Option 2: Retry at flow level (let Prefect handle it)
# Flow automatically retries on exception

# Option 3: Custom retry logic
for attempt in range(3):
    if acquire_server_lock(video_id, "layout"):
        break
    time.sleep(5)
else:
    raise Exception("Could not acquire lock after 3 attempts")
```

**Rationale:**
- Predictable behavior (no hidden waiting)
- Flow decides retry strategy
- Simpler implementation
- Can add blocking behavior later via timeout_seconds parameter

---

## 8. Wasabi Delete Safety - Trust Caller ✅

**Decision:** No special safety checks for delete_prefix (programmatic use only)

**Implementation:**
```python
def delete_prefix(self, prefix: str) -> int:
    """
    Delete all files with given prefix.

    Warning:
        Destructive operation - deletes ALL files matching prefix.
        Caller is responsible for providing correct prefix.
        No safety checks performed - programmatic use only.
    """
    return self._delete_all(prefix)
```

**Rationale:**
- Programmatic use only (not exposed to end users)
- Developers understand the consequences
- Typos are not a concern in code (would be caught in testing)
- No need for artificial restrictions that slow down legitimate operations
- Standard boto3 S3 behavior (no special safety in AWS SDK)

**Best Practices:**
```python
# Construct prefix carefully
prefix = f"{tenant_id}/client/videos/{video_id}/cropped_frames_v{version}/"

# Optional: Log before delete
logger.warning(f"Deleting all files with prefix: {prefix}")
deleted_count = wasabi.delete_prefix(prefix)
logger.info(f"Deleted {deleted_count} files")
```

---

## 9. Priority API Endpoints - Not Implemented ✅

**Decision:** Do not expose priority calculation/inspection via API endpoints

**Potential endpoints NOT implemented:**
```python
# NOT implementing (for now)
GET /priorities/calculate
GET /flows/{flow_run_id}/priority
PATCH /flows/{flow_run_id}/priority
```

**Rationale:**
- Priority should be mostly invisible to users
- Adds API surface area without clear need
- Manual overrides bypass the fairness system
- Can add later if support requests show value

**Alternative:**
- Monitor priority in Prefect UI via tags
- Support can inspect via Prefect dashboard
- Admin can manually trigger flows if needed (separate from priority)

---

## Summary Table

| # | Decision | Status | Rationale |
|---|----------|--------|-----------|
| 1 | Add video metadata to ExtractResult | ✅ Implemented | One-time collection, valuable for visibility |
| 2 | Label counts vs total count | ✅ Implemented | More useful, same cost |
| 3 | Remove lock_type parameter | ✅ Implemented | Unnecessary distinction |
| 4 | Configurable age boosting | ✅ Implemented | Flexibility for different use cases |
| 4 | Remove small video boost | ✅ Implemented | Size doesn't predict processing time |
| 5 | CaptionService for OCR updates | ✅ Implemented | Proper separation of concerns |
| 6 | Fail-fast error handling | ✅ Documented | Simpler, can enhance later |
| 7 | Non-blocking lock acquisition | ✅ Implemented | Caller decides retry strategy |
| 8 | No delete_prefix safety checks | ✅ Implemented | Programmatic use, trust caller |
| 9 | No priority API endpoints | ✅ Decided | Priority should be invisible to users |

---

## Files Updated

### Modal Package
- `/data-pipelines/captionacc-modal/src/captionacc_modal/models.py`
  - Added fields to ExtractResult
  - Changed CropInferResult to use label_counts

- `/data-pipelines/captionacc-modal/src/captionacc_modal/functions.py`
  - Added error handling strategy documentation
  - Documented fail-fast approach and future partial results

### API Services
- `/services/api/app/services/supabase_service.py`
  - Removed lock_type parameter
  - Removed update_caption_ocr_status (moved to CaptionService)
  - Updated documentation

- `/services/api/app/services/priority_service.py`
  - Added age_boost_per_minutes parameter
  - Added age_boost_cap parameter
  - Removed video_size_bytes parameter
  - Updated examples

- `/services/api/app/services/caption_service.py` (NEW)
  - CaptionService protocol for caption database operations
  - Documents download/modify/upload lifecycle

- `/services/api/app/services/wasabi_service.py`
  - Documented minimum prefix length requirement (to be implemented)
  - Documented logging requirements

---

## Next Steps

All interface contracts are now finalized and implemented in code. Ready to proceed with parallel implementation:

1. **Modal functions** - Implement against these exact interfaces
2. **Service extraction** - Extract from orchestrator matching these protocols
3. **Flow implementation** - Use these interfaces in flow code
4. **API integration** - Call flows with proper priority calculation

No further interface changes expected during implementation phase.
