# Refactor Modal Jobs: GPU + OCR Pipeline

## Overview

Reorganize Modal data pipelines into **separate apps** with **shared libraries** in `packages/`.

**Key Principles:**
- Each Modal app is a separate deployable package in `data-pipelines/`
- Common functionality lives in shared packages (`packages/`)
- Clear, descriptive naming throughout

## Current State (Messy)

```
packages/                      # EXISTING SHARED LIBRARIES
├── gpu_video_utils/           # EXISTS - GPU video decoding, frame extraction
│   └── src/gpu_video_utils/
│       ├── decoder.py         # GPUVideoDecoder
│       └── frame_extraction.py # extract_frames_gpu()
├── ocr_utils/                 # EXISTS - macOS LiveText OCR, needs refactor
│   └── src/ocr_utils/
│       ├── livetext.py        # LiveText backend
│       ├── database.py        # OCR database utilities
│       └── ocr_service_client.py  # DEPRECATED adapter for ocr-service

data-pipelines/
├── captionacc-modal/          # Generic name, mixed responsibilities
│   ├── extract.py             # Full frame OCR (per-frame, not montage-based)
│   ├── inference_pipelined.py # Caption crop + ML inference (crop logic here)
│   ├── ocr.py                 # Caption median OCR (not part of this job)
│   └── app.py                 # Single Modal app with 3 functions
├── full_frames/               # Partial, broken - imports missing module
│   └── modal_inference.py     # References non-existent ocr_google_vision

services/
└── ocr-service/               # DEPRECATED - FastAPI with montage OCR logic
```

## Target State (Clean)

```
packages/                      # SHARED LIBRARIES
├── gpu_video_utils/           # EXISTS - add GPU crop (from inference_pipelined.py) + GPU montage
│   └── src/gpu_video_utils/
│       ├── decoder.py         # GPUVideoDecoder (exists)
│       ├── frame_extraction.py # extract_frames_gpu() - add optional crop parameter (using logic from inference_pipelined.py)
│       ├── montage.py         # GPU-accelerated montage assembly (NEW - PyTorch/CUDA)
│       └── ...
└── ocr/                       # REFACTORED from ocr_utils - general OCR library
    └── src/ocr/
        ├── __init__.py        # Public API exports
        ├── backends/
        │   ├── __init__.py
        │   ├── base.py            # OCRBackend abstract base (process single image)
        │   ├── google_vision.py   # Google Vision API backend (production)
        │   └── livetext.py        # macOS LiveText backend (local dev)
        ├── montage.py         # create_vertical_montage(), distribute_results()
        ├── batch.py           # calculate_max_batch_size() given frame dimensions
        ├── database.py        # Database utilities (from ocr_utils)
        ├── models.py          # OCRResult, BoundingBox, etc.
        └── processing.py      # High-level: batch frames → montage → OCR → distribute

data-pipelines/                # SEPARATE MODAL APPS
├── extract-full-frames-and-ocr/
│   ├── src/extract_full_frames_and_ocr/
│   │   ├── app.py             # Modal app: "extract-full-frames-and-ocr"
│   │   ├── pipeline.py        # Main implementation
│   │   └── models.py
│   ├── deploy.py
│   └── tests/
└── extract-crop-frames-and-infer-extents/
    ├── src/extract_crop_frames_and_infer_extents/
    │   ├── app.py             # Modal app: "extract-crop-frames-and-infer-extents"
    │   ├── pipeline.py        # GPU crop + ML inference (no OCR)
    │   └── models.py
    ├── deploy.py
    └── tests/

services/
└── ocr-service/               # DELETE (replaced by packages/ocr/)
```

## Implementation Steps

### Phase 1: Refactor `packages/ocr_utils/` → `packages/ocr/`

Restructure as a general OCR library with pluggable backends.

**Structure:**
```
packages/ocr/
├── pyproject.toml             # Rename package from ocr_utils to ocr
├── src/ocr/
│   ├── __init__.py            # Public API: OCRProcessor, OCRResult, etc.
│   ├── models.py              # OCRResult, BoundingBox, CharacterResult
│   ├── montage.py             # create_vertical_montage(), distribute_results()
│   ├── batch.py               # calculate_max_batch_size() given frame dimensions
│   ├── database.py            # Keep from ocr_utils (ensure_ocr_table, etc.)
│   ├── processing.py          # High-level: batch frames → montage → OCR → distribute
│   └── backends/
│       ├── __init__.py        # Backend registry, get_backend()
│       ├── base.py            # OCRBackend abstract base class (single image only)
│       ├── google_vision.py   # GoogleVisionBackend (from ocr-service)
│       └── livetext.py        # LiveTextBackend (from ocr_utils)
```

