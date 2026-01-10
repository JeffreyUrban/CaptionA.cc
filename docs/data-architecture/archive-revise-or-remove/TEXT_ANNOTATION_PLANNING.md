# Text Correction Workflow - Implementation Plan

## Overview
Implement the Text Correction workflow as specified in `apps/captionacc-web/docs/annotation/text-correction-workflow.md`. This workflow allows users to add and correct caption text for boundary annotations.

## Architecture Understanding

### Current State
- **Database**: Each video has SQLite DB at `!__local/data/_has_been_deprecated__!/[videoPath]/captions.db`
- **Captions Table**: Shared table for boundary and text data
  - Boundary fields: `start_frame_index`, `end_frame_index`, `boundary_state`, `boundary_pending`
  - Text fields: `text`, `text_pending`, `text_status`, `text_notes`, `text_ocr_combined`, `text_updated_at`
  - Boundary states: 'predicted', 'confirmed', 'gap' (boundary workflow only)
- **Workflow**:
  - Phase 1: Boundary annotation (mark caption ranges)
  - Phase 2: Text annotation (add caption text to boundaries)
  - When boundaries are updated → mark text as pending (text_pending=1)
- **Combined Images**: One averaged image per annotation, generated from all frames in range
  - Used for manual inspection and OCR/VLM text extraction
  - Stored at `!__local/data/_has_been_deprecated__!/[videoPath]/text_images/annotation_[id].jpg`
- **Routing**: Separate route `/annotate/text` for text annotation workflow

### User Clarifications
✓ Combined images and OCR need to be created as part of the workflow (not pre-existing)
✓ Text annotations use same `captions` table with additional fields:
  - `text` field: NULL = not yet annotated, empty string = annotated as "no caption"
  - `text_pending`: flag for when boundaries change and text needs re-annotation
  - `text_status`: text quality indicator (separate from boundary_state)
  - `text_notes`: user notes during text annotation
  - `text_ocr_combined`: cached OCR result from combined image
  - `text_updated_at`: timestamp of last text annotation update (separate from boundary_updated_at)
✓ Separate route for text annotation workflow (text correction = text annotation)
✓ Boundary states/pending are boundary-specific, text has own pending flag

## Implementation Approach

### Phase 1: Database Schema Updates
**File to modify:**
- `app/db/captions-schema.sql`

**Changes:**
1. **Rename boundary-specific fields** (avoid confusion with text workflow):
   - `state` → `boundary_state` (values: 'predicted', 'confirmed', 'gap')
   - `pending` → `boundary_pending` (0 or 1)

2. **Add text-specific fields**:
   - `text_pending` INTEGER DEFAULT 0 CHECK(text_pending IN (0, 1))
     - Set to 1 when boundaries change and text needs re-annotation
   - `text_status` TEXT (nullable)
     - Text quality: 'valid_caption', 'ocr_error', 'partial_caption', 'text_unclear', 'other_issue'
   - `text_notes` TEXT (nullable)
     - User notes during text annotation
   - `text_ocr_combined` TEXT (nullable)
     - Cached OCR result from combined image
   - `text_updated_at` TEXT NOT NULL DEFAULT (datetime('now'))
     - Timestamp of last text annotation update
   - Keep `text` TEXT (NULL = not annotated, empty string = no caption)
   - Also add `boundary_updated_at` TEXT NOT NULL DEFAULT (datetime('now'))

3. **Add frames table** (for per-frame OCR data):
   ```sql
   CREATE TABLE frames (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     annotation_id INTEGER NOT NULL,
     frame_index INTEGER NOT NULL,
     ocr_text TEXT,
     ocr_confidence REAL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     FOREIGN KEY (annotation_id) REFERENCES captions(id) ON DELETE CASCADE
   );
   CREATE INDEX idx_frames_annotation ON frames(annotation_id);
   CREATE UNIQUE INDEX idx_frames_unique ON frames(annotation_id, frame_index);
   ```

4. **Add indexes**:
   - `idx_captions_text_pending` on (text_pending, start_frame_index)
   - `idx_captions_text_null` on ((text IS NULL), start_frame_index) 

