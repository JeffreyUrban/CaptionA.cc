import { useState, useEffect, useCallback, useRef } from 'react'

import {
  getBoxColors,
  type FrameBoxesData,
  type LayoutConfig,
  type ViewMode,
} from '~/types/review-labels'
import {
  getCanvasCoordinates,
  findBoxAtPosition,
  findBoxDisplayIndexAtPosition,
  getLabelFromMouseButton,
} from '~/utils/canvas-helpers'

interface UseReviewLabelsCanvasParams {
  viewMode: ViewMode
  currentFrameBoxes: FrameBoxesData | null
  layoutConfig: LayoutConfig | null
  videoId: string
  selectedFrameIndex: number | null
  frameBoxesCache: React.RefObject<Map<number, FrameBoxesData>>
  setCurrentFrameBoxes: React.Dispatch<React.SetStateAction<FrameBoxesData | null>>
  setHasUnsyncedAnnotations: (value: boolean) => void
  handleBoxClick: (boxIndex: number, label: 'in' | 'out') => Promise<void>
}

interface UseReviewLabelsCanvasReturn {
  imageRef: React.RefObject<HTMLImageElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  hoveredBoxIndex: number | null
  isSelecting: boolean
  cancelSelection: () => void
  handleCanvasClick: (e: React.MouseEvent<HTMLCanvasElement>) => void
  handleCanvasMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void
  handleCanvasContextMenu: (e: React.MouseEvent<HTMLCanvasElement>) => void
}

/**
 * Custom hook for managing canvas interactions in Review Labels workflow.
 */