**Key APIs:**
```python
# ocr/__init__.py
class OCRProcessor:
    """High-level OCR processor with backend selection."""
    def __init__(self, backend: str = "google_vision"):
        ...
    def process_images(self, images: list[tuple[str, bytes]]) -> list[OCRResult]:
        """Process images, auto-batching via montage."""

# ocr/montage.py (generic, not backend-specific)
def create_vertical_montage(images: list[bytes], separator_px: int = 2) -> tuple[bytes, list[dict]]:
    """Create vertical montage from images. Returns (montage_bytes, metadata)."""
    ...
def distribute_results_to_images(ocr_result: OCRResult, metadata: list[dict]) -> list[OCRResult]:
    """Distribute OCR results from montage back to individual images."""
    ...

# ocr/batch.py
def calculate_max_batch_size(
    frame_width: int,
    frame_height: int,
    backend: OCRBackend,
) -> int:
    """Calculate max frames per batch given frame dimensions and backend constraints.

    Queries the backend for its constraints (max image dimensions, file size limits, etc.)
    and calculates how many frames can fit in a single montage.
    """
    constraints = backend.get_constraints()  # e.g., max_height, max_file_size
    ...

def calculate_even_batch_size(total_frames: int, max_batch_size: int) -> int:
    """Calculate batch size that distributes frames evenly across batches.

    Given the max batch size, determine the number of batches needed, then
    calculate the batch size that distributes frames most evenly across those batches.

    Example: 100 frames with max_batch_size=30 needs ceil(100/30)=4 batches.
    Even distribution: ceil(100/4)=25 frames per batch.
    """
    if total_frames <= max_batch_size:
        return total_frames
    num_batches = math.ceil(total_frames / max_batch_size)
    return math.ceil(total_frames / num_batches)

# ocr/backends/base.py
class OCRBackend(ABC):
    """Abstract base class for OCR backends. Backends process SINGLE images only."""

    @abstractmethod
    def get_constraints(self) -> dict:
        """Return backend constraints for batch size calculation.

        Returns dict with keys like: max_image_height, max_image_width, max_file_size_bytes
        """
        ...

    @abstractmethod
    def process_single(self, image_bytes: bytes, language: str) -> OCRResult:
        """Process a single image and return OCR results."""
        ...

# ocr/backends/google_vision.py
class GoogleVisionBackend(OCRBackend):
    """Google Vision API backend. Uses SERVICE_ACCOUNT_JSON for credentials."""

    def __init__(self):
        # Load credentials from SERVICE_ACCOUNT_JSON env var
        service_account_info = json.loads(os.environ["SERVICE_ACCOUNT_JSON"])
        credentials = service_account.Credentials.from_service_account_info(service_account_info)
        self.client = vision.ImageAnnotatorClient(credentials=credentials)

    def get_constraints(self) -> dict:
        """Google Vision API limits."""
        # TODO: Find and apply actual constraint set and limits from the incumbent service. 
        return {
            "max_image_height": xxx,
            "max_image_width": xxx,
            "max_file_size_bytes": xxx * 1024 * 1024,
            ...
        }

    def process_single(self, image_bytes: bytes, language: str) -> OCRResult:
        """Process single image with document_text_detection."""
        ...
```

**Processing flow (in processing.py):**
```python
def process_frames_with_ocr(
    frames: list[tuple[str, bytes]],
    backend: OCRBackend,
    language: str,
) -> list[OCRResult]:
    """
    High-level processing:
    1. Calculate max batch size using batch.calculate_max_batch_size()
    2. Calculate even batch size using batch.calculate_even_batch_size() to
       distribute frames evenly across the minimum number of batches
    3. For each batch:
       a. Create montage using montage.create_vertical_montage()
       b. Process montage as single image via backend.process_single()
       c. Distribute results using montage.distribute_results_to_images()
    4. Return all OCR results
    """
```

### Phase 2: Create `data-pipelines/extract-full-frames-and-ocr/`

Evolve `data-pipelines/full_frames/` into the production package.

**Structure:**
```
data-pipelines/extract-full-frames-and-ocr/
├── pyproject.toml
├── deploy.py                  # modal deploy entry point
├── src/extract_full_frames_and_ocr/
│   ├── __init__.py
│   ├── app.py                 # Modal app: "extract-full-frames-and-ocr"
│   ├── pipeline.py            # Main processing logic
│   └── models.py              # ExtractFullFramesAndOcrResult
└── tests/
    └── test_integration.py    # Modal integration tests
```

