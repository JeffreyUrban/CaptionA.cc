/**
 * Custom hook for managing canvas interactions in the Layout annotation workflow.
 * Handles canvas sizing, drawing, selection, and mouse interactions.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

import type {
  FrameBoxesData,
  LayoutConfig,
  BoxData,
  ViewMode,
  CanvasPoint,
  SelectionLabel,
  SelectionRectangle,
} from '~/types/layout'
import { RECALC_THRESHOLD } from '~/types/layout'
import { bulkAnnotateAll, fetchFrameBoxes, saveBoxAnnotations } from '~/utils/layout-api'
import {
  drawFrameBox,
  drawLayoutOverlays,
  drawSelectionRectangle,
  getAnalysisBoxFillColor,
  calculatePulseValues,
  getInteractionAreaCoordinates,
  calculateCanvasSelectionRect,
  convertToFrameCoordinates,
  findEnclosedBoxes,
  findClickedBox,
  findHoveredBoxIndex,
} from '~/utils/layout-canvas-helpers'

interface UseLayoutCanvasParams {
  viewMode: ViewMode
  currentFrameBoxes: FrameBoxesData | null
  layoutConfig: LayoutConfig | null
  analysisBoxes: BoxData[] | null
  videoId: string
  selectedFrameIndex: number | null
  annotationsSinceRecalc: number
  pulseStartTime: number
  frameBoxesCache: React.RefObject<Map<number, FrameBoxesData>>
  setCurrentFrameBoxes: React.Dispatch<React.SetStateAction<FrameBoxesData | null>>
  setHasUnsyncedAnnotations: (value: boolean) => void
  setAnnotationsSinceRecalc: (count: number) => void
  handleBoxClick: (boxIndex: number, label: 'in' | 'out') => Promise<void>
  recalculateCropBounds: () => Promise<void>
  loadAnalysisBoxes: () => Promise<void>
}

interface UseLayoutCanvasReturn {
  imageRef: React.RefObject<HTMLImageElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  interactionAreaRef: React.RefObject<HTMLDivElement | null>
  canvasSize: { width: number; height: number }
  hoveredBoxIndex: number | null
  isSelecting: boolean
  cancelSelection: () => void
  handleCanvasClick: (e: React.MouseEvent<HTMLDivElement>) => void
  handleCanvasMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void
  handleCanvasContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void
}

export const SELECTION_PADDING = 20

export function useLayoutCanvas(params: UseLayoutCanvasParams): UseLayoutCanvasReturn {
  const {
    viewMode,
    currentFrameBoxes,
    layoutConfig,
    analysisBoxes,
    videoId,
    selectedFrameIndex,
    annotationsSinceRecalc,
    pulseStartTime,
    frameBoxesCache,
    setCurrentFrameBoxes,
    setHasUnsyncedAnnotations,
    setAnnotationsSinceRecalc,
    handleBoxClick,
    recalculateCropBounds,
    loadAnalysisBoxes,
  } = params

  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const interactionAreaRef = useRef<HTMLDivElement>(null)

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [hoveredBoxIndex, setHoveredBoxIndex] = useState<number | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionStart, setSelectionStart] = useState<CanvasPoint | null>(null)
  const [selectionCurrent, setSelectionCurrent] = useState<CanvasPoint | null>(null)
  const [selectionLabel, setSelectionLabel] = useState<SelectionLabel | null>(null)
  const [boxHighlightMode] = useState(true)

  const cancelSelection = useCallback(() => {
    setIsSelecting(false)
    setSelectionStart(null)
    setSelectionCurrent(null)
    setSelectionLabel(null)
  }, [])

  // Sync canvas size with image
  useEffect(() => {
    const updateCanvasSize = () => {
      if (imageRef.current && canvasRef.current) {
        setCanvasSize({
          width: imageRef.current.clientWidth,
          height: imageRef.current.clientHeight,
        })
      }
    }

    const imgElement = imageRef.current
    if (imgElement) {
      if (imgElement.complete) updateCanvasSize()
      else {
        imgElement.addEventListener('load', updateCanvasSize)
        return () => imgElement.removeEventListener('load', updateCanvasSize)
      }
    }

    window.addEventListener('resize', updateCanvasSize)
    return () => window.removeEventListener('resize', updateCanvasSize)
  }, [viewMode, currentFrameBoxes, layoutConfig])

  // Main drawing function
  const drawCanvas = useCallback(() => {
    if (!canvasRef.current || !imageRef.current || canvasSize.width === 0) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    canvasRef.current.width = canvasSize.width
    canvasRef.current.height = canvasSize.height
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height)

    if (viewMode === 'frame' && currentFrameBoxes) {
      const scale = canvasSize.width / currentFrameBoxes.frameWidth
      const { pulseValue, pulseIntensity } = calculatePulseValues(pulseStartTime)
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
      analysisBoxes.forEach(box => {
        const boxX = box.originalBounds.left * scale
        const boxY = box.originalBounds.top * scale
        const boxW = (box.originalBounds.right - box.originalBounds.left) * scale
        const boxH = (box.originalBounds.bottom - box.originalBounds.top) * scale
        ctx.fillStyle = getAnalysisBoxFillColor(box)
        ctx.fillRect(boxX, boxY, boxW, boxH)
      })
      drawLayoutOverlays(ctx, layoutConfig, scale, canvasSize.width, canvasSize.height)
    }

    if (isSelecting && selectionStart && selectionCurrent && selectionLabel) {
      drawSelectionRectangle(ctx, { selectionStart, selectionCurrent, selectionLabel, viewMode })
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

  useEffect(() => {
    drawCanvas()
  }, [drawCanvas])

  useEffect(() => {
    if (!boxHighlightMode || viewMode !== 'frame') return
    let animationFrameId: number
    const animate = () => {
      drawCanvas()
      animationFrameId = requestAnimationFrame(animate)
    }
    animationFrameId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrameId)
  }, [boxHighlightMode, viewMode, drawCanvas])

  // Selection handlers
  const handleAnalysisSelection = useCallback(
    async (rect: SelectionRectangle, label: SelectionLabel) => {
      if (!layoutConfig) return
      const scaleX = layoutConfig.frameWidth / canvasSize.width
      const scaleY = layoutConfig.frameHeight / canvasSize.height
      const frameRect = convertToFrameCoordinates(rect, scaleX, scaleY)

      try {
        const result = await bulkAnnotateAll(
          videoId,
          frameRect,
          label === 'clear' ? 'clear' : 'mark_out'
        )
        await loadAnalysisBoxes()
        frameBoxesCache.current.clear()
        setHasUnsyncedAnnotations(true)
        if (result.newlyAnnotatedBoxes && result.newlyAnnotatedBoxes > 0) {
          const newCount = annotationsSinceRecalc + result.newlyAnnotatedBoxes
          setAnnotationsSinceRecalc(newCount)
          if (newCount >= RECALC_THRESHOLD) await recalculateCropBounds()
        }
      } catch (err) {
        console.error('Failed to bulk annotate:', err)
      }
    },
    [
      layoutConfig,
      canvasSize,
      videoId,
      loadAnalysisBoxes,
      annotationsSinceRecalc,
      setAnnotationsSinceRecalc,
      recalculateCropBounds,
      setHasUnsyncedAnnotations,
      frameBoxesCache,
    ]
  )

  const handleFrameSelection = useCallback(
    async (rect: SelectionRectangle, label: 'in' | 'out') => {
      if (!currentFrameBoxes) return
      const scale = canvasSize.width / currentFrameBoxes.frameWidth
      const { enclosedBoxes, newlyAnnotatedCount } = findEnclosedBoxes(
        currentFrameBoxes.boxes,
        rect,
        scale
      )
      if (enclosedBoxes.length === 0) return

      try {
        await saveBoxAnnotations(
          videoId,
          currentFrameBoxes.frameIndex,
          enclosedBoxes.map(boxIndex => ({ boxIndex, label }))
        )
        if (selectedFrameIndex !== null) {
          frameBoxesCache.current.delete(selectedFrameIndex)
          const data = await fetchFrameBoxes(videoId, selectedFrameIndex)
          setCurrentFrameBoxes(data)
          frameBoxesCache.current.set(selectedFrameIndex, data)
        }
        setHasUnsyncedAnnotations(true)

        if (newlyAnnotatedCount > 0) {
          const newCount = annotationsSinceRecalc + newlyAnnotatedCount
          setAnnotationsSinceRecalc(newCount)
          if (newCount >= RECALC_THRESHOLD) await recalculateCropBounds()
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
      recalculateCropBounds,
      setCurrentFrameBoxes,
      setHasUnsyncedAnnotations,
      setAnnotationsSinceRecalc,
      frameBoxesCache,
    ]
  )

  const completeSelection = useCallback(async () => {
    if (!isSelecting || !selectionStart || !selectionCurrent || !selectionLabel) return
    const rect = calculateCanvasSelectionRect(selectionStart, selectionCurrent)
    cancelSelection()
    if (viewMode === 'analysis') await handleAnalysisSelection(rect, selectionLabel)
    else if (viewMode === 'frame' && (selectionLabel === 'in' || selectionLabel === 'out'))
      await handleFrameSelection(rect, selectionLabel)
  }, [
    isSelecting,
    selectionStart,
    selectionCurrent,
    selectionLabel,
    viewMode,
    handleAnalysisSelection,
    handleFrameSelection,
    cancelSelection,
  ])

  const startSelection = useCallback((x: number, y: number, label: SelectionLabel) => {
    setIsSelecting(true)
    setSelectionStart({ x, y })
    setSelectionCurrent({ x, y })
    setSelectionLabel(label)
  }, [])

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!canvasRef.current || canvasSize.width === 0) return
      if (annotationsSinceRecalc >= RECALC_THRESHOLD) return
      if (e.button !== 0 && e.button !== 2) return
      if (e.button === 2) {
        e.preventDefault()
        e.stopPropagation()
      }

      const coords = getInteractionAreaCoordinates(e, imageRef, interactionAreaRef)
      if (!coords) return

      if (isSelecting) {
        void completeSelection()
        return
      }

      if (viewMode === 'analysis') {
        startSelection(coords.x, coords.y, e.button === 0 ? 'clear' : 'out')
        return
      }

      if (!currentFrameBoxes) return
      const scale = canvasSize.width / currentFrameBoxes.frameWidth
      const clickedBoxIndex = findClickedBox(currentFrameBoxes.boxes, coords.x, coords.y, scale)
      const label: 'in' | 'out' = e.button === 0 ? 'in' : 'out'
      if (clickedBoxIndex !== null) void handleBoxClick(clickedBoxIndex, label)
      else startSelection(coords.x, coords.y, label)
    },
    [
      currentFrameBoxes,
      canvasSize,
      isSelecting,
      completeSelection,
      handleBoxClick,
      viewMode,
      annotationsSinceRecalc,
      startSelection,
    ]
  )

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (
        !canvasRef.current ||
        canvasSize.width === 0 ||
        annotationsSinceRecalc >= RECALC_THRESHOLD
      )
        return
      const coords = getInteractionAreaCoordinates(e, imageRef, interactionAreaRef)
      if (!coords) return

      if (isSelecting) {
        setSelectionCurrent({ x: coords.x, y: coords.y })
        return
      }

      if (viewMode === 'frame' && currentFrameBoxes) {
        const scale = canvasSize.width / currentFrameBoxes.frameWidth
        setHoveredBoxIndex(findHoveredBoxIndex(currentFrameBoxes.boxes, coords.x, coords.y, scale))
      }
    },
    [currentFrameBoxes, canvasSize, isSelecting, viewMode, annotationsSinceRecalc]
  )

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  return {
    imageRef,
    canvasRef,
    interactionAreaRef,
    canvasSize,
    hoveredBoxIndex,
    isSelecting,
    cancelSelection,
    handleCanvasClick,
    handleCanvasMouseMove,
    handleCanvasContextMenu,
  }
}
