# Cropped Frame Annotation UI - Implementation Notes

## Overview

When implementing box annotation in the text annotation workflow (cropped frame view), follow these patterns to integrate with the unified annotation system.

## Display Annotations (Read)

### Query Pattern

Show all annotations for the current cropped frame, regardless of source:

```typescript
const userAnnotations = db.prepare(`
  SELECT box_index, label, annotation_source
  FROM full_frame_box_labels
  WHERE frame_index = ? AND label_source = 'user'
`).all(croppedFrameIndex)
```

This automatically includes:
- Annotations from `annotation_source='cropped_frame'` for this frame
- Annotations from `annotation_source='full_frame'` if they happen to share the same frame_index (unlikely but possible)

**Note:** Full frames (0.1Hz) and cropped frames (10Hz) have different frame indices, so cross-source overlap is rare by frame_index alone.

### Optional: Show Spatially Overlapping Annotations

If you want to show annotations from other frames that spatially overlap the current cropped area:

```typescript
// Get current crop bounds from video_layout_config
const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get()

// Get all annotations that overlap the cropped region
const overlappingAnnotations = db.prepare(`
  SELECT
    annotation_source,
    frame_index,
    box_index,
    box_left,
    box_top,
    box_right,
    box_bottom,
    label
  FROM full_frame_box_labels
  WHERE label_source = 'user'
    AND box_right >= ?
    AND box_left <= ?
    AND box_bottom >= ?
    AND box_top <= ?
`).all(
  layoutConfig.crop_left,
  layoutConfig.crop_right,
  layoutConfig.crop_top,
  layoutConfig.crop_bottom
)
```

This will show annotations from both full frames and other cropped frames that fall within the visible area.

## Save Annotations (Write)

### Convert Cropped Coordinates to Full-Frame

When user annotates a box in cropped frame view:

```typescript
// Box coordinates from cropped_frame_ocr are in fractional [0-1] relative to CROPPED region
const cropBounds = {
  left: layoutConfig.crop_left,
  top: layoutConfig.crop_top,
  right: layoutConfig.crop_right,
  bottom: layoutConfig.crop_bottom
}

const cropWidth = cropBounds.right - cropBounds.left
const cropHeight = cropBounds.bottom - cropBounds.top

// Convert fractional coordinates in cropped space to full-frame absolute pixels
const boxLeftFullFrame = cropBounds.left + Math.floor(box.x * cropWidth)
const boxTopFullFrame = cropBounds.top + Math.floor(box.y * cropHeight)
const boxRightFullFrame = cropBounds.left + Math.floor((box.x + box.width) * cropWidth)
const boxBottomFullFrame = cropBounds.top + Math.floor((box.y + box.height) * cropHeight)
```

### Insert Pattern

```typescript
const upsert = db.prepare(`
  INSERT INTO full_frame_box_labels (
    annotation_source,
    frame_index,
    box_index,
    box_text,
    box_left,
    box_top,
    box_right,
    box_bottom,
    label,
    label_source,
    crop_bounds_version,
    labeled_at
  ) VALUES ('cropped_frame', ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, datetime('now'))
  ON CONFLICT(annotation_source, frame_index, box_index)
  DO UPDATE SET
    label = excluded.label,
    labeled_at = datetime('now')
`)

upsert.run(
  croppedFrameIndex,
  boxIndex,
  boxText,
  boxLeftFullFrame,    // Full-frame coordinates
  boxTopFullFrame,
  boxRightFullFrame,
  boxBottomFullFrame,
  label,
  layoutConfig.crop_bounds_version
)
```

## Delete/Clear Annotations

### Important: No Foreign Key Constraints

The `full_frame_box_labels` table has **NO foreign key constraints** to OCR tables. This means:
- ✓ Annotations persist even when source frames are deleted (useful for training)
- ✓ DELETE operations work even when source frames no longer exist
- ✓ No orphaned reference errors when clearing annotations

### Clearing Individual Annotations

