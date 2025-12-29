import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

import { AppLayout } from '~/components/AppLayout'

interface FrameInfo {
  frameIndex: number
  totalBoxCount: number
  captionBoxCount: number
  minConfidence: number
  hasAnnotations: boolean
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

// Loader function to expose environment variables
export async function loader() {
  return {
    defaultVideoId: process.env['DEFAULT_VIDEO_ID'] || '',
  }
}

export default function AnnotateLayout() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const videoId = searchParams.get('videoId') || ''

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
  const [currentVisualizationUrl, setCurrentVisualizationUrl] = useState<string | null>(null)
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

  // Layout controls state (local modifications before save)
  const [cropBoundsEdit, setCropBoundsEdit] = useState<{
    left: number
    top: number
    right: number
    bottom: number
  } | null>(null)
  const [selectionRectEdit, setSelectionRectEdit] = useState<{
    left: number
    top: number
    right: number
    bottom: number
  } | null>(null)
  const [layoutParamsEdit, setLayoutParamsEdit] = useState<{
    verticalPosition: number | null
    verticalStd: number | null
    boxHeight: number | null
    boxHeightStd: number | null
    anchorType: 'left' | 'center' | 'right' | null
    anchorPosition: number | null
  } | null>(null)

  // Mark video as being worked on
  useEffect(() => {
    if (videoId && typeof window !== 'undefined') {
      const touchedVideos = new Set(JSON.parse(localStorage.getItem('touched-videos') || '[]'))
      touchedVideos.add(videoId)
      localStorage.setItem('touched-videos', JSON.stringify(Array.from(touchedVideos)))
    }
  }, [videoId])