### Phase 2: Image & OCR Processing

**Combined Image Generation:**
- **When**: On-demand when loading text annotation (if not cached)
- **Where**: `app/utils/image-processing.ts`
- **Algorithm recommendations**:
  1. **Median pixel values** (Recommended) - Better than mean for handling outliers/noise
  2. Mean pixel values (simple average) - Faster, simpler
  3. Mode (most common pixel value) - Best for consistent text
  4. Max pixel value - Highlights brightest text
- **Caching**: Save to `!__local/data/_has_been_deprecated__!/[videoPath]/text_images/annotation_[id].jpg`
- **Invalidation**: Delete cached image when boundary changes (start/end frame updated)

**OCR Execution:**
- **Combined image OCR**:
  - Synchronous on first load, cache result in `captions.combined_ocr_text`
  - Fast enough for real-time (single image)
- **Per-frame OCR**:
  - Async/background job triggered on text annotation load
  - Store results in `frames` table
  - Progressive loading: show combined OCR immediately, per-frame OCR as it completes
  - **Alternative**: Pre-process in background after boundary annotation saved

**Recommendation**: Hybrid approach keeps text workflow responsive while providing frame-by-frame detail when available.

### Phase 3: API Routes
**New routes to create:**
- `app/routes/api.captions.$videoId.text-queue.tsx`
  - GET: Fetch captions needing text
  - Query: `WHERE text IS NULL OR text_pending = 1`
  - Returns list sorted by start_frame_index
  - Include annotation metadata (id, start/end frames, existing text if any)

- `app/routes/api.captions.$videoId.$id.text.tsx`
  - GET: Load single annotation for text annotation
    - Generate combined image if not cached
    - Run OCR on combined image (synchronous)
    - Trigger per-frame OCR (async)
    - Return: annotation data, combined image URL, combined OCR text, per-frame OCR if available
  - PUT: Update text annotation
    - Body: `{ text, text_status, text_notes }`
    - Set `text_pending = 0`
    - Return updated annotation

- `app/routes/api.captions.$videoId.$id.frames.tsx`
  - GET: Fetch per-frame OCR results for annotation
  - Returns array: `[{ frame_index, ocr_text, ocr_confidence }, ...]`
  - Used for progressive loading as OCR completes

**Modify existing:**
- `app/routes/api.captions.$videoId.tsx`
  - GET: Add text-related fields (text, text_pending, text_status, text_notes, text_ocr_combined, text_updated_at) to responses
  - PUT: When updating boundaries (start/end frame), set `text_pending = 1` if text is not NULL

### Phase 4: Core Text Annotation Page
**Main route file:**
- `app/routes/annotate.text.tsx`
  - Loader: Fetch video metadata, load first annotation needing text
  - Component structure:
    - Left panel (2/3 width): Image display, OCR text, caption editor
    - Right panel (1/3 width): Controls, navigation, status
  - State management: annotation data, current text, status, notes
  - Keyboard shortcuts: Enter (save), Tab (next), Esc (skip)
  - Navigation: Previous/Next annotation in queue

### Phase 5: Utility Functions & Components
**Utility files to create:**
- `app/utils/character-variants.ts`
  - `analyzeCharacterVariants(ocrTexts: string[]): CharacterVariant[]`
  - Character frequency analysis across frames
  - Consistency threshold (80% default)
  - Export types: `CharacterVariant`, `TextAlignment`

**Components to create:**
- `app/components/TextCorrection/CharacterEditor.tsx`
  - Displays editable caption text
  - Character-level highlighting (yellow for inconsistent)
  - Click-to-cycle interaction
  - Hover tooltips showing variant options with counts

- `app/components/TextCorrection/OCRTextDisplay.tsx`
  - Read-only OCR text display
  - Character highlighting: green (consistent), yellow (inconsistent), red (errant)
  - Monospace font, aligned with caption editor

- `app/components/TextCorrection/TextAlignmentControls.tsx`
  - Anchor X slider (0-100%)
  - Font size slider (12-48px)
  - Reset button
  - Persist per-video in localStorage

