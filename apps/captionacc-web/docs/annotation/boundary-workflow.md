# Boundary Marking Workflow - Detailed Design

**Status:** Design Document (Planning Phase)
**Parent:** [overview.md](./overview.md)
**Purpose:** Visual identification of caption sequence boundaries

## Workflow Purpose

Efficiently mark start and end frames for caption and non-caption sequences through visual comparison, without text entry.

## Key Insight

**Caption transitions are visible when comparing frames:**

- Caption appears in 2 of 3 frames → at beginning or end of sequence
- Stacking frames vertically with tight spacing reveals character-level differences
- Wide frames (2/3 window width) maximize readability
- No text entry reduces cognitive load and speeds annotation

## UI Layout

```
┌────────────────────────────────────────────────────────────────┐
│  Nav: [Home] [Annotate]                    [Theme] [Settings]  │
├────────────────────────────────────────────────────────────────┤
│  Mode: ● Boundaries    ○ Text Correction                       │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────┬───────────────────────┐  │
│  │  FRAMES (2/3 width)              │  CONTROLS (1/3)       │  │
│  │  ═══════════════════════════════ │                       │  │
│  │                                  │  Video: video_001     │  │
│  │  ┌────────────────────────────┐  │  Frame: 145 / 25,000 │  │
│  │  │ Frame N-8                  │  │                       │  │
│  │  │ (very faded, opacity 0.3)  │  │  ──────────────────  │  │
│  │  ├────────────────────────────┤  │  Frame Spacing:      │  │
│  │  │ Frame N-4                  │  │  ┌──────────────┐    │  │
│  │  │ (faded, opacity 0.5)       │  │  │ Linear    ▼ │    │  │
│  │  ├────────────────────────────┤  │  ├─────────────┤    │  │
│  │  │ Frame N-2                  │  │  │ Linear      │    │  │
│  │  │ (dimmed, opacity 0.7)      │  │  │ Exponential │    │  │
│  │  ├────────────────────────────┤  │  │ Hybrid      │    │  │
│  │  │ Frame N-1                  │  │  └─────────────┘    │  │
│  │  │ (slight dim, opacity 0.9)  │  │                       │  │
│  │  ├────────────────────────────┤  │  ──────────────────  │  │
│  │  │ ►► Frame N (CURRENT) ◄◄    │  │  Boundaries:         │  │
│  │  │ (full opacity, ring)       │  │  Start: 140          │  │
│  │  ├────────────────────────────┤  │  End: not set        │  │
│  │  │ Frame N+1                  │  │                       │  │
│  │  │ (slight dim, opacity 0.9)  │  │  [Jump Start] A      │  │
│  │  ├────────────────────────────┤  │  [Mark Start] S      │  │
│  │  │ Frame N+2                  │  │  [Mark End]   D      │  │
│  │  │ (dimmed, opacity 0.7)      │  │  [Jump End]   F      │  │
│  │  ├────────────────────────────┤  │                       │  │
│  │  │ Frame N+4                  │  │  ──────────────────  │  │
│  │  │ (faded, opacity 0.5)       │  │  Sequence Type:      │  │
│  │  ├────────────────────────────┤  │  ● Caption (TBD)     │  │
│  │  │ Frame N+8                  │  │  ○ Non-caption       │  │
│  │  │ (very faded, opacity 0.3)  │  │                       │  │
│  │  └────────────────────────────┘  │  ──────────────────  │  │
│  │                                  │  [Clear Marks]       │  │
│  │  Navigation:                     │  [Save & Next] Enter │  │
│  │  ↕ Mouse wheel: scroll frames    │                       │  │
│  │  ⌨ Arrows: ±1 frame              │  ──────────────────  │  │
│  │  ⌨ Shift+Arrow: ±10 frames       │  Predicted:          │  │
│  │  ⌨ Ctrl+Arrow: ±50 frames        │  Start: 140 (±2)     │  │
│  │                                  │  End: 147 (±2)       │  │
│  │                                  │  [View Prediction]   │  │
│  └──────────────────────────────────┴───────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Session History (45 annotations):                        │  │
│  │ [#45: 140-147 Caption] [#44: 130-138 Non-cap] ...        │  │
│  │ Click to review                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

## Visual Design

### Frame Stack

**Vertical alignment:**

- All frames same width (constrained to 2/3 viewport)
- Tight vertical spacing (1-4px gap)
- Frames stack in scrollable container
- Current frame highlighted with ring/border

**Opacity gradient:**

- Current frame: 100% opacity, teal ring
- ±1 frame: 90% opacity
- ±2 frame: 70% opacity
- ±4 frame: 50% opacity
- ±8 frame: 30% opacity

**Purpose:** Visual focus on current frame while maintaining context.

### Frame Spacing Options

**Linear (Default):**

```
Offsets: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
Total frames shown: 11
```

**Exponential:**

```
Offsets: [-8, -4, -2, -1, 0, 1, 2, 4, 8]
Total frames shown: 9
```

**Hybrid:**

```
Offsets: [-10, -5, -3, -2, -1, 0, 1, 2, 3, 5, 10]
Total frames shown: 11
```

**Configuration:**

- Dropdown in controls panel
- Persists per video (localStorage)
- Updates visible frames immediately

## Interaction Model

### Navigation

**Mouse:**

- Scroll wheel: Move through frames (±1 frame per scroll tick)
- Click frame in stack: Jump to that frame (optional feature)

**Keyboard:**

- `↑/↓` or `←/→`: ±1 frame
- `Shift + Arrow`: ±10 frames
- `Ctrl + Arrow`: ±50 frames
- `A`: Jump to predicted/marked start frame
- `S`: Mark current frame as start
- `D`: Mark current frame as end
- `F`: Jump to predicted/marked end frame
- `Enter`: Save annotation and load next
- `Esc`: Clear current marks

### Marking Flow

**Typical workflow:**

1. Start at frame suggested by system or random
2. Navigate to find caption boundary
3. Mark start frame (S key)
4. Navigate forward to find end
5. Mark end frame (D key)
6. Choose sequence type (Caption/Non-caption)
7. Save and advance to next (Enter)

**With predictions:**

1. System provides predicted start/end
2. Jump to start (A key)
3. Navigate to verify/adjust
4. Mark correct start (S key)
5. Jump to predicted end (F key)
6. Navigate to verify/adjust
7. Mark correct end (D key)
8. Save (Enter)

**Visual feedback:**

- Marked start frame: Orange left border
- Marked end frame: Orange right border
- Range between marks: Light orange background
- Current frame: Teal ring (always visible)

## Controls Panel

### Frame Information

```
Video: video_001
Frame: 145 / 25,000
Progress: 0.58%
```

### Frame Spacing Selector

```
Frame Spacing: [Linear ▼]
  ├ Linear (1,1,1...)
  ├ Exponential (1,2,4,8...)
  └ Hybrid (1,2,3,5,10...)