  // Load layout queue (top frames + config)
  const loadQueue = useCallback(
    async (showLoading = true, skipEditStateUpdate = false) => {
      if (!videoId) return

      console.log(
        `[Frontend] loadQueue called (showLoading=${showLoading}, skipEditStateUpdate=${skipEditStateUpdate})`
      )

      // Don't block UI with loading screen
      if (showLoading) {
        setError(null)
      }

      try {
        const response = await fetch(`/api/annotations/${encodeURIComponent(videoId)}/layout-queue`)

        if (!response.ok) {
          const errorData = await response.json()

          // Handle processing status errors specially
          if (response.status === 425 && errorData.processingStatus) {
            throw new Error(`Processing: ${errorData.processingStatus}`)
          }

          throw new Error(errorData.error || 'Failed to load layout queue')
        }

        const data = await response.json()

        console.log(
          `[Frontend] Received ${data.frames?.length || 0} frames:`,
          data.frames?.map((f: FrameInfo) => f.frameIndex)
        )

        setFrames(data.frames || [])

        // Always update layout config (not just on initial load)
        setLayoutConfig(data.layoutConfig || null)
        setLayoutApproved(data.layoutApproved || false)

        // Update edit state from config
        // BUT: Skip updating edit state if this is after an auto-recalculation
        // so user can see the changes and choose to apply them
        if (data.layoutConfig && !skipEditStateUpdate) {
          setCropBoundsEdit({
            left: data.layoutConfig.cropLeft,
            top: data.layoutConfig.cropTop,
            right: data.layoutConfig.cropRight,
            bottom: data.layoutConfig.cropBottom,
          })
          setSelectionRectEdit(
            data.layoutConfig.selectionLeft !== null
              ? {
                  left: data.layoutConfig.selectionLeft,
                  top: data.layoutConfig.selectionTop,
                  right: data.layoutConfig.selectionRight,
                  bottom: data.layoutConfig.selectionBottom,
                }
              : null
          )
          setLayoutParamsEdit({
            verticalPosition: data.layoutConfig.verticalPosition,
            verticalStd: data.layoutConfig.verticalStd,
            boxHeight: data.layoutConfig.boxHeight,
            boxHeightStd: data.layoutConfig.boxHeightStd,
            anchorType: data.layoutConfig.anchorType,
            anchorPosition: data.layoutConfig.anchorPosition,
          })
        }

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
    [videoId]
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
      setAnalysisBoxes(data.boxes || [])
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
        const errorMessage = result.message || result.error || 'Failed to recalculate crop bounds'
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
      loadQueue(true)
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

    loadFrameBoxes()
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

    // Only draw boxes in frame mode
    if (viewMode === 'frame' && currentFrameBoxes) {
      // Calculate scale factor from original frame to displayed image
      const scale = canvasSize.width / currentFrameBoxes.frameWidth

      // Draw boxes using original bounds
      currentFrameBoxes.boxes.forEach((box, index) => {
        // Convert original pixel bounds to canvas coordinates
        const boxX = box.originalBounds.left * scale
        const boxY = box.originalBounds.top * scale
        const boxWidth = (box.originalBounds.right - box.originalBounds.left) * scale
        const boxHeight = (box.originalBounds.bottom - box.originalBounds.top) * scale

        // Get color based on color code
        const colors = getBoxColors(box.colorCode)

        // Draw box
        ctx.strokeStyle = colors.border
        ctx.fillStyle = colors.background
        ctx.lineWidth = hoveredBoxIndex === index ? 3 : 2

        ctx.fillRect(boxX, boxY, boxWidth, boxHeight)
        ctx.strokeRect(boxX, boxY, boxWidth, boxHeight)

        // Draw text label if hovered
        if (hoveredBoxIndex === index) {
          // Scale font size to match box height
          const fontSize = Math.max(Math.floor(boxHeight), 10)
          const labelHeight = fontSize + 8

          // Set font before measuring text
          ctx.font = `${fontSize}px monospace`
          const textWidth = ctx.measureText(box.text).width
          const labelWidth = Math.max(boxWidth, textWidth + 8)

          // Draw background
          ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
          ctx.fillRect(boxX, boxY - labelHeight, labelWidth, labelHeight)

          // Draw centered text
          ctx.fillStyle = '#ffffff'
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'center'
          ctx.fillText(box.text, boxX + labelWidth / 2, boxY - labelHeight / 2)

          // Reset to defaults
          ctx.textBaseline = 'alphabetic'
          ctx.textAlign = 'left'
        }
      })
    } else if (viewMode === 'analysis' && analysisBoxes && layoutConfig) {
      // Analysis mode: Draw all OCR boxes from all frames with additive transparency
      const scale = canvasSize.width / layoutConfig.frameWidth

      // Draw all boxes with transparency for additive effect
      analysisBoxes.forEach(box => {
        const boxX = box.originalBounds.left * scale
        const boxY = box.originalBounds.top * scale
        const boxWidth = (box.originalBounds.right - box.originalBounds.left) * scale
        const boxHeight = (box.originalBounds.bottom - box.originalBounds.top) * scale

        // Determine color based on user label or prediction (matching frame view palette)
        let strokeColor: string
        let fillColor: string

        if (box.userLabel === 'in') {
          // User annotated as in
          strokeColor = '#14b8a6' // Teal
          fillColor = 'rgba(20,184,166,0.05)' // Very transparent for additive effect
        } else if (box.userLabel === 'out') {
          // User annotated as out
          strokeColor = '#dc2626' // Red
          fillColor = 'rgba(220,38,38,0.05)' // Very transparent for additive effect
        } else if (box.predictedLabel === 'in') {
          // Predicted in - use confidence levels (blue)
          if (box.predictedConfidence >= 0.75) {
            strokeColor = '#3b82f6' // Blue (high confidence)
            fillColor = 'rgba(59,130,246,0.03)'
          } else if (box.predictedConfidence >= 0.5) {
            strokeColor = '#60a5fa' // Light blue (medium confidence)
            fillColor = 'rgba(96,165,250,0.02)'
          } else {
            strokeColor = '#93c5fd' // Very light blue (low confidence)
            fillColor = 'rgba(147,197,253,0.015)'
          }
        } else {
          // Predicted out - use confidence levels (orange)
          if (box.predictedConfidence >= 0.75) {
            strokeColor = '#f97316' // Orange (high confidence)
            fillColor = 'rgba(249,115,22,0.03)'
          } else if (box.predictedConfidence >= 0.5) {
            strokeColor = '#fb923c' // Light orange (medium confidence)
            fillColor = 'rgba(251,146,60,0.02)'
          } else {
            strokeColor = '#fdba74' // Very light orange (low confidence)
            fillColor = 'rgba(253,186,116,0.015)'
          }
        }

        // Draw box as solid fill (no outline)
        ctx.fillStyle = fillColor
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight)
      })

      // Draw layout parameter overlays
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
        ctx.lineTo(canvasSize.width, lineY)
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
        ctx.lineTo(lineX, canvasSize.height)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // Draw selection rectangle (click-to-start, click-to-end)
    if (isSelecting && selectionStart && selectionCurrent && selectionLabel) {
      const selLeft = Math.min(selectionStart.x, selectionCurrent.x)
      const selTop = Math.min(selectionStart.y, selectionCurrent.y)
      const selWidth = Math.abs(selectionCurrent.x - selectionStart.x)
      const selHeight = Math.abs(selectionCurrent.y - selectionStart.y)

      // Color based on selection label and view mode
      // Frame mode: in=green, out=red
      // Analysis mode: clear=gray, out=red
      let selColor: string
      let selBgColor: string

      if (viewMode === 'analysis') {
        // Analysis mode: left=clear (gray), right=out (red)
        selColor = selectionLabel === 'clear' ? '#6b7280' : '#ef4444'
        selBgColor = selectionLabel === 'clear' ? 'rgba(107,114,128,0.15)' : 'rgba(239,68,68,0.15)'
      } else {
        // Frame mode: left=in (green), right=out (red)
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
    selectedFrameIndex,
  ])

  // Call drawCanvas in an effect when dependencies change
  useEffect(() => {
    drawCanvas()
  }, [drawCanvas])

  // Get box colors based on color code
  const getBoxColors = (colorCode: string): { border: string; background: string } => {
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
    return colorMap[colorCode] || { border: '#9ca3af', background: 'rgba(156,163,175,0.1)' }
  }

  // Complete selection and annotate boxes
  const completeSelection = useCallback(async () => {
    if (!isSelecting || !selectionStart || !selectionCurrent || !selectionLabel) return

    // Calculate selection rectangle in canvas coordinates
    const selRectCanvas = {
      left: Math.min(selectionStart.x, selectionCurrent.x),
      top: Math.min(selectionStart.y, selectionCurrent.y),
      right: Math.max(selectionStart.x, selectionCurrent.x),
      bottom: Math.max(selectionStart.y, selectionCurrent.y),
    }

    // Reset selection state immediately so rectangle disappears
    setIsSelecting(false)
    setSelectionStart(null)
    setSelectionCurrent(null)
    setSelectionLabel(null)

    if (viewMode === 'analysis') {
      // Analysis mode: Bulk annotate across ALL 0.1Hz frames
      if (!layoutConfig) return

      const scaleX = layoutConfig.frameWidth / canvasSize.width
      const scaleY = layoutConfig.frameHeight / canvasSize.height

      const rectangleFrameCoords = {
        left: Math.floor(selRectCanvas.left * scaleX),
        top: Math.floor(selRectCanvas.top * scaleY),
        right: Math.floor(selRectCanvas.right * scaleX),
        bottom: Math.floor(selRectCanvas.bottom * scaleY),
      }

      const action = selectionLabel === 'clear' ? 'clear' : 'mark_out'

      try {
        const response = await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/bulk-annotate-all`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              rectangle: rectangleFrameCoords,
              action,
            }),
          }
        )

        const result = await response.json()

        if (!response.ok || result.error) {
          console.error('Bulk annotate all failed:', result.error || `HTTP ${response.status}`)
          console.error('Error details:', result)
          throw new Error(result.error || 'Failed to bulk annotate')
        }

        // Reload analysis boxes to reflect the changes
        await loadAnalysisBoxes()

        // Clear frame boxes cache so they reload with updated annotations
        frameBoxesCache.current.clear()

        // Mark that we have unsynced annotations
        setHasUnsyncedAnnotations(true)

        // Only increment counter for newly annotated boxes, not changes to existing ones
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
    } else if (viewMode === 'frame' && currentFrameBoxes) {
      // Frame mode: Use individual box annotation API
      const scale = canvasSize.width / currentFrameBoxes.frameWidth

      // Find all boxes fully enclosed by selection rectangle
      const enclosedBoxes: number[] = []
      const newlyAnnotatedCount = { count: 0 } // Track only new annotations

      currentFrameBoxes.boxes.forEach(box => {
        const boxX = box.originalBounds.left * scale
        const boxY = box.originalBounds.top * scale
        const boxRight = box.originalBounds.right * scale
        const boxBottom = box.originalBounds.bottom * scale

        // Check if box is fully enclosed
        if (
          boxX >= selRectCanvas.left &&
          boxY >= selRectCanvas.top &&
          boxRight <= selRectCanvas.right &&
          boxBottom <= selRectCanvas.bottom
        ) {
          enclosedBoxes.push(box.boxIndex)
          // Count only if this box doesn't already have a user label
          if (box.userLabel === null) {
            newlyAnnotatedCount.count++
          }
        }
      })

      // Annotate all enclosed boxes
      if (enclosedBoxes.length > 0 && (selectionLabel === 'in' || selectionLabel === 'out')) {
        const annotations = enclosedBoxes.map(boxIndex => ({ boxIndex, label: selectionLabel }))

        try {
          await fetch(
            `/api/annotations/${encodeURIComponent(videoId)}/frames/${currentFrameBoxes.frameIndex}/boxes`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ annotations }),
            }
          )

          // Invalidate cache and reload frame boxes to get updated colors
          if (selectedFrameIndex !== null) {
            frameBoxesCache.current.delete(selectedFrameIndex)
          }
          const response = await fetch(
            `/api/annotations/${encodeURIComponent(videoId)}/frames/${selectedFrameIndex}/boxes`
          )
          const data = await response.json()
          setCurrentFrameBoxes(data)

          // Cache the fresh data
          if (selectedFrameIndex !== null) {
            frameBoxesCache.current.set(selectedFrameIndex, data)
          }

          // Mark that we have unsynced annotations
          setHasUnsyncedAnnotations(true)

          // Only increment counter for newly annotated boxes, not changes to existing ones
          if (newlyAnnotatedCount.count > 0) {
            const newCount = annotationsSinceRecalc + newlyAnnotatedCount.count
            setAnnotationsSinceRecalc(newCount)

            if (newCount >= RECALC_THRESHOLD) {
              console.log(
                `[Layout] Reached ${newCount} annotations, triggering crop bounds recalculation`
              )
              await recalculateCropBounds()
            }
          }
        } catch (err) {
          console.error('Failed to save annotations:', err)
        }
      }
    }
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
    layoutConfig,
    loadAnalysisBoxes,
    annotationsSinceRecalc,
    RECALC_THRESHOLD,
    recalculateCropBounds,
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

  // Handle canvas click - individual box annotation, or start/complete selection
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!canvasRef.current || canvasSize.width === 0) return

      // Disable annotations during recalculation
      if (annotationsSinceRecalc >= RECALC_THRESHOLD) return

      // Only handle left and right button
      if (e.button !== 0 && e.button !== 2) return

      // Prevent context menu on right click
      if (e.button === 2) {
        e.preventDefault()
        e.stopPropagation()
      }

      const coords = getCanvasCoordinates(e)
      if (!coords) return
      const { x, y } = coords

      if (isSelecting) {
        // Already selecting - second click completes selection
        void completeSelection()
        return
      }

      // In analysis mode, only do area selection (no individual boxes)
      if (viewMode === 'analysis') {
        // Start rectangle selection
        // Left click = 'clear', Right click = 'out'
        const label = e.button === 0 ? 'clear' : 'out'
        setIsSelecting(true)
        setSelectionStart({ x, y })
        setSelectionCurrent({ x, y })
        setSelectionLabel(label)
        return
      }

      // Frame mode - unchanged from original behavior
      if (!currentFrameBoxes) return

      // Check if clicking on a box
      const scale = canvasSize.width / currentFrameBoxes.frameWidth
      let clickedBoxIndex: number | null = null

      for (let i = currentFrameBoxes.boxes.length - 1; i >= 0; i--) {
        const box = currentFrameBoxes.boxes[i]
        if (!box) continue

        const boxX = box.originalBounds.left * scale
        const boxY = box.originalBounds.top * scale
        const boxWidth = (box.originalBounds.right - box.originalBounds.left) * scale
        const boxHeight = (box.originalBounds.bottom - box.originalBounds.top) * scale

        if (x >= boxX && x <= boxX + boxWidth && y >= boxY && y <= boxY + boxHeight) {
          clickedBoxIndex = box.boxIndex
          break
        }
      }

      if (clickedBoxIndex !== null) {
        // Clicked on a box - annotate it individually
        const label = e.button === 0 ? 'in' : 'out'
        handleBoxClick(clickedBoxIndex, label)
      } else {
        // Clicked on empty space - start rectangle selection
        const label = e.button === 0 ? 'in' : 'out'
        setIsSelecting(true)
        setSelectionStart({ x, y })
        setSelectionCurrent({ x, y })
        setSelectionLabel(label)
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
    ]
  )

  // Handle mouse move - update selection rectangle or detect hover
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!canvasRef.current || canvasSize.width === 0) return

      // Disable annotations during recalculation
      if (annotationsSinceRecalc >= RECALC_THRESHOLD) return

      const coords = getCanvasCoordinates(e)
      if (!coords) return
      const { x, y } = coords

      // Update selection current position if selecting
      if (isSelecting) {
        setSelectionCurrent({ x, y })
        return
      }

      // Box hover detection only in frame mode
      if (viewMode === 'frame' && currentFrameBoxes) {
        // Calculate scale factor
        const scale = canvasSize.width / currentFrameBoxes.frameWidth

        // Find hovered box using original bounds
        let foundIndex: number | null = null
        for (let i = currentFrameBoxes.boxes.length - 1; i >= 0; i--) {
          const box = currentFrameBoxes.boxes[i]
          if (!box) continue

          const boxX = box.originalBounds.left * scale
          const boxY = box.originalBounds.top * scale
          const boxWidth = (box.originalBounds.right - box.originalBounds.left) * scale
          const boxHeight = (box.originalBounds.bottom - box.originalBounds.top) * scale

          if (x >= boxX && x <= boxX + boxWidth && y >= boxY && y <= boxY + boxHeight) {
            foundIndex = i
            break
          }
        }

        setHoveredBoxIndex(foundIndex)
      }
    },
    [currentFrameBoxes, canvasSize, isSelecting, viewMode, getCanvasCoordinates]
  )

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          // Previous frame
          if (viewMode === 'frame' && selectedFrameIndex !== null) {
            const currentIndex = frames.findIndex(f => f.frameIndex === selectedFrameIndex)
            if (currentIndex > 0) {
              const prevFrame = frames[currentIndex - 1]
              if (prevFrame) {
                handleThumbnailClick(prevFrame.frameIndex)
              }
            }
          }
          break

        case 'ArrowRight':
          e.preventDefault()
          // Next frame
          if (viewMode === 'frame' && selectedFrameIndex !== null) {
            const currentIndex = frames.findIndex(f => f.frameIndex === selectedFrameIndex)
            if (currentIndex < frames.length - 1) {
              const nextFrame = frames[currentIndex + 1]
              if (nextFrame) {
                handleThumbnailClick(nextFrame.frameIndex)
              }
            }
          } else if (viewMode === 'analysis' && frames.length > 0) {
            const firstFrame = frames[0]
            if (firstFrame) {
              handleThumbnailClick(firstFrame.frameIndex)
            }
          }
          break

        case 'Escape':
          e.preventDefault()
          // Cancel selection if selecting, otherwise return to analysis view
          if (isSelecting) {
            setIsSelecting(false)
            setSelectionStart(null)
            setSelectionCurrent(null)
            setSelectionLabel(null)
          } else {
            handleThumbnailClick('analysis')
          }
          break

        case 'i':
        case 'I':
          e.preventDefault()
          // Mark hovered box as "in"
          if (hoveredBoxIndex !== null && currentFrameBoxes) {
            const box = currentFrameBoxes.boxes[hoveredBoxIndex]
            if (box) {
              void handleBoxClick(box.boxIndex, 'in')
            }
          }
          break

        case 'o':
        case 'O':
          e.preventDefault()
          // Mark hovered box as "out"
          if (hoveredBoxIndex !== null && currentFrameBoxes) {
            const box = currentFrameBoxes.boxes[hoveredBoxIndex]
            if (box) {
              void handleBoxClick(box.boxIndex, 'out')
            }
          }
          break

        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9': {
          e.preventDefault()
          // Quick jump to frame (1-based index)
          const frameNum = parseInt(e.key) - 1
          if (frameNum < frames.length) {
            const targetFrame = frames[frameNum]
            if (targetFrame) {
              handleThumbnailClick(targetFrame.frameIndex)
            }
          }
          break
        }

        case '0':
          e.preventDefault()
          // Jump to analysis view
          handleThumbnailClick('analysis')
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    viewMode,
    selectedFrameIndex,
    frames,
    hoveredBoxIndex,
    currentFrameBoxes,
    isSelecting,
    handleThumbnailClick,
    handleBoxClick,
  ])

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
                    loadQueue(true)
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
                    loadQueue(true)
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
            <div className="relative flex flex-shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-gray-900 dark:border-gray-600 dark:bg-gray-800 p-4">
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
                  <div className="relative">
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
            <div
              className="grid w-full h-0 flex-1 auto-rows-min gap-3 overflow-y-auto rounded-lg border border-gray-300 bg-gray-200 p-3 dark:border-gray-600 dark:bg-gray-700"
              style={{
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              }}
            >
              {/* Subtitle analysis thumbnail */}
              <button
                onClick={() => handleThumbnailClick('analysis')}
                className={`flex w-full flex-col overflow-hidden rounded border-2 ${
                  viewMode === 'analysis'
                    ? 'border-teal-600'
                    : 'border-gray-300 dark:border-gray-700'
                }`}
              >
                <div className="aspect-video w-full bg-black">
                  {analysisThumbnailUrl ? (
                    <img
                      src={analysisThumbnailUrl}
                      alt="Analysis view"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-gray-500">
                      Loading...
                    </div>
                  )}
                </div>
                <div className="flex h-11 flex-col items-center justify-center bg-gray-100 px-2 py-1 text-xs text-gray-900 dark:bg-gray-800 dark:text-gray-100">
                  Analysis
                </div>
              </button>

              {/* Loading indicator while frames load */}
              {loading && frames.length === 0 && (
                <div className="col-span-full flex items-center justify-center py-8 text-gray-500 dark:text-gray-400">
                  Loading frames...
                </div>
              )}

              {/* Frame thumbnails */}
              {frames.map(frame => (
                <button
                  key={frame.frameIndex}
                  onClick={() => handleThumbnailClick(frame.frameIndex)}
                  className={`flex w-full flex-col overflow-hidden rounded border-2 ${
                    viewMode === 'frame' && selectedFrameIndex === frame.frameIndex
                      ? 'border-teal-600'
                      : 'border-gray-300 dark:border-gray-700'
                  }`}
                >
                  <div className="aspect-video w-full bg-black">
                    <img
                      src={frame.imageUrl}
                      alt={`Frame ${frame.frameIndex}`}
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="flex h-11 flex-col items-center justify-center bg-gray-100 px-2 py-1 text-xs text-gray-900 dark:bg-gray-800 dark:text-gray-100">
                    Frame {frame.frameIndex}
                    <br />
                    Min conf: {frame.minConfidence?.toFixed(2) ?? 'N/A'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right: Controls (1/3 width) */}
          <div className="flex min-h-0 w-1/3 flex-col gap-4 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            {/* Mode toggle */}
            <div className="flex gap-2 rounded-md border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
              <button className="flex-1 rounded py-2 text-sm font-semibold bg-teal-600 text-white">
                Layout
              </button>
              <button
                onClick={() =>
                  navigate(`/annotate/review-labels?videoId=${encodeURIComponent(videoId)}`)
                }
                className="flex-1 rounded py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Review Labels
              </button>
            </div>

            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Layout Controls</h2>

            {/* Instructions */}
            <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-100">
              <strong>Mouse Controls:</strong>
              <ul className="mt-1 list-inside list-disc space-y-1">
                <li>Left-click box → mark as caption (in)</li>
                <li>Right-click box → mark as noise (out)</li>
                <li>Hover over box to see text</li>
              </ul>
              <strong className="mt-2 block">Keyboard Shortcuts:</strong>
              <ul className="mt-1 list-inside list-disc space-y-1">
                <li>Arrow keys → navigate frames</li>
                <li>Esc → return to analysis view</li>
                <li>I → mark hovered box as caption</li>
                <li>O → mark hovered box as noise</li>
                <li>1-9 → jump to frame 1-9</li>
                <li>0 → jump to analysis view</li>
              </ul>
            </div>

            {/* Annotation Progress Indicator */}
            {boxStats?.captionBoxes === 0 ? (
              // Alert when no caption boxes
              <div className="rounded-md border-2 border-yellow-500 bg-yellow-50 p-3 dark:border-yellow-600 dark:bg-yellow-900/20">
                <div className="flex items-center gap-2">
                  <span className="text-xl">⚠️</span>
                  <div className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
                    All Boxes Labeled as Noise
                  </div>
                </div>
                <div className="mt-2 text-xs text-yellow-700 dark:text-yellow-400">
                  {boxStats.totalBoxes} boxes total, all labeled as noise/out
                </div>
                <div className="mt-2 text-xs text-yellow-800 dark:text-yellow-300 font-medium">
                  Cannot calculate crop bounds without caption boxes.
                  <br />
                  Left-click boxes or press &apos;I&apos; while hovering to mark as captions.
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950">
                <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Crop Bounds Auto-Update
                </div>
                {annotationsSinceRecalc >= RECALC_THRESHOLD ? (
                  <>
                    <div className="mt-1 text-xs text-blue-600 dark:text-blue-400 font-semibold">
                      Calculating...
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        className="h-2 rounded-full bg-blue-500 animate-pulse"
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                      Recalculating crop bounds and predictions
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                      {annotationsSinceRecalc} / {RECALC_THRESHOLD} annotations
                      {boxStats && (
                        <span className="ml-2">({boxStats.captionBoxes} caption boxes)</span>
                      )}
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        className="h-2 rounded-full bg-blue-500 transition-all duration-300"
                        style={{
                          width: `${Math.min(100, (annotationsSinceRecalc / RECALC_THRESHOLD) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                      Crop bounds will recalculate automatically after{' '}
                      {RECALC_THRESHOLD - annotationsSinceRecalc} more annotations
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Mark Layout Complete Button */}
            <button
              onClick={async () => {
                if (
                  confirm(
                    'Mark layout annotation as complete? This will enable boundary annotation for this video and trigger frame re-cropping.'
                  )
                ) {
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

                    alert(
                      'Layout marked as complete! Frame re-cropping started in background. You can now annotate boundaries for this video.'
                    )
                  } catch (err) {
                    console.error('Error marking layout complete:', err)
                    alert('Failed to mark layout complete')
                  }
                }
              }}
              disabled={
                // If not approved yet: always enabled (allow approval)
                // If approved: only disabled when bounds haven't changed
                !!(
                  layoutApproved &&
                  layoutConfig &&
                  cropBoundsEdit &&
                  layoutConfig.cropLeft === cropBoundsEdit.left &&
                  layoutConfig.cropTop === cropBoundsEdit.top &&
                  layoutConfig.cropRight === cropBoundsEdit.right &&
                  layoutConfig.cropBottom === cropBoundsEdit.bottom
                )
              }
              className={`w-full px-4 py-2 text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                layoutApproved &&
                layoutConfig &&
                cropBoundsEdit &&
                layoutConfig.cropLeft === cropBoundsEdit.left &&
                layoutConfig.cropTop === cropBoundsEdit.top &&
                layoutConfig.cropRight === cropBoundsEdit.right &&
                layoutConfig.cropBottom === cropBoundsEdit.bottom
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500'
                  : 'text-white bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 focus:ring-green-500'
              }`}
            >
              {layoutApproved ? 'Update Layout & Re-crop' : 'Approve Layout'}
            </button>

            {/* Clear All Annotations Button */}
            <button
              onClick={async () => {
                const confirmMessage =
                  'Clear all layout annotations? This will:\n\n' +
                  '• Delete all user annotations\n' +
                  '• Reset predictions to seed model\n' +
                  '• Recalculate crop bounds\n\n' +
                  'This action cannot be undone.'

                if (confirm(confirmMessage)) {
                  try {
                    // Clear all annotations
                    const response = await fetch(
                      `/api/annotations/${encodeURIComponent(videoId)}/clear-all`,
                      {
                        method: 'POST',
                      }
                    )

                    if (!response.ok) throw new Error('Failed to clear annotations')

                    const result = await response.json()
                    console.log(`[Clear All] Deleted ${result.deletedCount} annotations`)

                    // Recalculate predictions (will reset to seed model)
                    await fetch(
                      `/api/annotations/${encodeURIComponent(videoId)}/calculate-predictions`,
                      {
                        method: 'POST',
                      }
                    )

                    // Recalculate crop bounds (may fail if no caption boxes after clear)
                    const cropBoundsResponse = await fetch(
                      `/api/annotations/${encodeURIComponent(videoId)}/reset-crop-bounds`,
                      {
                        method: 'POST',
                      }
                    )

                    if (!cropBoundsResponse.ok) {
                      const cropBoundsResult = await cropBoundsResponse.json()
                      console.warn(
                        '[Clear All] Could not recalculate crop bounds:',
                        cropBoundsResult.message
                      )
                      // This is expected if all boxes were cleared - not an error
                    }

                    // Reload everything
                    // Skip edit state update so user can see the recalculated changes
                    await loadQueue(false, true)
                    await loadAnalysisBoxes()
                    frameBoxesCache.current.clear()

                    // Reload current frame if in frame view
                    if (viewMode === 'frame' && selectedFrameIndex !== null) {
                      try {
                        const frameResponse = await fetch(
                          `/api/annotations/${encodeURIComponent(videoId)}/frames/${selectedFrameIndex}/boxes`
                        )
                        if (frameResponse.ok) {
                          const data = await frameResponse.json()
                          setCurrentFrameBoxes(data)
                          frameBoxesCache.current.set(selectedFrameIndex, data)
                        }
                      } catch (err) {
                        console.error('Failed to reload current frame:', err)
                      }
                    }

                    // Reset annotation counter
                    setAnnotationsSinceRecalc(0)

                    alert(
                      `Successfully cleared ${result.deletedCount} annotations and reset to seed model.`
                    )
                  } catch (err) {
                    console.error('Error clearing annotations:', err)
                    alert('Failed to clear annotations')
                  }
                }
              }}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              Clear All Annotations
            </button>

            {/* Current view info */}
            {viewMode === 'frame' && currentFrameBoxes && (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950">
                <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Frame {currentFrameBoxes.frameIndex}
                </div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {currentFrameBoxes.boxes.length} total boxes
                  <br />
                  {currentFrameBoxes.boxes.filter(b => b.userLabel === 'in').length} annotated as
                  caption
                  <br />
                  {currentFrameBoxes.boxes.filter(b => b.userLabel === 'out').length} annotated as
                  noise
                </div>
              </div>
            )}

            {/* Color legend */}
            <div>
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Color Legend
              </div>
              <div className="mt-2 space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <div
                    className="h-4 w-4 rounded border-2"
                    style={{
                      borderColor: '#14b8a6',
                      backgroundColor: 'rgba(20,184,166,0.25)',
                    }}
                  />
                  <span className="text-gray-700 dark:text-gray-300">Annotated: Caption</span>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="h-4 w-4 rounded border-2"
                    style={{
                      borderColor: '#dc2626',
                      backgroundColor: 'rgba(220,38,38,0.25)',
                    }}
                  />
                  <span className="text-gray-700 dark:text-gray-300">Annotated: Noise</span>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="h-4 w-4 rounded border-2"
                    style={{
                      borderColor: '#3b82f6',
                      backgroundColor: 'rgba(59,130,246,0.15)',
                    }}
                  />
                  <span className="text-gray-700 dark:text-gray-300">Predicted: Caption</span>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="h-4 w-4 rounded border-2"
                    style={{
                      borderColor: '#f97316',
                      backgroundColor: 'rgba(249,115,22,0.15)',
                    }}
                  />
                  <span className="text-gray-700 dark:text-gray-300">Predicted: Noise</span>
                </div>
              </div>
            </div>

            {/* Layout parameters (read-only for now) */}
            {layoutConfig && (
              <div>
                <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Layout Parameters
                </div>
                <div className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-400">
                  <div>
                    Vertical Position: {layoutConfig.verticalPosition ?? 'N/A'}
                    px (±{layoutConfig.verticalStd ?? 'N/A'})
                  </div>
                  <div>
                    Box Height: {layoutConfig.boxHeight ?? 'N/A'}px (±
                    {layoutConfig.boxHeightStd ?? 'N/A'})
                  </div>
                  <div>
                    Anchor: {layoutConfig.anchorType ?? 'N/A'} (
                    {layoutConfig.anchorPosition ?? 'N/A'}px)
                  </div>
                  <div>
                    Crop: [{layoutConfig.cropLeft}, {layoutConfig.cropTop}] - [
                    {layoutConfig.cropRight}, {layoutConfig.cropBottom}]
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
