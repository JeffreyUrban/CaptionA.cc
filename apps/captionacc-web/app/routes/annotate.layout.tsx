import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { LayoutActionButtons } from '~/components/annotation/LayoutActionButtons'
import { LayoutAnnotationProgress } from '~/components/annotation/LayoutAnnotationProgress'
import { LayoutColorLegend } from '~/components/annotation/LayoutColorLegend'
import { LayoutCurrentFrameInfo } from '~/components/annotation/LayoutCurrentFrameInfo'
import { LayoutInstructionsPanel } from '~/components/annotation/LayoutInstructionsPanel'
import { LayoutParametersDisplay } from '~/components/annotation/LayoutParametersDisplay'
import { LayoutThumbnailGrid } from '~/components/annotation/LayoutThumbnailGrid'
import { useKeyboardShortcuts } from '~/hooks/useKeyboardShortcuts'
import { useVideoTouched } from '~/hooks/useVideoTouched'

interface FrameInfo {
  frameIndex: number
  totalBoxCount: number
  captionBoxCount: number
  minConfidence: number
  hasAnnotations: boolean
  hasUnannotatedBoxes: boolean
  imageUrl: string
}

interface LayoutConfig {
  frameWidth: number
  frameHeight: number
  cropLeft: number
  cropTop: number
  cropRight: number
  cropBottom: number
  selectionLeft: number | null
  selectionTop: number | null
  selectionRight: number | null
  selectionBottom: number | null
  verticalPosition: number | null
  verticalStd: number | null
  boxHeight: number | null
  boxHeightStd: number | null
  anchorType: 'left' | 'center' | 'right' | null
  anchorPosition: number | null
  topEdgeStd: number | null
  bottomEdgeStd: number | null
  horizontalStdSlope: number | null
  horizontalStdIntercept: number | null
  cropBoundsVersion: number
}

interface BoxData {
  boxIndex: number
  text: string
  originalBounds: { left: number; top: number; right: number; bottom: number }
  displayBounds: { left: number; top: number; right: number; bottom: number }
  predictedLabel: 'in' | 'out'
  predictedConfidence: number
  userLabel: 'in' | 'out' | null
  colorCode: string
}

interface FrameBoxesData {
  frameIndex: number
  imageUrl: string
  cropBounds: { left: number; top: number; right: number; bottom: number }
  frameWidth: number
  frameHeight: number
  boxes: BoxData[]
}

type ViewMode = 'analysis' | 'frame'

// --- Canvas Drawing Types ---
interface BoxRenderParams {
  box: BoxData
  boxIndex: number
  scale: number
  hoveredBoxIndex: number | null
  boxHighlightMode: boolean
  pulseValue: number
  pulseIntensity: number
}

interface SelectionRenderParams {
  selectionStart: { x: number; y: number }
  selectionCurrent: { x: number; y: number }
  selectionLabel: 'in' | 'out' | 'clear'
  viewMode: ViewMode
}

// --- Canvas Drawing Helpers ---

/** Get box colors based on color code */
function getBoxColors(colorCode: string): { border: string; background: string } {
  const colorMap: Record<string, { border: string; background: string }> = {
    annotated_in: { border: '#14b8a6', background: 'rgba(20,184,166,0.25)' },
    annotated_out: { border: '#dc2626', background: 'rgba(220,38,38,0.25)' },
    predicted_in_high: { border: '#3b82f6', background: 'rgba(59,130,246,0.15)' },
    predicted_in_medium: { border: '#60a5fa', background: 'rgba(96,165,250,0.1)' },
    predicted_in_low: { border: '#93c5fd', background: 'rgba(147,197,253,0.08)' },
    predicted_out_high: { border: '#f97316', background: 'rgba(249,115,22,0.15)' },
    predicted_out_medium: { border: '#fb923c', background: 'rgba(251,146,60,0.1)' },
    predicted_out_low: { border: '#fdba74', background: 'rgba(253,186,116,0.08)' },
  }
  return colorMap[colorCode] ?? { border: '#9ca3af', background: 'rgba(156,163,175,0.1)' }
}

/** Get fill color for analysis box based on label and prediction */
function getAnalysisBoxFillColor(box: BoxData): string {
  if (box.userLabel === 'in') {
    return 'rgba(20,184,166,0.05)'
  }
  if (box.userLabel === 'out') {
    return 'rgba(220,38,38,0.05)'
  }
  if (box.predictedLabel === 'in') {
    if (box.predictedConfidence >= 0.75) return 'rgba(59,130,246,0.03)'
    if (box.predictedConfidence >= 0.5) return 'rgba(96,165,250,0.02)'
    return 'rgba(147,197,253,0.015)'
  }
  // Predicted out
  if (box.predictedConfidence >= 0.75) return 'rgba(249,115,22,0.03)'
  if (box.predictedConfidence >= 0.5) return 'rgba(251,146,60,0.02)'
  return 'rgba(253,186,116,0.015)'
}

/** Draw a single box in frame mode with optional pulsing highlight */
function drawFrameBox(ctx: CanvasRenderingContext2D, params: BoxRenderParams): void {
  const { box, boxIndex, scale, hoveredBoxIndex, boxHighlightMode, pulseValue, pulseIntensity } =
    params

  const boxX = box.originalBounds.left * scale
  const boxY = box.originalBounds.top * scale
  const boxWidth = (box.originalBounds.right - box.originalBounds.left) * scale
  const boxHeight = (box.originalBounds.bottom - box.originalBounds.top) * scale

  const colors = getBoxColors(box.colorCode)
  ctx.fillStyle = colors.background

  // Determine line width with pulsing effect for unannotated boxes
  const isUnannotated = box.userLabel === null
  let lineWidth = 2
  if (hoveredBoxIndex === boxIndex) {
    lineWidth = 3
  } else if (boxHighlightMode && isUnannotated) {
    lineWidth = 2 + pulseValue * pulseIntensity * 3
  }
  ctx.lineWidth = lineWidth

  ctx.fillRect(boxX, boxY, boxWidth, boxHeight)

  // Draw border with shadow/glow for unannotated boxes in highlight mode
  if (boxHighlightMode && isUnannotated && hoveredBoxIndex !== boxIndex) {
    const shadowIntensity = pulseValue * pulseIntensity
    if (shadowIntensity > 0.1) {
      ctx.shadowBlur = 8 * shadowIntensity
      ctx.shadowColor = `rgba(255, 255, 255, ${0.9 * shadowIntensity})`
      ctx.strokeStyle = colors.border
      ctx.lineWidth = lineWidth
      ctx.strokeRect(boxX, boxY, boxWidth, boxHeight)

      ctx.shadowColor = `rgba(0, 0, 0, ${0.9 * shadowIntensity})`
      ctx.strokeRect(boxX, boxY, boxWidth, boxHeight)
      ctx.shadowBlur = 0
    } else {
      ctx.strokeStyle = colors.border
      ctx.lineWidth = lineWidth
      ctx.strokeRect(boxX, boxY, boxWidth, boxHeight)
    }
  } else {
    ctx.strokeStyle = colors.border
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight)
  }

  // Draw text label if hovered
  if (hoveredBoxIndex === boxIndex) {
    drawBoxLabel(ctx, box, boxX, boxY, boxWidth, boxHeight)
  }
}

/** Draw box text label when hovered */
function drawBoxLabel(
  ctx: CanvasRenderingContext2D,
  box: BoxData,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number
): void {
  const fontSize = Math.max(Math.floor(boxHeight), 10)
  const labelHeight = fontSize + 8

  ctx.font = `${fontSize}px monospace`
  const textWidth = ctx.measureText(box.text).width
  const labelWidth = Math.max(boxWidth, textWidth + 8)

  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
  ctx.fillRect(boxX, boxY - labelHeight, labelWidth, labelHeight)

  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(box.text, boxX + labelWidth / 2, boxY - labelHeight / 2)

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
}