```

### Boundary Marking

```
Boundaries:
  Start: 140
  End: not set

[Jump Start] A
[Mark Start] S
[Mark End] D
[Jump End] F
```

### Sequence Type

```
Sequence Type:
  ● Caption (text TBD)
  ○ Non-caption
```

**Meaning:**

- Caption: Frames contain caption text, text will be determined later
- Non-caption: Frames do not contain caption text

**Data saved:**

- Caption: `annotation_type: 'caption'`, `text: 'NOT_YET_DETERMINED'`
- Non-caption: `annotation_type: 'non_caption'`, `text: null`

### Predicted Boundaries (Optional)

```
Predicted:
  Start: 140 (±2)
  End: 147 (±2)
  [View Prediction]
```

**Behavior:**

- Show if predictions available for current position
- Click "View Prediction" to jump to predicted start
- Confidence range shown (±2 frames means prediction may be off by 2)

### Actions

```
[Clear Marks]        - Reset start/end without saving
[Save & Next] Enter  - Save annotation, load next position
```

## Session History

**Bottom panel:**

```
Session History (45 annotations):
[#45: 140-147 Caption] [#44: 130-138 Non-cap] [#43: 120-128 Caption] ...
```

**Features:**

- Shows all annotations from current session
- Click to jump back and review
- Highlights current annotation
- Scrollable horizontally

**Display format:**

```
#<id>: <start>-<end> <type>
```

## State Management

### Component State

```typescript
interface BoundaryWorkflowState {
  videoId: string
  currentFrameIndex: number
  totalFrames: number

  markedStart: number | null
  markedEnd: number | null
  sequenceType: 'caption' | 'non_caption'

  frameSpacing: 'linear' | 'exponential' | 'hybrid'
  visibleFrameIndices: number[]

  predictedStart?: number
  predictedEnd?: number

  sessionHistory: Annotation[]
}
```

### Computed Values

```typescript
// Calculate visible frames based on spacing
const visibleFrameIndices = useMemo(() => {
  const offsets = getOffsetsForSpacing(frameSpacing)
  return offsets
    .map(offset => currentFrameIndex + offset)
    .filter(idx => idx >= 0 && idx < totalFrames)
}, [currentFrameIndex, frameSpacing, totalFrames])

// Calculate opacity for frame distance
const getOpacity = (frameIndex: number) => {
  const distance = Math.abs(frameIndex - currentFrameIndex)
  const opacityMap = {
    0: 1.0,
    1: 0.9,
    2: 0.7,
    3: 0.6,
    4: 0.5,
    5: 0.4,
    8: 0.3,
    10: 0.2,
  }
  return opacityMap[distance] ?? 0.3
}

// Check if can save
const canSave = markedStart !== null && markedEnd !== null && markedStart < markedEnd
```

## API Integration

### Load Next Annotation Position

```typescript
GET /api/annotations/next?mode=boundaries&video_id=video_001

Response:
{
  video_id: "video_001",
  suggested_frame_index: 145,
  total_frames: 25000,
  predicted_start?: 140,
  predicted_end?: 147,
  prediction_confidence?: 0.85
}
```

### Load Frames

```typescript
GET /api/frames/video_001/range?start=140&end=150

Response:
{
  frames: [
    {
      frame_index: 140,
      image_url: "/!__local/data/_has_been_deprecated__!/video_001/crop_frames/frame_0140.png",
      ocr_text: "Hello, how are you?"  // Not used in boundaries workflow
    },
    ...
  ]
}
```

### Save Annotation

```typescript
POST /api/annotations

Body:
{
  video_id: "video_001",
  start_frame_index: 140,
  end_frame_index: 147,
  annotation_type: "caption",
  text: "NOT_YET_DETERMINED",
  status: "pending_text",
  notes: ""
}

Response:
{
  id: 45,
  created_at: "2025-12-22T10:30:00Z"
}
```

## Implementation Notes

### Frame Loading Strategy

**Three-tier priority system** (ensures instant navigation for all workflows):

**1. Jump Loading (HIGHEST PRIORITY)**:

When user explicitly navigates (Jump to Frame, Prev button, keyboard shortcuts):

- Preloading pauses immediately (yields bandwidth)
- Loads modulo_1 (finest, every non-4th frame) FIRST around jump target (±32 frames)
- **Blocks navigation** until exact frames loaded
- User sees high-quality frames immediately on arrival
- Then continues normal progressive loading

**2. Normal Progressive Loading (MEDIUM PRIORITY)**:

During normal scrolling/annotation work:

- Loads coarse-to-fine hierarchy: modulo_16 → modulo_4 → modulo_1
- **modulo_16**: Every 16th frame, range ±512 frames (coarse overview)
- **modulo_4**: Every 4th frame (excluding 16th), range ±128 frames (fine detail)
- **modulo_1**: Remaining frames (excluding 4th), range ±32 frames (complete coverage)
- Triggers when moved >3 frames
- Runs continuously (100ms polling)

**3. Next Annotation Preloading (LOWEST PRIORITY)**:

Background optimization for seamless "Next" workflow:

- Starts **immediately** when next annotation identified
- Runs once per annotation (tracked by ID)
- **Automatically yields** to explicit jumps
- For short annotations (<500 frames):
  - Loads ALL modulos completely
  - **Goal**: User clicks "Next" → sees frames instantly (no wait)
- For long annotations (>500 frames):
  - Loads modulo_16 across annotation (overview)
  - Loads modulo_4 near boundaries (precision)
  - Defers modulo_1 until user arrives

**Caching with Smart Pinning:**

- Per-modulo cache limits: 40/50/60 chunks (modulo 16/4/1)
- **Pinned chunks** (never evicted):
  - Active annotation: `[start-20, end+20]` frames (smooth boundary adjustments)
  - Next annotation: `[start-20, end+20]` frames (instant navigation)
- Unpinned chunks: LRU eviction when over limit
- Total cache: ~75-130MB (very reasonable for modern browsers)

### Scroll Performance

**Optimize for smooth scrolling:**

- Virtualize frame list (only render visible frames)
- Use `transform: translateY()` for scroll (GPU accelerated)
- Debounce frame index updates (100ms)
- Lazy load images with blur placeholder

### Keyboard Event Handling

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      const jump = e.ctrlKey ? 50 : e.shiftKey ? 10 : 1
      setCurrentFrameIndex(prev => Math.min(prev + jump, totalFrames - 1))
    }
    // ... other keys
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [currentFrameIndex, totalFrames])
```

## Testing Considerations

**Test with:**

- Short sequences (2-5 frames)
- Medium sequences (20-30 frames)
- Long sequences (50+ frames)
- Very long non-caption sequences (100+ frames)

**Verify:**

- Smooth scrolling through thousands of frames
- Correct boundary marking
- Session history persistence
- Frame spacing changes apply correctly
- Keyboard shortcuts work reliably

## Open Questions

1. Should clicking a frame in the stack jump to it, or is that too error-prone?
2. Should we show a minimap/progress bar for position in video?
3. Should predicted boundaries be auto-marked, or just suggested?
4. What's the best way to handle the very first frame (no context before) and last frame (no context after)?
