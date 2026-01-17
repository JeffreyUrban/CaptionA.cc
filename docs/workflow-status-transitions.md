# Video Workflow Status Transitions

This document describes how the workflow status columns (`layout_status`, `boundaries_status`, `text_status`) transition through the video annotation pipeline.

## Status Values

Each workflow stage can have one of these statuses:
- `wait` - Waiting for prerequisites (default state)
- `annotate` - Ready for user annotation
- `done` - User has completed and approved this stage
- `review` - Needs review (future use)
- `error` - Processing error occurred

## Initial State

When a video is created, all statuses default to `'wait'`:
```sql
layout_status = 'wait'
boundaries_status = 'wait'
text_status = 'wait'
```

## Workflow Stages

### Stage 1: Layout (OCR & Frame Extraction)

**Trigger:** Video uploaded
**Prefect Flow:** `captionacc-video-initial-processing`

**Transitions:**
1. Video created → `layout_status = 'wait'`
2. OCR completes successfully → `layout_status = 'annotate'`
3. OCR fails → `layout_status = 'error'` (with `layout_error_details`)

**Updated by:**
- `services/api/app/flows/video_initial_processing.py`
- Task: `update_workflow_status_task()`

**User Action Required:**
- Define layout region (caption area) in the video
- Click "Approve Layout" button

---

### Stage 2: Boundaries (Caption Frame Extents)

**Trigger:** User approves layout
**Prefect Flow:** `captionacc-crop-and-infer-caption-frame-extents`

**Transitions:**
1. User approves layout → `layout_status = 'done'`
2. Crop & infer completes → `boundaries_status = 'annotate'`
3. Crop & infer fails → `boundaries_status = 'error'` (with `boundaries_error_details`)

**Updated by:**
- Layout approval: `services/api/app/routers/actions.py` → `approve_layout()`
- Inference completion: `services/api/app/flows/crop_and_infer.py`
- Task: `update_boundaries_status()`

**User Action Required:**
- Review and correct predicted caption boundaries
- Approve/reject individual captions
- Mark stage as complete (TODO: implement endpoint)

---

### Stage 3: Text (Caption Transcription)

**Trigger:** User completes boundaries annotation
**Processing:** OCR text review and correction

**Transitions:**
1. User completes boundaries → `boundaries_status = 'done'`, `text_status = 'annotate'`
2. User completes text review → `text_status = 'done'`

**Updated by:**
- TODO: Implement endpoints for:
  - `/videos/{video_id}/actions/complete-boundaries` → sets `boundaries_status = 'done'`, `text_status = 'annotate'`
  - `/videos/{video_id}/actions/complete-text` → sets `text_status = 'done'`

**User Action Required:**
- Review and correct OCR text for each caption
- Mark all captions as complete

---

## Complete Workflow Diagram

```
Upload Video
    ↓
layout_status = 'wait'
boundaries_status = 'wait'
text_status = 'wait'
    ↓
[Prefect: video_initial_processing]
Frame extraction + OCR
    ↓
layout_status = 'annotate' ← User sees "Layout: Annotate" badge
    ↓
User defines layout region
User clicks "Approve Layout"
    ↓
layout_status = 'done'
    ↓
[Prefect: crop_and_infer]
Crop frames + Run inference
    ↓
boundaries_status = 'annotate' ← User sees "Boundaries: Annotate" badge
    ↓
User reviews boundaries
User marks boundaries complete
    ↓
boundaries_status = 'done'
text_status = 'annotate' ← User sees "Text: Annotate" badge
    ↓
User reviews/corrects text
User marks text complete
    ↓
text_status = 'done'
    ↓
All statuses = 'done' ← User sees "Complete" badge
```

## Error Handling

When any stage fails:
- Status is set to `'error'`
- Error details are stored in the corresponding `*_error_details` JSONB column
- Badge shows "Stage: Error" (clickable to view details)
- User can retry or contact support

Example error details structure:
```json
{
  "message": "Frame extraction failed: Connection timeout",
  "error": "ConnectionTimeout: Failed to connect to Modal",
  "timestamp": "2026-01-17T20:30:00Z"
}
```

## Badge Display Logic

In `apps/captionacc-web/app/utils/video-badges.ts`:

```typescript
// All done → "Complete"
if (all statuses === 'done') return [{ type: 'complete', label: 'Complete' }]

// All wait → "Processing"
if (all statuses === 'wait') return [{ type: 'processing', label: 'Processing' }]

// Otherwise show individual stage badges
if (layout_status === 'annotate') → "Layout: Annotate" (green, clickable)
if (layout_status === 'review') → "Layout: Review" (yellow, clickable)
if (layout_status === 'error') → "Layout: Error" (red, clickable)

// Same for boundaries_status and text_status
```

## Statistics Tracking

The following columns track progress:
- `total_frames` - Total frames in video (set by initial processing)
- `covered_frames` - Frames with boundaries defined (updated by boundaries annotation)
- `total_annotations` - Total caption annotations
- `confirmed_annotations` - User-confirmed captions
- `predicted_annotations` - AI-predicted captions (not yet reviewed)
- `boundary_pending_count` - Boundaries needing review
- `text_pending_count` - Text annotations needing review

These are displayed in the Distribution and Pending columns on the videos page.

## Future Enhancements

### Review Status
Currently unused, but could be used for:
- Quality review workflows
- Multi-user approval processes
- Training data validation

### Auto-progression
Some status transitions could be automated:
- `text_status = 'annotate'` when `boundary_pending_count = 0`
- `text_status = 'done'` when `text_pending_count = 0`

This requires implementing business logic to track completion criteria.