When a user clears/deletes an annotation, simply DELETE the row:

```typescript
// Delete annotation - works regardless of whether source frame still exists
db.prepare(`
  DELETE FROM full_frame_box_labels
  WHERE annotation_source = ?
    AND frame_index = ?
    AND box_index = ?
`).run(annotationSource, frameIndex, boxIndex)
```

**No need to check if source frame exists** - the DELETE will succeed either way.

## "Clear All" Button

Delete all annotations for the current frame (from any source):

```typescript
async function clearAllAnnotationsForFrame(
  videoId: string,
  frameIndex: number,
  annotationSource: 'full_frame' | 'cropped_frame'
) {
  const db = getDatabase(videoId)

  // Delete all annotations for this frame
  const deleteStmt = db.prepare(`
    DELETE FROM full_frame_box_labels
    WHERE frame_index = ?
  `)

  const result = deleteStmt.run(frameIndex)

  db.close()

  return { deletedCount: result.changes }
}
```

**UI Pattern:**

```tsx
<button
  onClick={async () => {
    if (confirm('Clear all annotations for this frame? This cannot be undone.')) {
      await fetch(`/api/annotations/${videoId}/frames/${frameIndex}/clear-all`, {
        method: 'DELETE'
      })
      // Reload annotations
      loadAnnotations()
    }
  }}
>
  Clear All
</button>
```

## Expected Behavior

### Overlap Handling

- **No deduplication**: If the same box is annotated in both full frame and cropped frame views, both annotations are preserved
- **Both show in training**: Model training includes all annotations regardless of source
- **May be confusing**: Users might see the same spatial region annotated twice (different frame_index, different annotation_source)
- **Clear all handles it**: The "clear all" button removes all annotations for the current frame

### Preservation on Re-crop

When crop bounds change (`crop_bounds_version` increments):
- Existing cropped frame annotations are **preserved** with their old `crop_bounds_version`
- They remain in full-frame coordinates, so they still contribute to training
- **They still display** when viewing the same frame_index (frame indices don't change)
- They may not align with new OCR boxes (OCR regenerated with new crop bounds)
- User can use "clear all" button to remove all annotations for the frame

### Annotations After Re-cropping

When crop bounds change (e.g., `crop_bounds_version` increments from 1→2):
- **Annotations persist** in `full_frame_box_labels` with their original `crop_bounds_version=1`
- **OCR is regenerated** - `cropped_frame_ocr` is re-populated with new boxes for the same frame indices
- **Annotations still display** - frame indices still exist, query by `frame_index` still works
- **May not align** - old annotations were for old OCR boxes, new OCR boxes are different
- **Still useful for training** - they have full-frame coordinates, contribute to model
- **Can be cleaned up** - "clear all" button removes all annotations for the frame

**Example scenario:**
1. User annotates boxes in cropped frame #123 with `crop_bounds_version=1`
   - Creates: `annotation_source='cropped_frame'`, `frame_index=123`, `crop_bounds_version=1`
2. Crop bounds change → `crop_bounds_version` increments to 2
   - `cropped_frame_ocr` regenerated for frame #123 with new crop bounds
   - New OCR boxes appear for the newly cropped region
3. Annotations from version 1 still display
   - Query: `WHERE frame_index=123` returns both old and potentially new annotations
   - Old annotations may not align with new OCR boxes (different crop bounds)
   - May be confusing to user (boxes don't match current OCR)
4. User clicks "clear all" button for frame #123
   - Deletes all annotations WHERE frame_index=123
   - Removes all old annotations for this frame regardless of crop_bounds_version
   - DELETE succeeds normally (no special handling needed)

## Summary

1. **Display**: Query by `frame_index` to show all annotations for the frame
2. **Save**: Convert cropped coordinates to full-frame, insert with `annotation_source='cropped_frame'`
3. **Clear all**: DELETE all annotations for the current frame (`WHERE frame_index = ?`)
4. **No deduplication**: Let annotations from different sources coexist