- `app/components/TextCorrection/AnnotationInfo.tsx`
  - Display annotation ID, video, frame range
  - Text status dropdown
  - Text notes textarea
  - Save/Skip/Next buttons

**Frame-by-frame OCR Components:**
- `app/components/TextCorrection/FrameOCRComparison.tsx`
  - List view of all frames in annotation range
  - Shows OCR text for each frame
  - Click to navigate to specific frame
  - Highlight current frame
  - Progressive loading: show "Loading..." for frames without OCR yet

- Frame navigation within annotation range:
  - Previous/Next frame buttons (within annotation range only)
  - Keyboard: ↑/↓ or ←/→ to navigate frames
  - Display current frame index and total in range
  - Update OCR text display to show current frame's OCR

### Phase 6: Background OCR Processing (Optional Enhancement)
**Python script for pre-processing:**
- `scripts/process-text-ocr.py`
  - Scans captions with text_pending=1 or text IS NULL
  - Generates combined images
  - Runs OCR on combined images and individual frames
  - Populates frames table with results
  - Can run as cron job or triggered by boundary annotation saves

## Critical Files

**Schema:**
- `app/db/captions-schema.sql` - Rename boundary fields, add text fields, add frames table

**Image Processing:**
- `app/utils/image-processing.ts` (NEW) - Combined image generation (median algorithm)
- `app/utils/ocr-wrapper.ts` (NEW) - OCR wrapper for ocr_utils package
  - Call Python `process_frame_ocr_with_retry()` via subprocess
  - Extract clean text from captions array
  - Handle errors and retry logic

**API Routes:**
- `app/routes/api.captions.$videoId.text-queue.tsx` (NEW)
- `app/routes/api.captions.$videoId.$id.text.tsx` (NEW)
- `app/routes/api.captions.$videoId.$id.frames.tsx` (NEW)
- `app/routes/api.captions.$videoId.tsx` (MODIFY - add text_pending on boundary update)

**Main Page:**
- `app/routes/annotate.text.tsx` (NEW)

**Utilities:**
- `app/utils/character-variants.ts` (NEW)

**Components:**
- `app/components/TextCorrection/CharacterEditor.tsx` (NEW)
- `app/components/TextCorrection/OCRTextDisplay.tsx` (NEW)
- `app/components/TextCorrection/TextAlignmentControls.tsx` (NEW)
- `app/components/TextCorrection/AnnotationInfo.tsx` (NEW)
- `app/components/TextCorrection/FrameOCRComparison.tsx` (NEW) - NOT deferred

## Implementation Order

1. **Schema Updates**
   - Rename boundary_state, boundary_pending
   - Add text_pending, status, notes
   - Add frames table
   - Add indexes

2. **Image Processing Utilities**
   - Combined image generation (median algorithm using sharp or canvas)
   - OCR wrapper for `ocr_utils` Python package
   - Text extraction from OCR annotations array
   - Annotation-ID-based result caching (Map<annotationId, OCRResult>)

3. **API Routes**
   - Text queue endpoint
   - Text annotation load/update endpoints
   - Per-frame OCR endpoint
   - Modify boundary update to set text_pending

4. **Basic Page Structure**
   - annotate.text.tsx layout
   - Loader for first annotation in queue
   - Basic state management

5. **Core Components**
   - AnnotationInfo (controls panel)
   - Combined image display
   - OCRTextDisplay (read-only)
   - CharacterEditor (editable, click-to-cycle)

6. **Frame Navigation**
   - FrameOCRComparison panel
   - Frame-by-frame navigation
   - Progressive OCR loading

7. **Character Variant Logic**
   - Analysis algorithm
   - Highlighting logic
   - Click-to-cycle interaction

8. **Integration & Polish**
   - Keyboard shortcuts
   - localStorage for text alignment
   - Error handling
   - Loading states

## Testing Considerations

- Test with captions that have/don't have text
- Verify status field updates correctly
- Test keyboard shortcuts (Enter, Tab, Esc)
- Verify text alignment persists per-video
- Test character cycling logic with various OCR patterns
- Verify Save → Next workflow

## Design Recommendations Summary