**Modal function:**
```python
# app.py
import json
import os
import modal

app = modal.App("extract-full-frames-and-ocr")

@app.function(
    gpu="A10G",
    secrets=[
        modal.Secret.from_name("wasabi"),
        modal.Secret.from_name("google-vision"),  # Contains SERVICE_ACCOUNT_JSON
    ],
)
def extract_full_frames_and_ocr(
    video_key: str,
    tenant_id: str,
    video_id: str,
    rate_hz: float = 0.1,
    language: str = "zh-Hans",
) -> dict:
    """GPU extraction → montage OCR → fullOCR.db → Wasabi upload."""
```

**Pipeline implementation:**
```python
# pipeline.py
def process_video(video_path: Path, db_path: Path, rate_hz: float, language: str) -> int:
    """
    1. Extract frames using gpu_video_utils.extract_frames_gpu()
    2. Calculate max batch size via ocr.batch.calculate_max_batch_size()
    3. Calculate even batch size via ocr.batch.calculate_even_batch_size()
       to distribute frames evenly across batches
    4. For each batch: ocr.processing.process_frames_with_ocr()
    5. Write to fullOCR.db using ocr.database.write_ocr_results()
    Returns: total_ocr_boxes
    """
```

### Phase 3: Rename `captionacc-modal/` → `extract-crop-frames-and-infer-extents/`

**Renames:**
- Directory: `data-pipelines/captionacc-modal/` → `data-pipelines/extract-crop-frames-and-infer-extents/`
- Module: `captionacc_modal` → `extract_crop_frames_and_infer_extents`
- `inference_pipelined.py` → `pipeline.py`
- Modal app: `"captionacc-processing"` → `"extract-crop-frames-and-infer-extents"`

**Remove from this app:**
- `ocr.py` (median frame OCR) - this is a different pipeline, not part of crop/infer
- `extract.py` (full frame OCR) - moved to extract-full-frames-and-ocr app

**This app focuses solely on:** GPU crop + ML inference for caption boundary detection.

**Update imports throughout the codebase** (search for `captionacc_modal`).

### Phase 4: Delete deprecated code

- Delete `services/ocr-service/` entirely
- Remove `ocr_utils.ocr_service_client` (OCRServiceAdapter)
- Update any code that imports from old locations

## Files to Create/Modify

### Phase 1: packages/ocr/ refactor

**New/Modified files:**
- `packages/ocr/pyproject.toml` (rename from ocr_utils)
- `packages/ocr/src/ocr/__init__.py` (new public API)
- `packages/ocr/src/ocr/models.py` (OCRResult, BoundingBox)
- `packages/ocr/src/ocr/montage.py` (from ocr-service/app.py - CPU version)
- `packages/ocr/src/ocr/batch.py` (new - calculate_max_batch_size)
- `packages/ocr/src/ocr/database.py` (keep from ocr_utils)
- `packages/ocr/src/ocr/processing.py` (refactor from ocr_utils)
- `packages/ocr/src/ocr/backends/__init__.py`
- `packages/ocr/src/ocr/backends/base.py`
- `packages/ocr/src/ocr/backends/google_vision.py` (from ocr-service)
- `packages/ocr/src/ocr/backends/livetext.py` (from ocr_utils)

**Delete:**
- `packages/ocr_utils/src/ocr_utils/ocr_service_client.py` (deprecated)

### Phase 1b: packages/gpu_video_utils/ enhancements

**Add GPU crop to frame_extraction.py:**
- Update `frame_extraction.py` to accept optional crop parameter, using crop logic from inference_pipelined.py

**Add GPU-accelerated montage creation:**
- `packages/gpu_video_utils/src/gpu_video_utils/montage.py` (NEW - GPU version using PyTorch/CUDA)

This allows Modal jobs to use GPU-accelerated crop and montage assembly when running on GPU instances.

### Phase 2: data-pipelines/extract-full-frames-and-ocr/

**Rename directory:**
- `data-pipelines/full_frames/` → `data-pipelines/extract-full-frames-and-ocr/`