/** Draw layout parameter overlays (crop bounds, selection rect, guidelines) */
function drawLayoutOverlays(
  ctx: CanvasRenderingContext2D,
  layoutConfig: LayoutConfig,
  scale: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  // Crop bounds (red, dashed)
  ctx.strokeStyle = '#ef4444'
  ctx.lineWidth = 2
  ctx.setLineDash([15, 5])
  const cropX = layoutConfig.cropLeft * scale
  const cropY = layoutConfig.cropTop * scale
  const cropW = (layoutConfig.cropRight - layoutConfig.cropLeft) * scale
  const cropH = (layoutConfig.cropBottom - layoutConfig.cropTop) * scale
  ctx.strokeRect(cropX, cropY, cropW, cropH)
  ctx.setLineDash([])

  // Selection rectangle (blue, dashed)
  if (
    layoutConfig.selectionLeft !== null &&
    layoutConfig.selectionTop !== null &&
    layoutConfig.selectionRight !== null &&
    layoutConfig.selectionBottom !== null
  ) {
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 3
    ctx.setLineDash([10, 5])
    const selX = layoutConfig.selectionLeft * scale
    const selY = layoutConfig.selectionTop * scale
    const selW = (layoutConfig.selectionRight - layoutConfig.selectionLeft) * scale
    const selH = (layoutConfig.selectionBottom - layoutConfig.selectionTop) * scale
    ctx.strokeRect(selX, selY, selW, selH)
    ctx.setLineDash([])
  }

  // Vertical center line (purple, dashed)
  if (layoutConfig.verticalPosition !== null) {
    ctx.strokeStyle = '#8b5cf6'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 3])
    const lineY = layoutConfig.verticalPosition * scale
    ctx.beginPath()
    ctx.moveTo(0, lineY)
    ctx.lineTo(canvasWidth, lineY)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Anchor line (orange, dashed)
  if (layoutConfig.anchorType !== null && layoutConfig.anchorPosition !== null) {
    ctx.strokeStyle = '#f59e0b'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 3])
    const lineX = layoutConfig.anchorPosition * scale
    ctx.beginPath()
    ctx.moveTo(lineX, 0)
    ctx.lineTo(lineX, canvasHeight)
    ctx.stroke()
    ctx.setLineDash([])
  }
}

/** Draw selection rectangle during drag operation */
function drawSelectionRectangle(
  ctx: CanvasRenderingContext2D,
  params: SelectionRenderParams
): void {
  const { selectionStart, selectionCurrent, selectionLabel, viewMode } = params

  const selLeft = Math.min(selectionStart.x, selectionCurrent.x)
  const selTop = Math.min(selectionStart.y, selectionCurrent.y)
  const selWidth = Math.abs(selectionCurrent.x - selectionStart.x)
  const selHeight = Math.abs(selectionCurrent.y - selectionStart.y)

  let selColor: string
  let selBgColor: string

  if (viewMode === 'analysis') {
    selColor = selectionLabel === 'clear' ? '#6b7280' : '#ef4444'
    selBgColor = selectionLabel === 'clear' ? 'rgba(107,114,128,0.15)' : 'rgba(239,68,68,0.15)'
  } else {
    selColor = selectionLabel === 'in' ? '#10b981' : '#ef4444'
    selBgColor = selectionLabel === 'in' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'
  }

  ctx.strokeStyle = selColor
  ctx.fillStyle = selBgColor
  ctx.lineWidth = 3
  ctx.setLineDash([5, 5])

  ctx.fillRect(selLeft, selTop, selWidth, selHeight)
  ctx.strokeRect(selLeft, selTop, selWidth, selHeight)

  ctx.setLineDash([])
}

// --- Keyboard Shortcut Handlers ---

interface KeyboardShortcutContext {
  viewMode: ViewMode
  selectedFrameIndex: number | null
  frames: FrameInfo[]
  hoveredBoxIndex: number | null
  currentFrameBoxes: FrameBoxesData | null
  isSelecting: boolean
  handleThumbnailClick: (frameIndex: number | 'analysis') => void
  handleBoxClick: (boxIndex: number, label: 'in' | 'out') => Promise<void>
  cancelSelection: () => void
}

function handleArrowLeft(ctx: KeyboardShortcutContext): void {
  if (ctx.viewMode === 'frame' && ctx.selectedFrameIndex !== null) {
    const currentIndex = ctx.frames.findIndex(f => f.frameIndex === ctx.selectedFrameIndex)
    if (currentIndex > 0) {
      const prevFrame = ctx.frames[currentIndex - 1]
      if (prevFrame) {
        ctx.handleThumbnailClick(prevFrame.frameIndex)
      }
    }
  }
}

function handleArrowRight(ctx: KeyboardShortcutContext): void {
  if (ctx.viewMode === 'frame' && ctx.selectedFrameIndex !== null) {
    const currentIndex = ctx.frames.findIndex(f => f.frameIndex === ctx.selectedFrameIndex)
    if (currentIndex < ctx.frames.length - 1) {
      const nextFrame = ctx.frames[currentIndex + 1]
      if (nextFrame) {
        ctx.handleThumbnailClick(nextFrame.frameIndex)
      }
    }
  } else if (ctx.viewMode === 'analysis' && ctx.frames.length > 0) {
    const firstFrame = ctx.frames[0]
    if (firstFrame) {
      ctx.handleThumbnailClick(firstFrame.frameIndex)
    }
  }
}

function handleEscape(ctx: KeyboardShortcutContext): void {
  if (ctx.isSelecting) {
    ctx.cancelSelection()
  } else {
    ctx.handleThumbnailClick('analysis')
  }
}

function handleMarkIn(ctx: KeyboardShortcutContext): void {
  if (ctx.hoveredBoxIndex !== null && ctx.currentFrameBoxes) {
    const box = ctx.currentFrameBoxes.boxes[ctx.hoveredBoxIndex]
    if (box) {
      void ctx.handleBoxClick(box.boxIndex, 'in')
    }
  }
}

function handleMarkOut(ctx: KeyboardShortcutContext): void {
  if (ctx.hoveredBoxIndex !== null && ctx.currentFrameBoxes) {
    const box = ctx.currentFrameBoxes.boxes[ctx.hoveredBoxIndex]
    if (box) {
      void ctx.handleBoxClick(box.boxIndex, 'out')
    }
  }
}

function handleNumberKey(ctx: KeyboardShortcutContext, key: string): void {
  const frameNum = parseInt(key) - 1
  if (frameNum < ctx.frames.length) {
    const targetFrame = ctx.frames[frameNum]
    if (targetFrame) {
      ctx.handleThumbnailClick(targetFrame.frameIndex)
    }
  }
}

function handleAnalysisViewShortcut(ctx: KeyboardShortcutContext): void {
  ctx.handleThumbnailClick('analysis')
}

/** Dispatch keyboard shortcut to appropriate handler. Returns true if handled. */
function dispatchKeyboardShortcut(key: string, ctx: KeyboardShortcutContext): boolean {
  // Arrow navigation
  if (key === 'ArrowLeft') {
    handleArrowLeft(ctx)
    return true
  }
  if (key === 'ArrowRight') {
    handleArrowRight(ctx)
    return true
  }

  // Escape
  if (key === 'Escape') {
    handleEscape(ctx)
    return true
  }

  // Mark in/out
  if (key === 'i' || key === 'I') {
    handleMarkIn(ctx)
    return true
  }
  if (key === 'o' || key === 'O') {
    handleMarkOut(ctx)
    return true
  }

  // Number keys 1-9 for frame navigation
  if (key >= '1' && key <= '9') {
    handleNumberKey(ctx, key)
    return true
  }

  // 0 for analysis view
  if (key === '0') {
    handleAnalysisViewShortcut(ctx)
    return true
  }

  return false
}

// --- Selection Completion Helpers ---

interface SelectionRectangle {
  left: number
  top: number
  right: number
  bottom: number
}

