/**
 * Canvas drawing helpers for the Layout annotation workflow.
 * Pure functions for rendering boxes, overlays, and selection rectangles.
 */

import type {
  BoxData,
  LayoutConfig,
  BoxRenderParams,
  SelectionRenderParams,
  SelectionRectangle,
  CanvasPoint,
} from '~/types/layout'
import { getBoxColors } from '~/types/layout'

/**
 * Get fill color for analysis box based on label and prediction
 */
export function getAnalysisBoxFillColor(box: BoxData): string {
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

/**
 * Draw box text label when hovered
 */
export function drawBoxLabel(
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

/**
 * Draw a single box in frame mode with optional pulsing highlight
 */
export function drawFrameBox(ctx: CanvasRenderingContext2D, params: BoxRenderParams): void {
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

/**
 * Draw layout parameter overlays (crop bounds, selection rect, guidelines)
 */
export function drawLayoutOverlays(
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

/**
 * Draw selection rectangle during drag operation
 */
export function drawSelectionRectangle(
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

/**
 * Calculate selection rectangle from start/current points
 */
export function calculateCanvasSelectionRect(
  selectionStart: CanvasPoint,
  selectionCurrent: CanvasPoint
): SelectionRectangle {
  return {
    left: Math.min(selectionStart.x, selectionCurrent.x),
    top: Math.min(selectionStart.y, selectionCurrent.y),
    right: Math.max(selectionStart.x, selectionCurrent.x),
    bottom: Math.max(selectionStart.y, selectionCurrent.y),
  }
}

/**
 * Convert canvas coordinates to frame coordinates
 */
export function convertToFrameCoordinates(
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

/**
 * Find boxes enclosed by a selection rectangle
 */
export function findEnclosedBoxes(
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

/**
 * Find box at a click position
 */
export function findClickedBox(
  boxes: BoxData[],
  x: number,
  y: number,
  scale: number
): number | null {
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

/**
 * Find hovered box index (array position)
 */
export function findHoveredBoxIndex(
  boxes: BoxData[],
  x: number,
  y: number,
  scale: number
): number | null {
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

/**
 * Generate analysis thumbnail by rendering to offscreen canvas
 */
export function generateAnalysisThumbnail(
  analysisBoxes: BoxData[],
  layoutConfig: LayoutConfig
): string | null {
  try {
    const thumbnailCanvas = document.createElement('canvas')
    const thumbnailWidth = 320
    const thumbnailHeight = Math.round(
      (layoutConfig.frameHeight / layoutConfig.frameWidth) * thumbnailWidth
    )

    thumbnailCanvas.width = thumbnailWidth
    thumbnailCanvas.height = thumbnailHeight
    const ctx = thumbnailCanvas.getContext('2d')

    if (!ctx) return null

    // Draw black background
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, thumbnailWidth, thumbnailHeight)

    // Calculate scale for thumbnail
    const scale = thumbnailWidth / layoutConfig.frameWidth

    // Draw all analysis boxes
    analysisBoxes.forEach(box => {
      const boxX = box.originalBounds.left * scale
      const boxY = box.originalBounds.top * scale
      const boxWidth = (box.originalBounds.right - box.originalBounds.left) * scale
      const boxHeight = (box.originalBounds.bottom - box.originalBounds.top) * scale

      ctx.fillStyle = getAnalysisBoxFillColor(box)
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

    return thumbnailCanvas.toDataURL('image/png')
  } catch (error) {
    console.error('Error generating analysis thumbnail:', error)
    return null
  }
}

/**
 * Calculate pulse animation values for box highlighting
 */
export function calculatePulseValues(pulseStartTime: number): {
  pulseValue: number
  pulseIntensity: number
} {
  const pulsePhase = (Date.now() % 1000) / 1000
  const pulseValue = Math.sin(pulsePhase * Math.PI * 2) * 0.5 + 0.5
  const elapsedSeconds = (Date.now() - pulseStartTime) / 1000
  const pulseIntensity = Math.min(elapsedSeconds / 10, 1)

  return { pulseValue, pulseIntensity }
}

/**
 * Get interaction area coordinates relative to canvas
 */
export function getInteractionAreaCoordinates(
  e: React.MouseEvent<HTMLDivElement>,
  imageRef: React.RefObject<HTMLImageElement | null>,
  interactionAreaRef: React.RefObject<HTMLDivElement | null>
): CanvasPoint | null {
  if (!imageRef.current || !interactionAreaRef.current) return null

  const image = imageRef.current
  const interactionArea = interactionAreaRef.current

  // Get mouse position relative to interaction area
  const areaRect = interactionArea.getBoundingClientRect()
  const areaX = e.clientX - areaRect.left
  const areaY = e.clientY - areaRect.top

  // Get image position within interaction area
  const imageRect = image.getBoundingClientRect()
  const imageOffsetX = imageRect.left - areaRect.left
  const imageOffsetY = imageRect.top - areaRect.top

  // Calculate position relative to canvas
  return {
    x: areaX - imageOffsetX,
    y: areaY - imageOffsetY,
  }
}