### 1. Combined Image Algorithm
**Recommendation: Median pixel values**
- **Why**: Better than mean for handling outliers/noise from individual frames
- **Alternatives**: Mean (faster), Mode (most consistent), Max (brightest)
- **Future**: Make configurable, allow user to choose algorithm per video

### 2. OCR Execution Strategy
**Recommendation: Hybrid sync/async approach**
- **Combined image OCR**: Synchronous on load (fast, single image)
- **Per-frame OCR**: Async background job with progressive loading
- **Why**: Keeps UI responsive while providing detailed per-frame data
- **Alternative**: Full pre-processing pipeline (more complex, but better UX if implemented)

### 3. Per-Frame OCR Storage
**Recommendation: Add frames table to captions.db**
- **Why**:
  - Relational integrity (CASCADE delete)
  - Efficient queries for frame ranges
  - Room for additional metadata (confidence scores)
- **Alternative**: JSON blob in annotation row (simpler, less flexible)

### 4. Text Pending Flag Management
**Recommendation: Auto-set text_pending=1 on boundary update**
- Trigger in boundary update API endpoint
- Only if text IS NOT NULL (has been annotated)
- Clear flag when text annotation is saved
- **Why**: Ensures text accuracy when boundaries change

### 5. Schema Field Naming
**Recommendation: Explicit prefixes**
- `boundary_state`, `boundary_pending` (avoid confusion)
- `text_pending` (parallel structure)
- `status` (text-specific, no prefix needed)
- **Why**: Clear separation of concerns, future-proof for additional workflows

### 6. Image Caching Strategy
**Recommendation: File-based cache with invalidation**
- Save to `!__local/data/_has_been_deprecated__!/[videoPath]/text_images/annotation_[id].jpg`
- Delete on boundary update (forces regeneration)
- Check existence before generating
- **Why**: Fast, simple, works with existing file-based structure

## Decisions

### 1. OCR Provider: captionsacc-ocr service 

### 2. Pre-processing: On-demand with Intelligent Work-Ahead
**Decision:** Annotation-ID-based caching with configurable work-ahead
- **Constant:** `WORK_AHEAD_COUNT = 3` (configurable)
- **Strategy:**
  - Process current annotation synchronously (combined image + OCR)
  - Background process next N annotations from queue
  - **Map preprocessing to annotation IDs** (not assumed sequence)
  - Cache preprocessed results keyed by annotation ID
  - If user jumps around, cached results stay available
  - On-demand processing for uncached annotations
- **Cache scope:** While user is in text annotation workflow
- **Invalidation:** Clear cache when boundaries change (text_pending=1)

### 3. Image Format: JPEG High Quality
**Decision:** JPEG at 90-95% quality
- Fewer annotations than frames → file size less critical
- High quality preserves detail for OCR
- Match or exceed crop_frames quality
- **Constant:** `COMBINED_IMAGE_QUALITY = 0.95`

### 4. Character Variant Threshold: Named Constant
**Decision:** Fixed 80% threshold, no magic numbers
- **Constant:** `CONSISTENCY_THRESHOLD = 0.8`
- Clear definition: character must appear in ≥80% of frames to be "consistent"

### 5. Auto-save: Explicit Save Only
**Decision:** User presses Save button or Enter key
- Align appearance and workflow with boundaries annotation (consistency)
- No auto-save to avoid confusion with save → next workflow

**Keyboard Shortcuts (aligned with boundaries annotation):**
- **Save & Next:** Enter (primary) or Tab (alternative)
- **Skip:** Esc (don't save, move to next)
- **Navigation within annotation:**
  - ↑/↓ or ←/→: Navigate between frames in annotation range
  - (No Shift/Ctrl modifiers - limited to annotation range)
- **Navigation between annotations:**
  - Buttons for Previous/Next annotation
  - (Consider P/N keys for quick navigation)

**UI Consistency with Boundaries:**
- Same color scheme: pink (pending), indigo (predicted), teal (confirmed)
- AppLayout component for consistent navigation
- Similar control panel structure (right side, 1/3 width)
- Collapsible help sections with keyboard shortcuts
