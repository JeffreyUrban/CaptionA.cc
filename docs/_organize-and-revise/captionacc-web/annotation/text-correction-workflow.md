# Text Annotation Workflow - Design Document

# TODO: The database details in this doc are out of date.

**Status:** Planning Phase - See [/TEXT_ANNOTATION_PLANNING.md](../../../../docs/data-architecture/archive-revise-or-remove/TEXT_ANNOTATION_PLANNING.md) for current implementation plan
**Parent:** [overview.md](overview.md)
**Purpose:** Determine and correct caption text for annotated sequences

---

**Note:** This document contains the original UX/UI design. For the current implementation plan including database schema, API routes, and technical decisions, see the comprehensive planning document at `/TEXT_ANNOTATION_PLANNING.md`.

After implementation is complete, this document will be updated to describe the actual implementation as work product documentation.

---

## Workflow Purpose

Review OCR-extracted text from all frames in a caption sequence, identify character inconsistencies, and produce accurate caption text.

## Key Insight

**OCR text varies across frames in predictable ways:**

- Certain character positions oscillate between options (e.g., 'a' vs 'o')
- Extra errant text appears before/after the main caption
- Consistent characters across many frames are likely correct
- Highlighting inconsistencies and providing click-to-cycle correction is more efficient than manual typing

## UI Layout

```
┌────────────────────────────────────────────────────────────────┐
│  Nav: [Home] [Annotate]                    [Theme] [Settings]  │
├────────────────────────────────────────────────────────────────┤
│  Mode: ○ Boundaries    ● Text Correction                       │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────┬───────────────────────┐  │
│  │  FRAME + TEXT (2/3 width)        │  CONTROLS (1/3)       │  │
│  │  ═══════════════════════════════ │                       │  │
│  │                                  │  Annotation #45       │  │
│  │  ┌────────────────────────────┐  │  Video: video_001     │  │
│  │  │                            │  │  Range: 140-147       │  │
│  │  │   Frame 143 (current)      │  │  Frame: 143 / 147    │  │
│  │  │   [Wide caption frame]     │  │                       │  │
│  │  │                            │  │  ──────────────────  │  │
│  │  └────────────────────────────┘  │  Text Alignment:     │  │
│  │                                  │  Anchor X:           │  │
│  │  ▼ OCR Text (Frame 143):         │  [====|==] 60%       │  │
│  │  ┌────────────────────────────┐  │                       │  │
│  │  │ Hello, how ore you?        │  │  Font Size:          │  │
│  │  │          ^^^ inconsistent  │  │  [====|====] 18px    │  │
│  │  │ [green] [yellow] [green]   │  │                       │  │
│  │  └────────────────────────────┘  │  [Reset Alignment]   │  │
│  │  [Aligned with frame text]       │                       │  │
│  │                                  │  ──────────────────  │  │
│  │  ▼ Caption Text (editable):      │  Navigation:         │  │
│  │  ┌────────────────────────────┐  │  [← Prev] [Next →]   │  │
│  │  │ Hello, how are you?        │  │  Scroll: wheel       │  │
│  │  │          ^^^ click to cycle│  │                       │  │
│  │  │ [Click chars to fix]       │  │  ──────────────────  │  │
│  │  └────────────────────────────┘  │  Char Disagreements: │  │
│  │  [Aligned with frame text]       │                       │  │
│  │                                  │  Pos 11: a(6) o(1)   │  │
│  │  ═════════════════════════════   │  Click above to fix  │  │
│  │                                  │                       │  │
│  │  Frame OCR Comparison:           │  ──────────────────  │  │
│  │  ┌────────────────────────────┐  │  Status:             │  │
│  │  │ 140: "Hello, how are you?" │  │  [Valid Caption ▼]   │  │
│  │  │ 141: "Hello, how are you?" │  │                       │  │
│  │  │ 142: "Hello, how are you?" │  │  Notes (optional):   │  │
│  │  │►143: "Hello, how ore you?" │  │  ┌──────────────┐   │  │
│  │  │ 144: "Hello, how are you?" │  │  │              │   │  │
│  │  │ 145: "Hello, how are you?" │  │  └──────────────┘   │  │
│  │  │ 146: "Hello, how a  you?"  │  │                       │  │
│  │  │ 147: "Hello, how are you?" │  │  [Save] Enter        │  │
│  │  └────────────────────────────┘  │  [Next TBD] Tab      │  │
│  │  [Scrollable, current marked]    │  [Skip] Esc          │  │
│  │                                  │                       │  │
│  └──────────────────────────────────┴───────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Session History (45 total, 12 need text):                │  │
│  │ [#45: needs text] [#44: ✓] [#43: needs text] ...         │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

## Visual Design

### Frame Display

**Single frame view:**

- Current frame from annotation range
- Full width (2/3 of viewport)
- High quality, readable caption text in frame

### Text Alignment

**Goal:** Align OCR and Caption text fields horizontally with the text position in the frame.

**Controls:**

- Anchor X slider: 0-100% (horizontal offset from left)
- Font Size slider: 12-48px
- Real-time preview as sliders adjust
- Settings persist per video (localStorage)

**Visual alignment:**

```
┌─────────────────────────────────┐
│ [Frame with caption text]       │
│         "Hello, world"          │ ← Text in frame at ~60% from left
└─────────────────────────────────┘
         ↓ (vertically aligned)
