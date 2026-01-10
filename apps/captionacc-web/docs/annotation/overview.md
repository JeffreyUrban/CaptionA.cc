# Caption Annotation UI - Design Overview

# TODO: The database details in this doc are out of date.

**Status:** Design Document (Planning Phase)
**Created:** 2025-12-22
**Purpose:** Document design decisions for web-based caption annotation interface

## Background

Migrating caption annotation workflow from PyQt6 desktop applications to web-based interface.

## Problem Statement

For each video, we generate cropped caption frames at 10Hz (~25,000 frames per video). The annotation task involves:

1. **Boundary marking**: Identify start/end frames for caption sequences and non-caption sequences
2. **Text correction**: Correct OCR-extracted text for caption sequences

**Caption sequences:**

- Typically 2-50 frames, but unlimited
- Must include ALL frames with that caption
- Need accurate text transcription

**Non-caption sequences:**

- 1 to hundreds of frames
- Need not include all frames between captions
- No text required

## Core Design Principles

### 1. Workflow Separation

**Key Insight:** Separate boundary marking from text correction into distinct workflows.

**Rationale:**

- Different cognitive tasks (visual comparison vs text editing)
- More efficient to batch similar tasks
- Allows marking boundaries without determining text immediately
- Reduces context switching

### 2. Video-Agnostic Data Model

**CRITICAL:** Do not assume content is organized hierarchically.

- Use generic `video_id` for all content references
- Content organization concepts only exist in `/local/` data directory structure
- Application code remains content-agnostic

### 3. Frame Aspect Ratio

**Key Insight:** Caption frames are wide and short.

**Design implications:**

- Stack frames vertically, not horizontally
- Tight vertical spacing enables character-by-character comparison
- Frames should occupy ~2/3 of window width
- Text alignment with frame content is critical

### 4. Navigation Efficiency

**Pain point:** Advancing one frame at a time through 50+ frame sequences is tedious.

**Solutions:**

- Vertical "deck of cards" scroll view
- Mouse wheel navigation
- Configurable frame spacing (linear/exponential/hybrid)
- Keyboard shortcuts for various jump sizes

### 5. Text Alignment

**Key Insight:** Align OCR/Caption text fields with actual text position in frames.

**Implementation:**

- Per-video calibration: anchor position, font size
- Manual slider controls with memory
- Enables direct visual comparison between frames and text
- Critical for identifying character-level differences

## Two Workflows

### Workflow A: Boundary Marking

**Purpose:** Efficiently identify caption/non-caption sequences

**Interface:**

- Vertical deck of frames (no text)
- Mark start/end frames visually
- Classify as "Caption" (text TBD) or "Non-caption"
- No text entry

**Output:** Annotation with boundaries, type, and text status

### Workflow B: Text Correction

**Purpose:** Determine and correct caption text

**Interface:**

- Single frame view
- OCR text and Caption text stacked below frame
- Character-level diff highlighting
- Click to cycle through character options
- Navigate through frames in marked range

**Input:** Annotations where text = "NOT_YET_DETERMINED"
**Output:** Annotation with corrected text

## Key Features

### Character-Level Correction Assistance

**Two types of OCR inconsistencies:**

1. Oscillating characters at same position (e.g., 'a' vs 'o')
2. Extra errant text before/after caption

**Solution:**

- Color highlighting for inconsistent characters
- Click character to cycle through options (with frequency counts)
- Visual feedback for consistent vs inconsistent text

### Session History

- Full history for current session (not previous sessions)
- Click to navigate back to any annotation
- Important when annotating at high speed
- Easy error review and correction

### Configurable Frame Spacing

**Options:**

- Linear: N-5, N-4, N-3, N-2, N-1, N, N+1, N+2, N+3, N+4, N+5
- Exponential: N-8, N-4, N-2, N-1, N, N+1, N+2, N+4, N+8
- Hybrid: N-10, N-5, N-3, N-2, N-1, N, N+1, N+2, N+3, N+5, N+10

**Rationale:** Different users/contexts may prefer different frame densities.

### Keyboard-First Operation

**Philosophy:** Keyboard operation is more pleasant than mouse for repetitive tasks.

**Shortcuts:**

- Arrow keys: ±1 frame
- Shift+Arrow: ±10 frames
- Ctrl+Arrow: ±50 frames
- A/S/D/F: Jump/mark start/end
- Enter: Save
- Tab: Next annotation

## Data Model

```typescript
interface Annotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  annotation_type: 'caption' | 'non_caption'
  text: string | null
  // null for non-caption
  // 'NOT_YET_DETERMINED' for caption without text
  // actual text when determined
  status: string // 'Valid Caption', 'OCR Error', 'No Caption', etc.
  notes?: string
}

interface VideoSettings {
  video_id: string
  text_alignment: {
    anchor_x: number // 0-100 (percentage)
    anchor_y: number // 0-100 (percentage)
    font_size: number // 12-48px
  }
  frame_spacing: 'linear' | 'exponential' | 'hybrid'
}

interface Frame {
  id: number
  frame_index: number
  video_id: string
  ocr_text: string
  image_url: string // Path to cropped frame
}
```

## Implementation Notes

### Routes

```
/annotate/boundaries    - Boundary marking workflow
/annotate/text          - Text correction workflow
```

### Frame Storage

Frames stored at: `/!__local/data/_has_been_deprecated__!/<video_id>/crop_frames/`

### Session State

- Current video context
- Session history (annotations created/modified)
- Per-video settings (text alignment, frame spacing)
- Current position in workflow

### API Endpoints

```
GET  /api/annotations/next?mode=boundaries    - Get next annotation to mark
GET  /api/annotations/next?mode=text          - Get next annotation needing text
GET  /api/frames/:video_id/:frame_index       - Get specific frame
GET  /api/frames/:video_id/range?start=X&end=Y - Get frame range
POST /api/annotations                          - Save annotation
GET  /api/annotations/history                  - Get session history
```

## Open Questions

1. Should frame spacing configuration be global or per-video?
2. Should text alignment settings sync across sessions (database) or just localStorage?
3. Should we support annotation of gaps (frames between captions that aren't annotated)?
4. What's the best way to handle annotation updates/corrections vs new annotations?

## Next Steps

1. Document boundary workflow in detail → [boundary-workflow.md](./boundary-workflow.md)
2. Document text correction workflow in detail → [text-correction-workflow.md](./text-correction-workflow.md)
3. Implement boundary workflow first
4. Test with real data
5. Implement text correction workflow
6. Iterate based on usage