// eslint-disable-next-line max-lines-per-function -- Canvas rendering and interaction logic for review labels
export function useReviewLabelsCanvas({
  viewMode,
  currentFrameBoxes,
  layoutConfig,
  videoId,
  selectedFrameIndex,
  frameBoxesCache,
  setCurrentFrameBoxes,
  setHasUnsyncedAnnotations,
  handleBoxClick,
}: UseReviewLabelsCanvasParams): UseReviewLabelsCanvasReturn {
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [hoveredBoxIndex, setHoveredBoxIndex] = useState<number | null>(null)

  // Selection rectangle state
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null)
  const [selectionCurrent, setSelectionCurrent] = useState<{ x: number; y: number } | null>(null)
  const [selectionLabel, setSelectionLabel] = useState<'in' | 'out' | 'clear' | null>(null)

  // Cancel selection helper
  const cancelSelection = useCallback(() => {
    setIsSelecting(false)
    setSelectionStart(null)
    setSelectionCurrent(null)
    setSelectionLabel(null)
  }, [])

  // Sync canvas size with displayed image
  useEffect(() => {
    const updateCanvasSize = () => {
      if (imageRef.current && canvasRef.current) {
        const img = imageRef.current
        setCanvasSize({ width: img.clientWidth, height: img.clientHeight })
      }
    }

    if (imageRef.current) {
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

  // Draw canvas
  const drawCanvas = useCallback(() => {
    if (!canvasRef.current || !imageRef.current || canvasSize.width === 0) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = canvasSize.width
    canvas.height = canvasSize.height
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (viewMode === 'frame' && currentFrameBoxes) {
      drawBoxes(ctx, currentFrameBoxes, canvasSize.width, hoveredBoxIndex)
      drawCropBounds(ctx, currentFrameBoxes, canvasSize.width, canvasSize.height)
    }

    if (isSelecting && selectionStart && selectionCurrent && selectionLabel) {
      drawSelectionRect(ctx, selectionStart, selectionCurrent, selectionLabel)
    }
  }, [
    canvasSize,
    viewMode,
    currentFrameBoxes,
    hoveredBoxIndex,
    isSelecting,
    selectionStart,
    selectionCurrent,
    selectionLabel,
  ])

  useEffect(() => {
    drawCanvas()
  }, [drawCanvas])

  // Complete selection and annotate boxes
  const completeSelection = useCallback(async () => {
    if (
      !isSelecting ||
      !selectionStart ||
      !selectionCurrent ||
      !selectionLabel ||
      !currentFrameBoxes
    )
      return

    if (viewMode === 'frame' && (selectionLabel === 'in' || selectionLabel === 'out')) {
      await annotateBoxesInSelection(
        selectionStart,
        selectionCurrent,
        selectionLabel,
        currentFrameBoxes,
        canvasSize.width,
        videoId,
        selectedFrameIndex,
        frameBoxesCache.current,
        setCurrentFrameBoxes,
        setHasUnsyncedAnnotations
      )
    }

    cancelSelection()
  }, [
    isSelecting,
    selectionStart,
    selectionCurrent,
    selectionLabel,
    currentFrameBoxes,
    canvasSize,
    videoId,
    selectedFrameIndex,
    viewMode,
    cancelSelection,
    frameBoxesCache,
    setCurrentFrameBoxes,
    setHasUnsyncedAnnotations,
  ])

  // Handle canvas click
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || canvasSize.width === 0) return
      if (e.button !== 0 && e.button !== 2) return

      if (e.button === 2) {
        e.preventDefault()
        e.stopPropagation()
      }

      const point = getCanvasCoordinates(e, canvasRef.current)

      if (isSelecting) {
        void completeSelection()
        return
      }

      if (!currentFrameBoxes) return

      const clickedBoxIndex = findBoxAtPosition(point, currentFrameBoxes, canvasSize.width)
      const label = getLabelFromMouseButton(e.button)

      if (clickedBoxIndex !== null) {
        void handleBoxClick(clickedBoxIndex, label)
      } else {
        setIsSelecting(true)
        setSelectionStart(point)
        setSelectionCurrent(point)
        setSelectionLabel(label)
      }
    },
    [currentFrameBoxes, canvasSize, isSelecting, completeSelection, handleBoxClick]
  )

  // Handle mouse move
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || canvasSize.width === 0) return

      const point = getCanvasCoordinates(e, canvasRef.current)

      if (isSelecting) {
        setSelectionCurrent(point)
        return
      }

      if (viewMode === 'frame' && currentFrameBoxes) {
        const foundIndex = findBoxDisplayIndexAtPosition(point, currentFrameBoxes, canvasSize.width)
        setHoveredBoxIndex(foundIndex)
      }
    },
    [currentFrameBoxes, canvasSize, isSelecting, viewMode]
  )

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  return {
    imageRef,
    canvasRef,
    hoveredBoxIndex,
    isSelecting,
    cancelSelection,
    handleCanvasClick,
    handleCanvasMouseMove,
    handleCanvasContextMenu,
  }
}

// --- Drawing Functions ---

function drawBoxes(
  ctx: CanvasRenderingContext2D,
  frameBoxes: FrameBoxesData,
  canvasWidth: number,
  hoveredBoxIndex: number | null
): void {
  const scale = canvasWidth / frameBoxes.frameWidth

  frameBoxes.boxes.forEach((box, index) => {
    const boxX = box.originalBounds.left * scale
    const boxY = box.originalBounds.top * scale
    const boxWidth = (box.originalBounds.right - box.originalBounds.left) * scale
    const boxHeight = (box.originalBounds.bottom - box.originalBounds.top) * scale

    const colors = getBoxColors(box.colorCode)

    ctx.strokeStyle = colors.border
    ctx.fillStyle = colors.background
    ctx.lineWidth = hoveredBoxIndex === index ? 3 : 2

    ctx.fillRect(boxX, boxY, boxWidth, boxHeight)
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight)

    if (hoveredBoxIndex === index) {
      drawBoxLabel(ctx, box.text, boxX, boxY, boxWidth, boxHeight)
    }
  })
}

function drawBoxLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number
): void {
  const fontSize = Math.max(Math.floor(boxHeight), 10)
  const labelHeight = fontSize + 8

  ctx.font = `${fontSize}px monospace`
  const textWidth = ctx.measureText(text).width
  const labelWidth = Math.max(boxWidth, textWidth + 8)

  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
  ctx.fillRect(boxX, boxY - labelHeight, labelWidth, labelHeight)

  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(text, boxX + labelWidth / 2, boxY - labelHeight / 2)

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
}