┌─────────────────────────────────┐
│       "Hello, world"            │ ← OCR text positioned at 60%
└─────────────────────────────────┘
         ↓
┌─────────────────────────────────┐
│       "Hello, world"            │ ← Caption text positioned at 60%
└─────────────────────────────────┘
```

### OCR Text Display

**Read-only text display below frame:**

- Monospace font for character alignment
- Character-level highlighting:
  - Green background: Consistent across frames (appears in 80%+ of frames)
  - Yellow background: Inconsistent (multiple variants exist)
  - Red background: Errant text (appears in <20% of frames)
- Not editable (for reference only)

### Caption Text Field

**Editable text below OCR:**

- Initially populated from most common OCR text when entering workflow
- Monospace font matching OCR display
- Same horizontal alignment as OCR text
- Character-level interaction:
  - Click any character to cycle through variants
  - Hover shows tooltip with options and counts
  - Yellow highlight on characters with >1 variant
  - Cursor indicates clickable characters

**Example interaction:**

```
OCR:     Hello, how ore you?
                   ^^^ (yellow - inconsistent)

Caption: Hello, how are you?
                   ^^^ (click to cycle: a(6) → o(1) → a(6) ...)
```

### Frame OCR Comparison Panel

**List of all frames in range with their OCR text:**

```
140: "Hello, how are you?"
141: "Hello, how are you?"
142: "Hello, how are you?"
►143: "Hello, how ore you?"    ← Current frame (highlighted)
144: "Hello, how are you?"
145: "Hello, how are you?"
146: "Hello, how a  you?"      ← Different inconsistency
147: "Hello, how are you?"
```

**Features:**

- Scrollable list
- Current frame highlighted/marked
- Click frame to jump to it
- Shows all text at once for quick scanning
- Helps identify patterns in OCR errors

## Character Variant Analysis

### Algorithm

For each character position across all frames:

1. Collect all characters at that position
2. Count frequency of each variant
3. Determine consistency threshold (e.g., 80%)
4. Classify as consistent/inconsistent

```typescript
interface CharacterVariant {
  position: number
  variants: Array<{ char: string; count: number }>
  isConsistent: boolean
  mostCommon: string
}