**Create/modify:**
- `data-pipelines/extract-full-frames-and-ocr/pyproject.toml`
- `data-pipelines/extract-full-frames-and-ocr/deploy.py`
- `data-pipelines/extract-full-frames-and-ocr/src/extract_full_frames_and_ocr/__init__.py`
- `data-pipelines/extract-full-frames-and-ocr/src/extract_full_frames_and_ocr/app.py`
- `data-pipelines/extract-full-frames-and-ocr/src/extract_full_frames_and_ocr/pipeline.py`
- `data-pipelines/extract-full-frames-and-ocr/src/extract_full_frames_and_ocr/models.py`
- `data-pipelines/extract-full-frames-and-ocr/tests/test_integration.py`

### Phase 3: data-pipelines/extract-crop-frames-and-infer-extents/

**Rename directory:**
- `data-pipelines/captionacc-modal/` → `data-pipelines/extract-crop-frames-and-infer-extents/`

**Rename internal files:**
- `src/captionacc_modal/` → `src/extract_crop_frames_and_infer_extents/`
- `inference_pipelined.py` → `pipeline.py`
- `inference_sequential.py` → (delete or keep for profiling)

**Remove from this app:**
- `ocr.py` (median frame OCR - different pipeline)
- `extract.py` (full frame OCR - moved to extract-full-frames-and-ocr)

**Update all imports** in:
- `services/api/` (Modal function calls)
- `docs/` (references)

### Phase 4: Cleanup

**Delete entirely:**
- `services/ocr-service/` (all files)

## Modal Image Configuration

**extract-full-frames-and-ocr image:**
```python
from pathlib import Path

repo_root = Path(__file__).parent.parent.parent.parent.parent

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1-mesa-glx", "libglib2.0-0")
    .pip_install(
        # GPU Video Processing
        "PyNvVideoCodec",
        "torch>=2.0.0",
        # Core dependencies
        "numpy>=1.24.0",
        "Pillow>=10.0.0",
        "opencv-python-headless",
        # OCR and API
        "google-cloud-vision>=3.0.0",
        "httpx",  # For async HTTP if needed
        # Storage
        "boto3",
    )
    .add_local_dir(
        repo_root / "packages" / "gpu_video_utils" / "src" / "gpu_video_utils",
        "/root/gpu_video_utils"
    )
    .add_local_dir(
        repo_root / "packages" / "ocr" / "src" / "ocr",
        "/root/ocr"
    )
    .add_local_dir(
        repo_root / "data-pipelines" / "extract-full-frames-and-ocr" / "src" / "extract_full_frames_and_ocr",
        "/root/extract_full_frames_and_ocr"
    )
    .env({"PYTHONPATH": "/root"})
)
```

**Google Vision credentials pattern:**
```python
# The "google-vision" Modal secret should contain SERVICE_ACCOUNT_JSON
# In the function, load credentials like this:

import json
import os
from google.oauth2 import service_account
from google.cloud import vision

service_account_info = json.loads(os.environ["SERVICE_ACCOUNT_JSON"])
credentials = service_account.Credentials.from_service_account_info(service_account_info)
client = vision.ImageAnnotatorClient(credentials=credentials)
```

## Verification

1. **Unit tests for packages/ocr:**
   ```bash
   cd packages/ocr && pytest
   ```

2. **Deploy and test extract-full-frames-and-ocr:**
   ```bash
   modal deploy data-pipelines/extract-full-frames-and-ocr/deploy.py
   pytest data-pipelines/extract-full-frames-and-ocr/tests/test_integration.py --run-modal
   ```

3. **Deploy and test extract-crop-frames-and-infer-extents:**
   ```bash
   modal deploy data-pipelines/extract-crop-frames-and-infer-extents/deploy.py
   pytest data-pipelines/extract-crop-frames-and-infer-extents/tests/ --run-modal
   ```

4. **Verify API service integration:**
   ```bash
   # Check that Modal function lookups work with new app names
   grep -r "captionacc-processing\|extract-full-frames-and-ocr\|extract-crop-frames-and-infer-extents" services/api/
   ```

5. **Clean build verification:**
   ```bash
   # Ensure no imports of deleted code
   grep -r "ocr-service\|ocr_utils\|captionacc_modal" --include="*.py" .
   ```

## Migration Notes

- Modal apps will have new names:
  - `"extract-full-frames-and-ocr"` (new)
  - `"extract-crop-frames-and-infer-extents"` (renamed from `captionacc-processing`)
- Any existing Modal function lookups using old app names need updating
- The `packages/ocr` package import changes: `from ocr_utils import ...` → `from ocr import ...`
- GPU crop functionality is part of `gpu_video_utils.extract_frames_gpu()` (optional crop parameter)
- Montage creation available in both:
  - `ocr.montage` (CPU version, for local dev)
  - `gpu_video_utils.montage` (GPU version, for Modal)