function drawCropBounds(
  ctx: CanvasRenderingContext2D,
  frameBoxes: FrameBoxesData,
  canvasWidth: number,
  canvasHeight: number
): void {
  const cropLeft = (frameBoxes.cropBounds.left / frameBoxes.frameWidth) * canvasWidth
  const cropTop = (frameBoxes.cropBounds.top / frameBoxes.frameHeight) * canvasHeight
  const cropRight = (frameBoxes.cropBounds.right / frameBoxes.frameWidth) * canvasWidth
  const cropBottom = (frameBoxes.cropBounds.bottom / frameBoxes.frameHeight) * canvasHeight

  ctx.strokeStyle = '#facc15'
  ctx.lineWidth = 2
  ctx.setLineDash([8, 4])
  ctx.strokeRect(cropLeft, cropTop, cropRight - cropLeft, cropBottom - cropTop)
  ctx.setLineDash([])
}

function drawSelectionRect(
  ctx: CanvasRenderingContext2D,
  start: { x: number; y: number },
  current: { x: number; y: number },
  label: 'in' | 'out' | 'clear'
): void {
  const selLeft = Math.min(start.x, current.x)
  const selTop = Math.min(start.y, current.y)
  const selWidth = Math.abs(current.x - start.x)
  const selHeight = Math.abs(current.y - start.y)

  const selColor = label === 'in' ? '#10b981' : '#ef4444'
  const selBgColor = label === 'in' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'

  ctx.strokeStyle = selColor
  ctx.fillStyle = selBgColor
  ctx.lineWidth = 3
  ctx.setLineDash([5, 5])

  ctx.fillRect(selLeft, selTop, selWidth, selHeight)
  ctx.strokeRect(selLeft, selTop, selWidth, selHeight)

  ctx.setLineDash([])
}

async function annotateBoxesInSelection(
  start: { x: number; y: number },
  current: { x: number; y: number },
  label: 'in' | 'out',
  frameBoxes: FrameBoxesData,
  canvasWidth: number,
  videoId: string,
  selectedFrameIndex: number | null,
  cache: Map<number, FrameBoxesData>,
  setCurrentFrameBoxes: (data: FrameBoxesData) => void,
  setHasUnsyncedAnnotations: (value: boolean) => void
): Promise<void> {
  const selRect = {
    left: Math.min(start.x, current.x),
    top: Math.min(start.y, current.y),
    right: Math.max(start.x, current.x),
    bottom: Math.max(start.y, current.y),
  }

  const scale = canvasWidth / frameBoxes.frameWidth
  const enclosedBoxes: number[] = []

  frameBoxes.boxes.forEach(box => {
    const boxX = box.originalBounds.left * scale
    const boxY = box.originalBounds.top * scale
    const boxRight = box.originalBounds.right * scale
    const boxBottom = box.originalBounds.bottom * scale

    if (
      boxX >= selRect.left &&
      boxY >= selRect.top &&
      boxRight <= selRect.right &&
      boxBottom <= selRect.bottom
    ) {
      enclosedBoxes.push(box.boxIndex)
    }
  })

  if (enclosedBoxes.length === 0) return

  const annotations = enclosedBoxes.map(boxIndex => ({ boxIndex, label }))

  try {
    await fetch(
      `/api/annotations/${encodeURIComponent(videoId)}/frames/${frameBoxes.frameIndex}/boxes`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations }),
      }
    )

    if (selectedFrameIndex !== null) {
      cache.delete(selectedFrameIndex)
    }

    const response = await fetch(
      `/api/annotations/${encodeURIComponent(videoId)}/frames/${selectedFrameIndex}/boxes`
    )
    const data = await response.json()
    setCurrentFrameBoxes(data)

    if (selectedFrameIndex !== null) {
      cache.set(selectedFrameIndex, data)
    }

    setHasUnsyncedAnnotations(true)
  } catch (err) {
    console.error('Failed to save annotations:', err)
  }
}