function analyzeCharacterVariants(frames: Frame[]): CharacterVariant[] {
  const maxLength = Math.max(...frames.map(f => f.ocr_text.length))
  const variants: CharacterVariant[] = []

  for (let pos = 0; pos < maxLength; pos++) {
    const chars = frames.map(f => f.ocr_text[pos] || ' ').filter(c => c)
    const charCounts = chars.reduce(
      (acc, char) => {
        acc[char] = (acc[char] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    const variantList = Object.entries(charCounts)
      .map(([char, count]) => ({ char, count }))
      .sort((a, b) => b.count - a.count)

    const mostCommon = variantList[0]
    const consistencyThreshold = 0.8
    const isConsistent = mostCommon.count / frames.length >= consistencyThreshold

    variants.push({
      position: pos,
      variants: variantList,
      isConsistent,
      mostCommon: mostCommon.char,
    })
  }

  return variants
}
```

### Character Highlighting

**OCR Text (read-only):**

- Green: Consistent (≥80% agreement)
- Yellow: Inconsistent (multiple variants)
- Red: Errant (appears in <20% of frames)

**Caption Text (editable):**

- No highlight: Consistent (no action needed)
- Yellow highlight: Inconsistent (click to cycle)
- Hover tooltip: Shows all variants with counts

### Click-to-Cycle Interaction

```typescript
function cycleCharacter(position: number) {
  const variant = characterVariants.find(v => v.position === position)
  if (!variant || variant.variants.length <= 1) return

  const currentChar = captionText[position]
  const currentIdx = variant.variants.findIndex(v => v.char === currentChar)
  const nextIdx = (currentIdx + 1) % variant.variants.length
  const nextChar = variant.variants[nextIdx].char

  setCaptionText(
    captionText.substring(0, position) + nextChar + captionText.substring(position + 1)
  )
}
```

**User experience:**

1. User sees yellow highlight on 'o' in "how ore you?"
2. Hovers to see tooltip: "a(6) | o(1)"
3. Clicks character
4. Character changes to 'a' (most common variant)
5. Clicks again if needed to cycle through all options
6. Highlight remains until only one variant selected

## Controls Panel

### Annotation Info

```
Annotation #45
Video: video_001
Range: 140-147
Frame: 143 / 147
```

### Text Alignment Controls

```
Text Alignment:
  Anchor X: [====|==] 60%
  Font Size: [====|====] 18px
  [Reset to Defaults]
```

**Behavior:**

- Sliders update alignment in real-time
- Values persist per video in localStorage
- Reset button restores default values (50%, 16px)

### Navigation

```
Navigation:
  [← Prev Frame] [Next Frame →]
  Scroll: Mouse wheel
  Current: 143 / 147
```

**Keyboard shortcuts:**

- `←/→` or `↑/↓`: Navigate between frames in range
- `Home`: Jump to first frame in range
- `End`: Jump to last frame in range
- `Space`: Toggle frame OCR comparison panel expand

### Character Disagreements Summary

```
Character Disagreements:
  Pos 11: a(6) o(1)
  Pos 16: r(7) (1)
  [Click characters above to cycle]
```

**Purpose:** Quick reference for which positions have issues.

### Status & Notes

```
Status: [Valid Caption ▼]
  ├ Valid Caption
  ├ OCR Error
  ├ Partial Caption
  ├ Text Unclear
  └ Other Issue

Notes (optional):
  ┌──────────────────┐
  │                  │
  └──────────────────┘
```

### Actions

```
[Save] Enter         - Save text and mark complete
[Next TBD] Tab       - Save and jump to next needing text
[Skip] Esc           - Skip for now, leave as TBD
```

## Interaction Model

### Initial Load

When loading annotation for text correction:

1. Fetch annotation with `text: 'NOT_YET_DETERMINED'`
2. Load all frames in range (start to end)
3. Analyze character variants across frames
4. Populate caption text with most common variant at each position
5. Highlight inconsistent positions in yellow
6. Set current frame to middle of range

### Frame Navigation

**Within annotation range:**

- Navigate with arrow keys or mouse wheel
- OCR text updates to show current frame
- Caption text remains editable
- Frame OCR comparison highlights current frame

**Purpose:** See OCR text for each frame to inform text correction decisions.

### Text Editing

**Two modes:**

1. **Click-to-cycle** (recommended for character-level fixes):
   - Click highlighted character
   - Cycles through variants by frequency
   - Fast for correcting oscillating characters

2. **Direct typing** (for major corrections):
   - Click in text field
   - Type normally
   - Use for adding/removing words, fixing structure

**Auto-suggestions:**

- On load, caption text = most common OCR text
- Character positions with disagreements highlighted
- Tooltip shows options with vote counts

### Saving

**Save triggers:**

- Click "Save" button
- Press Enter key
- Auto-validate before saving

**Validation:**

- Text must not be empty (unless status is "No Caption")
- Text should differ from "NOT_YET_DETERMINED"
- Warn if text identical to OCR text (may want review)

**After save:**

- Mark annotation as complete
- Load next annotation with `text: 'NOT_YET_DETERMINED'`
- Update session history

## State Management

### Component State

```typescript
interface TextCorrectionState {
  annotationId: number
  videoId: string
  startFrameIndex: number
  endFrameIndex: number
  currentFrameIndex: number

  frames: Frame[]
  characterVariants: CharacterVariant[]

  captionText: string
  status: string
  notes: string

  textAlignment: {
    anchor_x: number
    font_size: number
  }

  sessionHistory: Annotation[]
}
```

### Computed Values

```typescript
// Current frame object
const currentFrame = frames.find(f => f.frame_index === currentFrameIndex)

// Total frames in range
const totalFramesInRange = endFrameIndex - startFrameIndex + 1

// Progress through range
const frameProgress = (currentFrameIndex - startFrameIndex) / totalFramesInRange

// Can save
const canSave = captionText.length > 0 && captionText !== 'NOT_YET_DETERMINED'

// Character at position has variants
const hasVariants = (position: number) => {
  const variant = characterVariants.find(v => v.position === position)
  return variant && variant.variants.length > 1
}
```

## API Integration

### Load Annotation for Text Correction

```typescript
GET /api/annotations/next?mode=text&video_id=video_001

Response:
{
  id: 45,
  video_id: "video_001",
  start_frame_index: 140,
  end_frame_index: 147,
  annotation_type: "caption",
  text: "NOT_YET_DETERMINED",
  status: "pending_text"
}
```

### Load Frames in Range

```typescript
GET /api/frames/video_001/range?start=140&end=147

Response:
{
  frames: [
    {
      frame_index: 140,
      image_url: "/!__local/data/_has_been_deprecated__!/video_001/crop_frames/frame_0140.png",
      ocr_text: "Hello, how are you?"
    },
    ...
  ]
}
```

### Save Corrected Text

```typescript
PUT /api/annotations/45

Body:
{
  text: "Hello, how are you?",
  status: "valid_caption",
  notes: "Corrected 'ore' to 'are' at position 11"
}

Response:
{
  id: 45,
  updated_at: "2025-12-22T10:45:00Z"
}
```

## Implementation Notes

### Text Alignment Persistence

Store per-video in localStorage:

```typescript
const STORAGE_KEY = 'caption-text-alignment'

function saveAlignment(videoId: string, alignment: TextAlignment) {
  const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  settings[videoId] = alignment
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

function loadAlignment(videoId: string): TextAlignment {
  const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  return settings[videoId] || { anchor_x: 50, font_size: 16 }
}
```

### Character Variant Caching

Cache analysis results to avoid recalculating:

```typescript
const [characterVariants, setCharacterVariants] = useState<CharacterVariant[]>([])

useEffect(() => {
  if (frames.length > 0) {
    const variants = analyzeCharacterVariants(frames)
    setCharacterVariants(variants)
  }
}, [frames])
```

### Keyboard Event Handling

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Don't capture if typing in text field
    if (document.activeElement?.tagName === 'TEXTAREA') return

    if (e.key === 'ArrowRight') {
      e.preventDefault()
      navigateNextFrame()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      navigatePrevFrame()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      saveCorrectedText()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      saveAndLoadNextTBD()
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [currentFrameIndex, captionText])
```

## Testing Considerations

**Test with:**

- Short captions (5-10 characters)
- Long captions (50+ characters)
- Multi-line captions
- Captions with special characters
- Frames with very inconsistent OCR
- Frames with completely different OCR (catch errors)

**Verify:**

- Character cycling works correctly
- Text alignment adjusts properly
- All frames in range load correctly
- Saving updates annotation correctly
- Session history updates after save
- Next TBD loads correct annotation

## Open Questions

1. Should we auto-save text as user makes changes, or only on explicit save?
2. Should we show a confidence score for each character based on variant frequency?
3. Should we support bulk operations (e.g., "accept all most common variants")?
4. How to handle cases where OCR is completely wrong across all frames?
5. Should we allow editing the OCR text itself (to improve OCR training data)?