function calculateCanvasSelectionRect(
  selectionStart: { x: number; y: number },
  selectionCurrent: { x: number; y: number }
): SelectionRectangle {
  return {
    left: Math.min(selectionStart.x, selectionCurrent.x),
    top: Math.min(selectionStart.y, selectionCurrent.y),
    right: Math.max(selectionStart.x, selectionCurrent.x),
    bottom: Math.max(selectionStart.y, selectionCurrent.y),
  }
}

function convertToFrameCoordinates(
  canvasRect: SelectionRectangle,
  scaleX: number,
  scaleY: number
): SelectionRectangle {
  return {
    left: Math.floor(canvasRect.left * scaleX),
    top: Math.floor(canvasRect.top * scaleY),
    right: Math.floor(canvasRect.right * scaleX),
    bottom: Math.floor(canvasRect.bottom * scaleY),
  }
}

function findEnclosedBoxes(
  boxes: BoxData[],
  selectionRect: SelectionRectangle,
  scale: number
): { enclosedBoxes: number[]; newlyAnnotatedCount: number } {
  const enclosedBoxes: number[] = []
  let newlyAnnotatedCount = 0

  boxes.forEach(box => {
    const boxX = box.originalBounds.left * scale
    const boxY = box.originalBounds.top * scale
    const boxRight = box.originalBounds.right * scale
    const boxBottom = box.originalBounds.bottom * scale

    const isEnclosed =
      boxX >= selectionRect.left &&
      boxY >= selectionRect.top &&
      boxRight <= selectionRect.right &&
      boxBottom <= selectionRect.bottom

    if (isEnclosed) {
      enclosedBoxes.push(box.boxIndex)
      if (box.userLabel === null) {
        newlyAnnotatedCount++
      }
    }
  })

  return { enclosedBoxes, newlyAnnotatedCount }
}

// --- Click Handler Helpers ---

function findClickedBox(boxes: BoxData[], x: number, y: number, scale: number): number | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i]
    if (!box) continue

    const boxX = box.originalBounds.left * scale
    const boxY = box.originalBounds.top * scale
    const boxWidth = (box.originalBounds.right - box.originalBounds.left) * scale
    const boxHeight = (box.originalBounds.bottom - box.originalBounds.top) * scale

    if (x >= boxX && x <= boxX + boxWidth && y >= boxY && y <= boxY + boxHeight) {
      return box.boxIndex
    }
  }
  return null
}

function findHoveredBoxIndex(boxes: BoxData[], x: number, y: number, scale: number): number | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i]
    if (!box) continue

    const boxX = box.originalBounds.left * scale
    const boxY = box.originalBounds.top * scale
    const boxWidth = (box.originalBounds.right - box.originalBounds.left) * scale
    const boxHeight = (box.originalBounds.bottom - box.originalBounds.top) * scale

    if (x >= boxX && x <= boxX + boxWidth && y >= boxY && y <= boxY + boxHeight) {
      return i
    }
  }
  return null
}

// --- Layout Config State Update Helpers ---

interface LayoutQueueResponse {
  frames?: FrameInfo[]
  layoutConfig?: LayoutConfig
  layoutApproved?: boolean
}

interface EditStateUpdaters {
  setCropBoundsEdit: (
    value: { left: number; top: number; right: number; bottom: number } | null
  ) => void
  setSelectionRectEdit: (
    value: { left: number; top: number; right: number; bottom: number } | null
  ) => void
  setLayoutParamsEdit: (
    value: {
      verticalPosition: number | null
      verticalStd: number | null
      boxHeight: number | null
      boxHeightStd: number | null
      anchorType: 'left' | 'center' | 'right' | null
      anchorPosition: number | null
    } | null
  ) => void
}

function updateEditStateFromConfig(layoutConfig: LayoutConfig, updaters: EditStateUpdaters): void {
  updaters.setCropBoundsEdit({
    left: layoutConfig.cropLeft,
    top: layoutConfig.cropTop,
    right: layoutConfig.cropRight,
    bottom: layoutConfig.cropBottom,
  })

  const hasSelection =
    layoutConfig.selectionLeft !== null &&
    layoutConfig.selectionTop !== null &&
    layoutConfig.selectionRight !== null &&
    layoutConfig.selectionBottom !== null

  if (hasSelection) {
    updaters.setSelectionRectEdit({
      left: layoutConfig.selectionLeft as number,
      top: layoutConfig.selectionTop as number,
      right: layoutConfig.selectionRight as number,
      bottom: layoutConfig.selectionBottom as number,
    })
  } else {
    updaters.setSelectionRectEdit(null)
  }

  updaters.setLayoutParamsEdit({
    verticalPosition: layoutConfig.verticalPosition,
    verticalStd: layoutConfig.verticalStd,
    boxHeight: layoutConfig.boxHeight,
    boxHeightStd: layoutConfig.boxHeightStd,
    anchorType: layoutConfig.anchorType,
    anchorPosition: layoutConfig.anchorPosition,
  })
}

function handleLoadQueueResponse(
  data: LayoutQueueResponse,
  skipEditStateUpdate: boolean,
  setFrames: (frames: FrameInfo[]) => void,
  setLayoutConfig: (config: LayoutConfig | null) => void,
  setLayoutApproved: (approved: boolean) => void,
  editUpdaters: EditStateUpdaters
): void {
  setFrames(data.frames ?? [])
  setLayoutConfig(data.layoutConfig ?? null)
  setLayoutApproved(data.layoutApproved ?? false)

  if (data.layoutConfig && !skipEditStateUpdate) {
    updateEditStateFromConfig(data.layoutConfig, editUpdaters)
  }
}

// Loader function to expose environment variables
export async function loader() {
  return {
    defaultVideoId: process.env['DEFAULT_VIDEO_ID'] ?? '',
  }
}

export default function AnnotateLayout() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const videoId = searchParams.get('videoId') ?? ''

  // Core state
  const [frames, setFrames] = useState<FrameInfo[]>([])
  const [layoutConfig, setLayoutConfig] = useState<LayoutConfig | null>(null)
  const [layoutApproved, setLayoutApproved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('analysis')
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null)
  const [currentFrameBoxes, setCurrentFrameBoxes] = useState<FrameBoxesData | null>(null)
  const [loadingFrame, setLoadingFrame] = useState(false)
  const [analysisBoxes, setAnalysisBoxes] = useState<BoxData[] | null>(null)
  const [hasUnsyncedAnnotations, setHasUnsyncedAnnotations] = useState(false)
  const [annotationsSinceRecalc, setAnnotationsSinceRecalc] = useState(0)
  const RECALC_THRESHOLD = 50 // Recalculate crop bounds after this many annotations

  // Calculate caption box statistics
  const boxStats = useMemo(() => {
    if (!analysisBoxes) return null

    const totalBoxes = analysisBoxes.length
    const captionBoxes = analysisBoxes.filter(
      box => box.userLabel === 'in' || (box.userLabel === null && box.predictedLabel === 'in')
    ).length
    const noiseBoxes = analysisBoxes.filter(
      box => box.userLabel === 'out' || (box.userLabel === null && box.predictedLabel === 'out')
    ).length

    return { totalBoxes, captionBoxes, noiseBoxes }
  }, [analysisBoxes])
  const [analysisThumbnailUrl, setAnalysisThumbnailUrl] = useState<string | null>(null)

  // Cache for frame boxes (to avoid re-fetching already loaded frames)
  const frameBoxesCache = useRef<Map<number, FrameBoxesData>>(new Map())

  // Initialize selectedFrameIndex to first frame when frames load
  useEffect(() => {
    if (frames.length > 0 && selectedFrameIndex === null) {
      const firstFrame = frames[0]
      if (firstFrame) {
        setSelectedFrameIndex(firstFrame.frameIndex)
      }
    }
  }, [frames, selectedFrameIndex])

  // Reset pulse timer when frame changes
  useEffect(() => {
    if (selectedFrameIndex !== null) {
      setPulseStartTime(Date.now())
    }
  }, [selectedFrameIndex])

  // Canvas state
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const interactionAreaRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [hoveredBoxIndex, setHoveredBoxIndex] = useState<number | null>(null)

  // Padding around frame for easier boundary selection (in pixels when frame is at natural size)
  const SELECTION_PADDING = 20

  // Selection rectangle state (click-to-start, click-to-end)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null)
  const [selectionCurrent, setSelectionCurrent] = useState<{ x: number; y: number } | null>(null)
  const [selectionLabel, setSelectionLabel] = useState<'in' | 'out' | 'clear' | null>(null) // Based on which button started selection

  // Box highlighting mode - makes boxes blink with bigger borders to help find them
  const [boxHighlightMode] = useState(true) // Active by default for now
  const [pulseStartTime, setPulseStartTime] = useState(Date.now()) // Track when to start ramping up pulse

  // Confirmation modal state
  const [showApproveModal, setShowApproveModal] = useState(false)

  // Layout controls state (local modifications before save)
  const [cropBoundsEdit, setCropBoundsEdit] = useState<{
    left: number
    top: number
    right: number
    bottom: number
  } | null>(null)
  const [, setSelectionRectEdit] = useState<{
    left: number
    top: number
    right: number
    bottom: number
  } | null>(null)
  const [, setLayoutParamsEdit] = useState<{
    verticalPosition: number | null
    verticalStd: number | null
    boxHeight: number | null
    boxHeightStd: number | null
    anchorType: 'left' | 'center' | 'right' | null
    anchorPosition: number | null
  } | null>(null)

  // Mark video as being worked on
  useVideoTouched(videoId)

  // Edit state updaters for loadQueue
  const editUpdaters: EditStateUpdaters = useMemo(
    () => ({
      setCropBoundsEdit,
      setSelectionRectEdit,
      setLayoutParamsEdit,
    }),
    []
  )

  // Load layout queue (top frames + config)
  const loadQueue = useCallback(
    async (showLoading = true, skipEditStateUpdate = false) => {
      if (!videoId) return

      console.log(
        `[Frontend] loadQueue called (showLoading=${showLoading}, skipEditStateUpdate=${skipEditStateUpdate})`
      )

      if (showLoading) {
        setError(null)
      }

      try {
        const response = await fetch(`/api/annotations/${encodeURIComponent(videoId)}/layout-queue`)

        if (!response.ok) {
          const errorData = await response.json()
          if (response.status === 425 && errorData.processingStatus) {
            throw new Error(`Processing: ${errorData.processingStatus}`)
          }
          throw new Error(errorData.error ?? 'Failed to load layout queue')
        }

        const data: LayoutQueueResponse = await response.json()

        console.log(
          `[Frontend] Received ${data.frames?.length ?? 0} frames:`,
          data.frames?.map((f: FrameInfo) => f.frameIndex)
        )

        handleLoadQueueResponse(
          data,
          skipEditStateUpdate,
          setFrames,
          setLayoutConfig,
          setLayoutApproved,
          editUpdaters
        )

        if (showLoading) {
          setLoading(false)
        }
      } catch (err) {
        console.error('Failed to load layout queue:', err)
        if (showLoading) {
          setError((err as Error).message)
          setLoading(false)
        }
      }
    },
    [videoId, editUpdaters]
  )

  // Prefetch frame boxes for all frames in queue (after queue loads)
  useEffect(() => {
    if (!videoId || frames.length === 0) return

    const prefetchFrames = async () => {
      console.log(`[Prefetch] Starting prefetch for ${frames.length} frames`)

      // Prefetch all frames in parallel
      const prefetchPromises = frames.map(async frame => {
        // Skip if already cached
        if (frameBoxesCache.current.has(frame.frameIndex)) {
          return
        }

        try {
          console.log(`[Prefetch] Fetching frame ${frame.frameIndex}`)
          const response = await fetch(
            `/api/annotations/${encodeURIComponent(videoId)}/frames/${frame.frameIndex}/boxes`
          )
          if (!response.ok) return

          const data = await response.json()
          frameBoxesCache.current.set(frame.frameIndex, data)
          console.log(`[Prefetch] Cached frame ${frame.frameIndex}`)
        } catch (err) {
          console.warn(`[Prefetch] Failed to prefetch frame ${frame.frameIndex}:`, err)
        }
      })

      await Promise.all(prefetchPromises)
      console.log(`[Prefetch] Completed`)
    }

    // Prefetch in background (don't await)
    void prefetchFrames()
  }, [videoId, frames])

  // Load all OCR boxes for analysis view
  const loadAnalysisBoxes = useCallback(async () => {
    if (!videoId) return

    try {
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(videoId)}/layout-analysis-boxes`
      )
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Failed to load analysis boxes:', response.status, errorText)
        throw new Error('Failed to load analysis boxes')
      }
      const data = await response.json()
      setAnalysisBoxes(data.boxes ?? [])
    } catch (error) {
      console.error('Error loading analysis boxes:', error)
    }
  }, [videoId])

  // Recalculate crop bounds based on current annotations
  const recalculateCropBounds = useCallback(async () => {
    if (!videoId) return

    console.log('[Layout] Recalculating crop bounds based on annotations...')

    try {
      // First, recalculate predictions to ensure they're up to date
      console.log('[Layout] Updating predictions before crop bounds recalculation...')
      const predResponse = await fetch(
        `/api/annotations/${encodeURIComponent(videoId)}/calculate-predictions`,
        { method: 'POST' }
      )

      if (predResponse.ok) {
        const predResult = await predResponse.json()
        console.log('[Layout] Predictions updated:', predResult)
      } else {
        console.warn('[Layout] Failed to update predictions, continuing anyway')
      }

      // Now recalculate crop bounds using updated predictions
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(videoId)}/reset-crop-bounds`,
        { method: 'POST' }
      )

      const result = await response.json()

      if (!response.ok) {
        // Show user-friendly error message
        const errorMessage = result.message ?? result.error ?? 'Failed to recalculate crop bounds'
        alert(errorMessage)
        setError(errorMessage)

        // Reset counter so overlay goes away
        setAnnotationsSinceRecalc(0)
        return
      }

      console.log('[Layout] Crop bounds recalculated:', result)

      // Reload layout config to get updated crop bounds
      // Skip edit state update so user can see the auto-calculated changes
      await loadQueue(false, true)

      // Reload analysis boxes to show updated predictions
      await loadAnalysisBoxes()

      // Reset the annotation counter
      setAnnotationsSinceRecalc(0)
    } catch (error) {
      console.error('Error recalculating crop bounds:', error)
    }
  }, [videoId, loadQueue, loadAnalysisBoxes])

  // Priority loading on mount: Analysis boxes and queue in parallel
  useEffect(() => {
    if (!videoId) return

    console.log('[Priority] Starting parallel load: analysis boxes + queue...')

    // Load both in parallel (don't await - let them race)
    void loadAnalysisBoxes()
    void loadQueue(true)
  }, [videoId, loadAnalysisBoxes, loadQueue])

  // Generate analysis thumbnail by rendering to offscreen canvas (updates even when not in analysis view)
  useEffect(() => {
    if (!analysisBoxes || !layoutConfig) {
      setAnalysisThumbnailUrl(null)
      return
    }

    try {
      // Create offscreen canvas for thumbnail
      const thumbnailCanvas = document.createElement('canvas')
      const thumbnailWidth = 320
      const thumbnailHeight = Math.round(
        (layoutConfig.frameHeight / layoutConfig.frameWidth) * thumbnailWidth
      )

      thumbnailCanvas.width = thumbnailWidth
      thumbnailCanvas.height = thumbnailHeight
      const ctx = thumbnailCanvas.getContext('2d')

      if (!ctx) return

      // Draw black background
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, thumbnailWidth, thumbnailHeight)

      // Calculate scale for thumbnail
      const scale = thumbnailWidth / layoutConfig.frameWidth

      // Draw all analysis boxes (same logic as main canvas)
      analysisBoxes.forEach(box => {
        const boxX = box.originalBounds.left * scale
        const boxY = box.originalBounds.top * scale
        const boxWidth = (box.originalBounds.right - box.originalBounds.left) * scale
        const boxHeight = (box.originalBounds.bottom - box.originalBounds.top) * scale

        let fillColor: string

        if (box.userLabel === 'in') {
          fillColor = 'rgba(20,184,166,0.05)'
        } else if (box.userLabel === 'out') {
          fillColor = 'rgba(220,38,38,0.05)'
        } else if (box.predictedLabel === 'in') {
          if (box.predictedConfidence >= 0.75) {
            fillColor = 'rgba(59,130,246,0.03)'
          } else if (box.predictedConfidence >= 0.5) {
            fillColor = 'rgba(96,165,250,0.02)'
          } else {
            fillColor = 'rgba(147,197,253,0.015)'
          }
        } else {
          if (box.predictedConfidence >= 0.75) {
            fillColor = 'rgba(249,115,22,0.03)'
          } else if (box.predictedConfidence >= 0.5) {
            fillColor = 'rgba(251,146,60,0.02)'
          } else {
            fillColor = 'rgba(253,186,116,0.015)'
          }
        }

        ctx.fillStyle = fillColor
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight)
      })

      // Draw crop bounds overlay (red, dashed) - scaled for thumbnail
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 1
      ctx.setLineDash([8, 3])
      const cropX = layoutConfig.cropLeft * scale
      const cropY = layoutConfig.cropTop * scale
      const cropW = (layoutConfig.cropRight - layoutConfig.cropLeft) * scale
      const cropH = (layoutConfig.cropBottom - layoutConfig.cropTop) * scale
      ctx.strokeRect(cropX, cropY, cropW, cropH)
      ctx.setLineDash([])

      // Convert to data URL
      const dataUrl = thumbnailCanvas.toDataURL('image/png')
      setAnalysisThumbnailUrl(dataUrl)
    } catch (error) {
      console.error('Error generating analysis thumbnail:', error)
    }
  }, [analysisBoxes, layoutConfig])

  // Auto-poll when processing is in progress
  useEffect(() => {
    if (!error?.startsWith('Processing:')) return

    console.log('[Polling] Setting up auto-poll for processing status...')

    const pollInterval = setInterval(() => {
      console.log('[Polling] Checking processing status...')
      setError(null)
      void loadQueue(true)
    }, 3000) // Poll every 3 seconds

    return () => {
      console.log('[Polling] Cleaning up poll interval')
      clearInterval(pollInterval)
    }
  }, [error, loadQueue])

  // Load frame boxes when frame selected
  useEffect(() => {
    if (!videoId || viewMode !== 'frame' || selectedFrameIndex === null) return

    // Check cache first
    const cached = frameBoxesCache.current.get(selectedFrameIndex)
    if (cached) {
      console.log(`[Cache] Using cached boxes for frame ${selectedFrameIndex}`)
      setCurrentFrameBoxes(cached)
      setLoadingFrame(false)
      return
    }

    const loadFrameBoxes = async () => {
      setLoadingFrame(true)
      try {
        console.log(`[Fetch] Loading boxes for frame ${selectedFrameIndex}`)
        const response = await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/frames/${selectedFrameIndex}/boxes`
        )
        if (!response.ok) throw new Error('Failed to load frame boxes')
        const data = await response.json()

        // Cache the result
        frameBoxesCache.current.set(selectedFrameIndex, data)

        setCurrentFrameBoxes(data)
        setLoadingFrame(false)
      } catch (err) {
        console.error('Failed to load frame boxes:', err)
        setCurrentFrameBoxes(null)
        setLoadingFrame(false)
      }
    }

    void loadFrameBoxes()
  }, [videoId, viewMode, selectedFrameIndex])

  // Handle thumbnail click
  const handleThumbnailClick = useCallback(
    (frameIndex: number | 'analysis') => {
      console.log(`[Frontend] Thumbnail clicked: ${frameIndex}`)

      // Check if we're actually changing frames/views
      const isChangingView =
        (frameIndex === 'analysis' && viewMode !== 'analysis') ||
        (frameIndex !== 'analysis' && (viewMode !== 'frame' || selectedFrameIndex !== frameIndex))

      if (frameIndex === 'analysis') {
        setViewMode('analysis')
        // Keep the current frame selected for annotation, or default to first frame
        setSelectedFrameIndex(
          prev => prev ?? (frames.length > 0 ? (frames[0]?.frameIndex ?? null) : null)
        )
      } else {
        setViewMode('frame')
        setSelectedFrameIndex(frameIndex)
      }

      // Reload queue only when navigating away AND annotations were made (background refresh to update priorities)
      if (isChangingView && hasUnsyncedAnnotations) {
        console.log(
          `[Frontend] Navigating to different frame/view with unsynced annotations, reloading queue in background`
        )
        void loadQueue(false)
        setHasUnsyncedAnnotations(false)
      }
    },
    [frames, viewMode, selectedFrameIndex, hasUnsyncedAnnotations, loadQueue]
  )

  // Handle box annotation (left click = in, right click = out)
  const handleBoxClick = useCallback(
    async (boxIndex: number, label: 'in' | 'out') => {
      if (!videoId || !currentFrameBoxes) return

      try {
        // Check if this is a new annotation (not just changing existing one)
        const box = currentFrameBoxes.boxes.find(b => b.boxIndex === boxIndex)
        if (!box) return
        const isNewAnnotation = box.userLabel === null

        // Update local state optimistically
        setCurrentFrameBoxes(prev => {
          if (!prev) return prev
          return {
            ...prev,
            boxes: prev.boxes.map(box =>
              box.boxIndex === boxIndex
                ? {
                    ...box,
                    userLabel: label,
                    colorCode: label === 'in' ? 'annotated_in' : 'annotated_out',
                  }
                : box
            ),
          }
        })

        // Save to server
        const response = await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/frames/${currentFrameBoxes.frameIndex}/boxes`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              annotations: [{ boxIndex, label }],
            }),
          }
        )

        if (!response.ok) {
          throw new Error('Failed to save annotation')
        }

        // Invalidate cache for this frame
        frameBoxesCache.current.delete(currentFrameBoxes.frameIndex)

        // Mark that we have unsynced annotations
        setHasUnsyncedAnnotations(true)

        // Only increment counter for new annotations, not changes to existing ones
        if (isNewAnnotation) {
          const newCount = annotationsSinceRecalc + 1
          setAnnotationsSinceRecalc(newCount)

          if (newCount >= RECALC_THRESHOLD) {
            console.log(
              `[Layout] Reached ${newCount} annotations, triggering crop bounds recalculation`
            )
            void recalculateCropBounds()
          }
        }
      } catch (err) {
        console.error('Failed to save box annotation:', err)
        // Reload frame to revert optimistic update
        setSelectedFrameIndex(prev => prev)
      }
    },
    [videoId, currentFrameBoxes, annotationsSinceRecalc, RECALC_THRESHOLD, recalculateCropBounds]
  )

  // Sync canvas size with displayed image
  useEffect(() => {
    const updateCanvasSize = () => {
      if (imageRef.current && canvasRef.current) {
        const img = imageRef.current
        setCanvasSize({
          width: img.clientWidth,
          height: img.clientHeight,
        })
      }
    }

    if (imageRef.current) {
      // Wait for image to load (for both frame and analysis modes)
      const img = imageRef.current
      if (img.complete) {
        updateCanvasSize()
      } else {
        img.addEventListener('load', updateCanvasSize)
        return () => img.removeEventListener('load', updateCanvasSize)
      }
    }

    window.addEventListener('resize', updateCanvasSize)
    return () => window.removeEventListener('resize', updateCanvasSize)
  }, [viewMode, currentFrameBoxes, layoutConfig])

  // Continuous animation loop for smooth drag visualization
  const drawCanvas = useCallback(() => {
    if (!canvasRef.current || !imageRef.current || canvasSize.width === 0) {
      return
    }

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas dimensions to match displayed image
    canvas.width = canvasSize.width
    canvas.height = canvasSize.height

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw boxes based on view mode
    if (viewMode === 'frame' && currentFrameBoxes) {
      const scale = canvasSize.width / currentFrameBoxes.frameWidth

      // Calculate pulse animation values
      const pulsePhase = (Date.now() % 1000) / 1000
      const pulseValue = Math.sin(pulsePhase * Math.PI * 2) * 0.5 + 0.5
      const elapsedSeconds = (Date.now() - pulseStartTime) / 1000
      const pulseIntensity = Math.min(elapsedSeconds / 10, 1)

      // Draw each box using helper function
      currentFrameBoxes.boxes.forEach((box, index) => {
        drawFrameBox(ctx, {
          box,
          boxIndex: index,
          scale,
          hoveredBoxIndex,
          boxHighlightMode,
          pulseValue,
          pulseIntensity,
        })
      })
    } else if (viewMode === 'analysis' && analysisBoxes && layoutConfig) {
      const scale = canvasSize.width / layoutConfig.frameWidth

      // Draw analysis boxes with transparency
      analysisBoxes.forEach(box => {
        const boxX = box.originalBounds.left * scale
        const boxY = box.originalBounds.top * scale
        const boxWidth = (box.originalBounds.right - box.originalBounds.left) * scale
        const boxHeight = (box.originalBounds.bottom - box.originalBounds.top) * scale

        ctx.fillStyle = getAnalysisBoxFillColor(box)
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight)
      })

      // Draw layout overlays
      drawLayoutOverlays(ctx, layoutConfig, scale, canvasSize.width, canvasSize.height)
    }

    // Draw selection rectangle if active
    if (isSelecting && selectionStart && selectionCurrent && selectionLabel) {
      drawSelectionRectangle(ctx, {
        selectionStart,
        selectionCurrent,
        selectionLabel,
        viewMode,
      })
    }
  }, [
    canvasSize,
    viewMode,
    currentFrameBoxes,
    analysisBoxes,
    layoutConfig,
    hoveredBoxIndex,
    isSelecting,
    selectionStart,
    selectionCurrent,
    selectionLabel,
    boxHighlightMode,
    pulseStartTime,
  ])

  // Call drawCanvas in an effect when dependencies change
  useEffect(() => {
    drawCanvas()
  }, [drawCanvas])

  // Continuous animation loop when box highlight mode is active
  useEffect(() => {
    if (!boxHighlightMode || viewMode !== 'frame') return

    let animationFrameId: number

    const animate = () => {
      drawCanvas()
      animationFrameId = requestAnimationFrame(animate)
    }

    animationFrameId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [boxHighlightMode, viewMode, drawCanvas])

  // Handle analysis mode bulk annotation
  const handleAnalysisModeSelection = useCallback(
    async (selRectCanvas: SelectionRectangle, label: 'in' | 'out' | 'clear') => {
      if (!layoutConfig) return

      const scaleX = layoutConfig.frameWidth / canvasSize.width
      const scaleY = layoutConfig.frameHeight / canvasSize.height
      const rectangleFrameCoords = convertToFrameCoordinates(selRectCanvas, scaleX, scaleY)
      const action = label === 'clear' ? 'clear' : 'mark_out'

      try {
        const response = await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/bulk-annotate-all`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rectangle: rectangleFrameCoords, action }),
          }
        )

        const result = await response.json()

        if (!response.ok || result.error) {
          console.error('Bulk annotate all failed:', result.error ?? `HTTP ${response.status}`)
          throw new Error(result.error ?? 'Failed to bulk annotate')
        }

        await loadAnalysisBoxes()
        frameBoxesCache.current.clear()
        setHasUnsyncedAnnotations(true)

        if (result.newlyAnnotatedBoxes && result.newlyAnnotatedBoxes > 0) {
          const newCount = annotationsSinceRecalc + result.newlyAnnotatedBoxes
          setAnnotationsSinceRecalc(newCount)

          if (newCount >= RECALC_THRESHOLD) {
            console.log(
              `[Layout] Reached ${newCount} annotations, triggering crop bounds recalculation`
            )
            await recalculateCropBounds()
          }
        }
      } catch (err) {
        console.error('Failed to bulk annotate all frames:', err)
      }
    },
    [
      layoutConfig,
      canvasSize,
      videoId,
      loadAnalysisBoxes,
      annotationsSinceRecalc,
      RECALC_THRESHOLD,
      recalculateCropBounds,
    ]
  )

  // Handle frame mode selection annotation
  const handleFrameModeSelection = useCallback(
    async (selRectCanvas: SelectionRectangle, label: 'in' | 'out') => {
      if (!currentFrameBoxes) return

      const scale = canvasSize.width / currentFrameBoxes.frameWidth
      const { enclosedBoxes, newlyAnnotatedCount } = findEnclosedBoxes(
        currentFrameBoxes.boxes,
        selRectCanvas,
        scale
      )

      if (enclosedBoxes.length === 0) return

      const annotations = enclosedBoxes.map(boxIndex => ({ boxIndex, label }))

      try {
        await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/frames/${currentFrameBoxes.frameIndex}/boxes`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ annotations }),
          }
        )

        // Invalidate cache and reload frame boxes
        if (selectedFrameIndex !== null) {
          frameBoxesCache.current.delete(selectedFrameIndex)
        }
        const response = await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/frames/${selectedFrameIndex}/boxes`
        )
        const data = await response.json()
        setCurrentFrameBoxes(data)

        if (selectedFrameIndex !== null) {
          frameBoxesCache.current.set(selectedFrameIndex, data)
        }

        setHasUnsyncedAnnotations(true)

        // Check if recalculation is needed
        const shouldRecalculate =
          newlyAnnotatedCount > 0 &&
          annotationsSinceRecalc + newlyAnnotatedCount >= RECALC_THRESHOLD

        if (newlyAnnotatedCount > 0) {
          setAnnotationsSinceRecalc(annotationsSinceRecalc + newlyAnnotatedCount)
        }

        if (shouldRecalculate) {
          console.log(
            `[Layout] Reached threshold annotations, triggering crop bounds recalculation`
          )
          await recalculateCropBounds()
        }
      } catch (err) {
        console.error('Failed to save annotations:', err)
      }
    },
    [
      currentFrameBoxes,
      canvasSize,
      videoId,
      selectedFrameIndex,
      annotationsSinceRecalc,
      RECALC_THRESHOLD,
      recalculateCropBounds,
    ]
  )

  // Complete selection and annotate boxes
  const completeSelection = useCallback(async () => {
    if (!isSelecting || !selectionStart || !selectionCurrent || !selectionLabel) return

    const selRectCanvas = calculateCanvasSelectionRect(selectionStart, selectionCurrent)

    // Reset selection state immediately
    setIsSelecting(false)
    setSelectionStart(null)
    setSelectionCurrent(null)
    setSelectionLabel(null)

    if (viewMode === 'analysis') {
      await handleAnalysisModeSelection(selRectCanvas, selectionLabel)
    } else if (viewMode === 'frame' && (selectionLabel === 'in' || selectionLabel === 'out')) {
      await handleFrameModeSelection(selRectCanvas, selectionLabel)
    }
  }, [
    isSelecting,
    selectionStart,
    selectionCurrent,
    selectionLabel,
    viewMode,
    handleAnalysisModeSelection,
    handleFrameModeSelection,
  ])

  // Helper function to convert interaction area coordinates to canvas coordinates
  const getCanvasCoordinates = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageRef.current || !interactionAreaRef.current) return null

    const image = imageRef.current
    const interactionArea = interactionAreaRef.current

    // Get mouse position relative to interaction area
    const areaRect = interactionArea.getBoundingClientRect()
    const areaX = e.clientX - areaRect.left
    const areaY = e.clientY - areaRect.top

    // Get image position within interaction area (frame is centered with padding)
    const imageRect = image.getBoundingClientRect()
    const imageOffsetX = imageRect.left - areaRect.left
    const imageOffsetY = imageRect.top - areaRect.top

    // Calculate position relative to canvas (which overlays the image)
    const x = areaX - imageOffsetX
    const y = areaY - imageOffsetY

    return { x, y }
  }, [])

  // Start a new selection rectangle
  const startSelection = useCallback((x: number, y: number, label: 'in' | 'out' | 'clear') => {
    setIsSelecting(true)
    setSelectionStart({ x, y })
    setSelectionCurrent({ x, y })
    setSelectionLabel(label)
  }, [])

  // Handle canvas click - individual box annotation, or start/complete selection
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!canvasRef.current || canvasSize.width === 0) return
      if (annotationsSinceRecalc >= RECALC_THRESHOLD) return
      if (e.button !== 0 && e.button !== 2) return

      if (e.button === 2) {
        e.preventDefault()
        e.stopPropagation()
      }

      const coords = getCanvasCoordinates(e)
      if (!coords) return
      const { x, y } = coords

      // Complete existing selection on second click
      if (isSelecting) {
        void completeSelection()
        return
      }

      // Analysis mode: area selection only
      if (viewMode === 'analysis') {
        const label = e.button === 0 ? 'clear' : 'out'
        startSelection(x, y, label)
        return
      }

      // Frame mode: box click or area selection
      if (!currentFrameBoxes) return

      const scale = canvasSize.width / currentFrameBoxes.frameWidth
      const clickedBoxIndex = findClickedBox(currentFrameBoxes.boxes, x, y, scale)
      const label = e.button === 0 ? 'in' : 'out'

      if (clickedBoxIndex !== null) {
        void handleBoxClick(clickedBoxIndex, label)
      } else {
        startSelection(x, y, label)
      }
    },
    [
      currentFrameBoxes,
      canvasSize,
      isSelecting,
      completeSelection,
      handleBoxClick,
      viewMode,
      getCanvasCoordinates,
      annotationsSinceRecalc,
      RECALC_THRESHOLD,
      startSelection,
    ]
  )

  // Handle mouse move - update selection rectangle or detect hover
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!canvasRef.current || canvasSize.width === 0) return
      if (annotationsSinceRecalc >= RECALC_THRESHOLD) return

      const coords = getCanvasCoordinates(e)
      if (!coords) return
      const { x, y } = coords

      if (isSelecting) {
        setSelectionCurrent({ x, y })
        return
      }

      // Box hover detection only in frame mode
      if (viewMode === 'frame' && currentFrameBoxes) {
        const scale = canvasSize.width / currentFrameBoxes.frameWidth
        const foundIndex = findHoveredBoxIndex(currentFrameBoxes.boxes, x, y, scale)
        setHoveredBoxIndex(foundIndex)
      }
    },
    [
      currentFrameBoxes,
      canvasSize,
      isSelecting,
      viewMode,
      getCanvasCoordinates,
      annotationsSinceRecalc,
      RECALC_THRESHOLD,
    ]
  )

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // Cancel selection helper
  const cancelSelection = useCallback(() => {
    setIsSelecting(false)
    setSelectionStart(null)
    setSelectionCurrent(null)
    setSelectionLabel(null)
  }, [])

  // Keyboard shortcut context for handler functions
  const keyboardContext: KeyboardShortcutContext = useMemo(
    () => ({
      viewMode,
      selectedFrameIndex,
      frames,
      hoveredBoxIndex,
      currentFrameBoxes,
      isSelecting,
      handleThumbnailClick,
      handleBoxClick,
      cancelSelection,
    }),
    [
      viewMode,
      selectedFrameIndex,
      frames,
      hoveredBoxIndex,
      currentFrameBoxes,
      isSelecting,
      handleThumbnailClick,
      handleBoxClick,
      cancelSelection,
    ]
  )

  // Keyboard shortcuts
  useKeyboardShortcuts(
    e => {
      if (dispatchKeyboardShortcut(e.key, keyboardContext)) {
        e.preventDefault()
      }
    },
    [keyboardContext]
  )

  // Show error prominently, but don't block UI for loading
  if (error) {
    const isProcessing = error.startsWith('Processing:')

    return (
      <AppLayout>
        <div className="flex h-screen items-center justify-center">
          <div className="max-w-md rounded-lg border border-gray-300 bg-white p-8 dark:border-gray-700 dark:bg-gray-800">
            {isProcessing ? (
              <>
                <div className="mb-4 flex items-center justify-center">
                  <svg
                    className="h-12 w-12 animate-spin text-blue-500"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                </div>
                <h2 className="mb-2 text-center text-xl font-bold text-gray-900 dark:text-white">
                  Video Processing
                </h2>
                <p className="mb-4 text-center text-gray-600 dark:text-gray-400">
                  {error.replace('Processing: ', '')}
                </p>
                <p className="mb-6 text-center text-sm text-gray-500 dark:text-gray-500">
                  The video is being processed. This page will automatically refresh when ready.
                </p>
                <button
                  onClick={() => {
                    setError(null)
                    setLoading(true)
                    void loadQueue(true)
                  }}
                  className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Check Again
                </button>
              </>
            ) : (
              <>
                <div className="mb-4 text-center text-red-500">
                  <svg
                    className="mx-auto h-12 w-12"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <h2 className="mb-2 text-center text-xl font-bold text-gray-900 dark:text-white">
                  Error Loading Layout
                </h2>
                <p className="mb-6 text-center text-gray-600 dark:text-gray-400">{error}</p>
                <button
                  onClick={() => {
                    setError(null)
                    setLoading(true)
                    void loadQueue(true)
                  }}
                  className="w-full rounded-md bg-gray-600 px-4 py-2 text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                >
                  Try Again
                </button>
              </>
            )}
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout fullScreen={true}>
      <div
        className="flex flex-col gap-4 p-4 overflow-hidden"
        style={{ height: 'calc(100vh - 4rem)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Caption Layout Annotation
            </h1>
            <div className="text-sm text-gray-600 dark:text-gray-400">Video: {videoId}</div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-1 min-h-0 gap-4 overflow-hidden">
          {/* Left: Canvas (2/3 width) */}
          <div className="flex min-h-0 w-2/3 flex-col gap-4">
            {/* Main canvas */}
            <div className="relative flex flex-shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-gray-900 dark:border-gray-600 dark:bg-gray-800">
              {viewMode === 'analysis' && layoutConfig ? (
                <div
                  ref={interactionAreaRef}
                  className="relative inline-block cursor-crosshair"
                  style={{ padding: `${SELECTION_PADDING}px` }}
                  onMouseDown={handleCanvasClick}
                  onMouseMove={handleCanvasMouseMove}
                  onContextMenu={handleCanvasContextMenu}
                >
                  <div className="relative">
                    <img
                      ref={imageRef}
                      src={`data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="${layoutConfig.frameWidth}" height="${layoutConfig.frameHeight}"><rect width="100%" height="100%" fill="black"/></svg>`}
                      alt="Analysis view"
                      className="max-w-full max-h-full object-contain block"
                    />
                    <canvas
                      ref={canvasRef}
                      className="absolute left-0 top-0"
                      style={{ touchAction: 'none', pointerEvents: 'none' }}
                    />
                  </div>
                  {analysisBoxes === null && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
                      <div className="text-white text-lg">Loading analysis boxes...</div>
                    </div>
                  )}
                  {annotationsSinceRecalc >= RECALC_THRESHOLD && (
                    <div className="absolute inset-0 flex items-center justify-center bg-blue-900 bg-opacity-70 pointer-events-none">
                      <div className="bg-blue-800 px-6 py-4 rounded-lg shadow-lg">
                        <div className="text-white text-lg font-semibold mb-2">
                          Recalculating Crop Bounds
                        </div>
                        <div className="text-blue-200 text-sm">
                          Annotations temporarily disabled...
                        </div>
                        <div className="mt-3 h-1 w-64 rounded-full bg-blue-700">
                          <div
                            className="h-1 rounded-full bg-blue-300 animate-pulse"
                            style={{ width: '100%' }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : viewMode === 'frame' && currentFrameBoxes ? (
                <div
                  ref={interactionAreaRef}
                  className="relative inline-block cursor-crosshair"
                  style={{ padding: `${SELECTION_PADDING}px` }}
                  onMouseDown={handleCanvasClick}
                  onMouseMove={handleCanvasMouseMove}
                  onContextMenu={handleCanvasContextMenu}
                >
                  <div
                    className="relative"
                    style={{
                      outline: currentFrameBoxes.boxes.every(box => box.userLabel !== null)
                        ? '3px solid #10b981'
                        : 'none',
                    }}
                  >
                    <img
                      ref={imageRef}
                      src={currentFrameBoxes.imageUrl}
                      alt={`Frame ${currentFrameBoxes.frameIndex}`}
                      className="max-w-full max-h-full object-contain block"
                    />
                    <canvas
                      ref={canvasRef}
                      className="absolute left-0 top-0"
                      style={{ touchAction: 'none', pointerEvents: 'none' }}
                    />
                  </div>
                  {annotationsSinceRecalc >= RECALC_THRESHOLD && (
                    <div className="absolute inset-0 flex items-center justify-center bg-blue-900 bg-opacity-70 pointer-events-none">
                      <div className="bg-blue-800 px-6 py-4 rounded-lg shadow-lg">
                        <div className="text-white text-lg font-semibold mb-2">
                          Recalculating Crop Bounds
                        </div>
                        <div className="text-blue-200 text-sm">
                          Annotations temporarily disabled...
                        </div>
                        <div className="mt-3 h-1 w-64 rounded-full bg-blue-700">
                          <div
                            className="h-1 rounded-full bg-blue-300 animate-pulse"
                            style={{ width: '100%' }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex min-h-[400px] items-center justify-center text-gray-500 dark:text-gray-400">
                  {loadingFrame ? 'Loading frame...' : 'Select a frame to annotate'}
                </div>
              )}
            </div>

            {/* Thumbnail panel */}
            <LayoutThumbnailGrid
              frames={frames}
              viewMode={viewMode}
              selectedFrameIndex={selectedFrameIndex}
              analysisThumbnailUrl={analysisThumbnailUrl}
              loading={loading}
              onThumbnailClick={handleThumbnailClick}
            />
          </div>

          {/* Right: Controls (1/3 width) */}
          <div className="flex min-h-0 w-1/3 flex-col gap-4 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            {/* Mode toggle */}
            <div className="flex gap-2 rounded-md border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
              <button className="flex-1 rounded py-2 text-sm font-semibold bg-teal-600 text-white">
                Layout
              </button>
              <button
                onClick={() => {
                  void navigate(`/annotate/review-labels?videoId=${encodeURIComponent(videoId)}`)
                }}
                className="flex-1 rounded py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Review Labels
              </button>
            </div>

            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Layout Controls</h2>

            {/* Instructions */}
            <LayoutInstructionsPanel />

            {/* Annotation Progress Indicator */}
            <LayoutAnnotationProgress
              boxStats={boxStats}
              annotationsSinceRecalc={annotationsSinceRecalc}
              recalcThreshold={RECALC_THRESHOLD}
            />

            {/* Layout Action Buttons */}
            <LayoutActionButtons
              layoutApproved={layoutApproved}
              layoutConfig={layoutConfig}
              cropBoundsEdit={cropBoundsEdit}
              onApprove={() => setShowApproveModal(true)}
              onClearAll={() => {
                const confirmMessage =
                  'Clear all layout annotations? This will:\n\n' +
                  '• Delete all user annotations\n' +
                  '• Reset predictions to seed model\n' +
                  '• Recalculate crop bounds\n\n' +
                  'This action cannot be undone.'

                if (confirm(confirmMessage)) {
                  void (async () => {
                    try {
                      const response = await fetch(
                        `/api/annotations/${encodeURIComponent(videoId)}/clear-all`,
                        { method: 'POST' }
                      )
                      if (!response.ok) throw new Error('Failed to clear annotations')
                      const result = await response.json()
                      console.log(`[Clear All] Deleted ${result.deletedCount} annotations`)

                      await fetch(
                        `/api/annotations/${encodeURIComponent(videoId)}/calculate-predictions`,
                        { method: 'POST' }
                      )

                      const cropBoundsResponse = await fetch(
                        `/api/annotations/${encodeURIComponent(videoId)}/reset-crop-bounds`,
                        { method: 'POST' }
                      )
                      if (!cropBoundsResponse.ok) {
                        const cropBoundsResult = await cropBoundsResponse.json()
                        console.warn(
                          '[Clear All] Could not recalculate crop bounds:',
                          cropBoundsResult.message
                        )
                      }

                      await loadQueue(false, true)
                      await loadAnalysisBoxes()
                      frameBoxesCache.current.clear()

                      if (viewMode === 'frame' && selectedFrameIndex !== null) {
                        const frameResponse = await fetch(
                          `/api/annotations/${encodeURIComponent(videoId)}/frames/${selectedFrameIndex}/boxes`
                        )
                        if (frameResponse.ok) {
                          const data = await frameResponse.json()
                          setCurrentFrameBoxes(data)
                          frameBoxesCache.current.set(selectedFrameIndex, data)
                        }
                      }

                      setAnnotationsSinceRecalc(0)
                      alert(
                        `Successfully cleared ${result.deletedCount} annotations and reset to seed model.`
                      )
                    } catch (err) {
                      console.error('Error clearing annotations:', err)
                      alert('Failed to clear annotations')
                    }
                  })()
                }
              }}
            />

            {/* Current view info */}
            {viewMode === 'frame' && (
              <LayoutCurrentFrameInfo currentFrameBoxes={currentFrameBoxes} />
            )}

            {/* Color legend */}
            <LayoutColorLegend />

            {/* Layout parameters (read-only for now) */}
            <LayoutParametersDisplay layoutConfig={layoutConfig} />
          </div>
        </div>
      </div>

      {/* Layout Approval Confirmation Modal */}
      {showApproveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4 backdrop-blur-sm"
          onClick={() => setShowApproveModal(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white px-6 py-5 shadow-xl dark:bg-gray-800"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Approve Layout</h2>
              <button
                onClick={() => setShowApproveModal(false)}
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                ✕
              </button>
            </div>

            <div className="mb-6 space-y-3 text-sm text-gray-700 dark:text-gray-300">
              <p>This will perform the following actions:</p>
              <ul className="list-inside list-disc space-y-2 pl-2">
                <li>Mark layout annotation as complete</li>
                <li>Enable boundary annotation for this video</li>
                <li>Start frame re-cropping in the background</li>
              </ul>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Frame re-cropping will run in the background and may take several minutes to
                complete.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowApproveModal(false)}
                className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowApproveModal(false)
                  void (async () => {
                    try {
                      const response = await fetch(
                        `/api/annotations/${encodeURIComponent(videoId)}/layout-complete`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ complete: true }),
                        }
                      )
                      if (!response.ok) throw new Error('Failed to mark layout complete')

                      // Update local state
                      setLayoutApproved(true)

                      // Trigger frame re-cropping in background
                      fetch(`/api/annotations/${encodeURIComponent(videoId)}/recrop-frames`, {
                        method: 'POST',
                      }).catch(err => console.error('Frame re-cropping failed:', err))
                    } catch (err) {
                      console.error('Error marking layout complete:', err)
                      alert('Failed to mark layout complete')
                    }
                  })()
                }}
                className="flex-1 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:bg-green-600 dark:hover:bg-green-700"
              >
                Approve & Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
