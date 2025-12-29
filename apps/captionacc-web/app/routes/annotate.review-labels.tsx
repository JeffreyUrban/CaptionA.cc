import { useState, useEffect, useCallback, useRef } from 'react'
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

interface PotentialMislabel {
  frameIndex: number
  boxIndex: number
  boxText: string
  userLabel: 'in' | 'out'
  predictedLabel: 'in' | 'out' | null
  predictedConfidence: number | null
  boxTop: number
  topDeviation: number
  issueType: string
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

export default function ReviewLabels() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const videoId = searchParams.get('videoId') || ''

  // Core state
  const [mislabels, setMislabels] = useState<PotentialMislabel[]>([])
  const [frames, setFrames] = useState<FrameInfo[]>([])
  const [layoutConfig, setLayoutConfig] = useState<LayoutConfig | null>(null)
  const [clusterStats, setClusterStats] = useState<{ avgTop: number; avgBottom: number } | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('frame')
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null)
  const [currentFrameBoxes, setCurrentFrameBoxes] = useState<FrameBoxesData | null>(null)
  const [loadingFrame, setLoadingFrame] = useState(false)
  const [hasUnsyncedAnnotations, setHasUnsyncedAnnotations] = useState(false)

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
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [hoveredBoxIndex, setHoveredBoxIndex] = useState<number | null>(null)

  // Selection rectangle state (click-to-start, click-to-end)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null)
  const [selectionCurrent, setSelectionCurrent] = useState<{ x: number; y: number } | null>(null)
  const [selectionLabel, setSelectionLabel] = useState<'in' | 'out' | 'clear' | null>(null) // Based on which button started selection

  // Mark video as being worked on
  useEffect(() => {
    if (videoId && typeof window !== 'undefined') {
      const touchedVideos = new Set(JSON.parse(localStorage.getItem('touched-videos') || '[]'))
      touchedVideos.add(videoId)
      localStorage.setItem('touched-videos', JSON.stringify(Array.from(touchedVideos)))
    }
  }, [videoId])

  // Load mislabel data
  const loadMislabels = useCallback(
    async (showLoading = true) => {
      if (!videoId) return

      console.log(`[Frontend] loadMislabels called (showLoading=${showLoading})`)

      if (showLoading) {
        setError(null)
      }

      try {
        const response = await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/review-labels`
        )

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to load mislabels')
        }

        const data = await response.json()

        console.log(
          `[Frontend] Received ${data.potentialMislabels?.length || 0} potential mislabels`
        )

        setMislabels(data.potentialMislabels || [])
        setClusterStats(data.clusterStats || null)

        // Get unique frame indices from mislabels
        const frameIndices = (
          Array.from(
            new Set((data.potentialMislabels || []).map((m: PotentialMislabel) => m.frameIndex))
          ) as number[]
        ).sort((a: number, b: number) => a - b)

        // Create frame info for each unique frame
        const frameInfos: FrameInfo[] = frameIndices.map((frameIndex: number) => ({
          frameIndex,
          totalBoxCount: (data.potentialMislabels || []).filter(
            (m: PotentialMislabel) => m.frameIndex === frameIndex
          ).length,
          captionBoxCount: (data.potentialMislabels || []).filter(
            (m: PotentialMislabel) => m.frameIndex === frameIndex && m.userLabel === 'in'
          ).length,
          minConfidence: 0,
          hasAnnotations: true,
          imageUrl: `/api/full-frames/${encodeURIComponent(videoId)}/${frameIndex}.jpg`,
        }))

        setFrames(frameInfos)

        if (showLoading) {
          setLoading(false)
        }
      } catch (err) {
        console.error('Failed to load mislabels:', err)
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

  // Load mislabels on mount
  useEffect(() => {
    if (!videoId) return

    console.log('[Priority] Loading mislabels...')
    void loadMislabels(true)
  }, [videoId, loadMislabels])

  // Auto-poll when processing is in progress
  useEffect(() => {
    if (!error?.startsWith('Processing:')) return

    console.log('[Polling] Setting up auto-poll for processing status...')

    const pollInterval = setInterval(() => {
      console.log('[Polling] Checking processing status...')
      setError(null)
      loadMislabels(true)
    }, 3000) // Poll every 3 seconds

    return () => {
      console.log('[Polling] Cleaning up poll interval')
      clearInterval(pollInterval)
    }
  }, [error, loadMislabels])

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

      // Reload mislabels only when navigating away AND annotations were made (background refresh to update list)
      if (isChangingView && hasUnsyncedAnnotations) {
        console.log(
          `[Frontend] Navigating to different frame/view with unsynced annotations, reloading mislabels in background`
        )
        void loadMislabels(false)
        setHasUnsyncedAnnotations(false)
      }
    },
    [frames, viewMode, selectedFrameIndex, hasUnsyncedAnnotations, loadMislabels]
  )

  // Handle box annotation (left click = in, right click = out)
  const handleBoxClick = useCallback(
    async (boxIndex: number, label: 'in' | 'out') => {
      if (!videoId || !currentFrameBoxes) return

      try {
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
      } catch (err) {
        console.error('Failed to save box annotation:', err)
        // Reload frame to revert optimistic update
        setSelectedFrameIndex(prev => prev)
      }
    },
    [videoId, currentFrameBoxes]
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

      // Draw crop bounds overlay (yellow dashed)
      const cropLeft =
        (currentFrameBoxes.cropBounds.left / currentFrameBoxes.frameWidth) * canvas.width
      const cropTop =
        (currentFrameBoxes.cropBounds.top / currentFrameBoxes.frameHeight) * canvas.height
      const cropRight =
        (currentFrameBoxes.cropBounds.right / currentFrameBoxes.frameWidth) * canvas.width
      const cropBottom =
        (currentFrameBoxes.cropBounds.bottom / currentFrameBoxes.frameHeight) * canvas.height

      ctx.strokeStyle = '#facc15' // Yellow
      ctx.lineWidth = 2
      ctx.setLineDash([8, 4])
      ctx.strokeRect(cropLeft, cropTop, cropRight - cropLeft, cropBottom - cropTop)
      ctx.setLineDash([])
    }

    // Draw selection rectangle (click-to-start, click-to-end)
    if (isSelecting && selectionStart && selectionCurrent && selectionLabel) {
      const selLeft = Math.min(selectionStart.x, selectionCurrent.x)
      const selTop = Math.min(selectionStart.y, selectionCurrent.y)
      const selWidth = Math.abs(selectionCurrent.x - selectionStart.x)
      const selHeight = Math.abs(selectionCurrent.y - selectionStart.y)

      // Frame mode: left=in (green), right=out (red)
      const selColor = selectionLabel === 'in' ? '#10b981' : '#ef4444'
      const selBgColor = selectionLabel === 'in' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'

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
    hoveredBoxIndex,
    isSelecting,
    selectionStart,
    selectionCurrent,
    selectionLabel,
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
    if (
      !isSelecting ||
      !selectionStart ||
      !selectionCurrent ||
      !selectionLabel ||
      !currentFrameBoxes
    )
      return

    // Calculate selection rectangle in canvas coordinates
    const selRectCanvas = {
      left: Math.min(selectionStart.x, selectionCurrent.x),
      top: Math.min(selectionStart.y, selectionCurrent.y),
      right: Math.max(selectionStart.x, selectionCurrent.x),
      bottom: Math.max(selectionStart.y, selectionCurrent.y),
    }

    if (viewMode === 'frame') {
      // Frame mode: Use individual box annotation API
      const scale = canvasSize.width / currentFrameBoxes.frameWidth

      // Find all boxes fully enclosed by selection rectangle
      const enclosedBoxes: number[] = []
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
        } catch (err) {
          console.error('Failed to save annotations:', err)
        }
      }
    }

    // Reset selection state
    setIsSelecting(false)
    setSelectionStart(null)
    setSelectionCurrent(null)
    setSelectionLabel(null)
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
  ])

  // Handle canvas click - individual box annotation, or start/complete selection
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || canvasSize.width === 0) return

      // Only handle left and right button
      if (e.button !== 0 && e.button !== 2) return

      // Prevent context menu on right click
      if (e.button === 2) {
        e.preventDefault()
        e.stopPropagation()
      }

      const canvas = canvasRef.current
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      if (isSelecting) {
        // Already selecting - second click completes selection
        void completeSelection()
        return
      }

      // Frame mode only
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
    [currentFrameBoxes, canvasSize, isSelecting, completeSelection, handleBoxClick, viewMode]
  )

  // Handle mouse move - update selection rectangle or detect hover
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || canvasSize.width === 0) return

      const canvas = canvasRef.current
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

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
    [currentFrameBoxes, canvasSize, isSelecting, viewMode]
  )

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
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
                    loadMislabels(true)
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
                  Error Loading Mislabels
                </h2>
                <p className="mb-6 text-center text-gray-600 dark:text-gray-400">{error}</p>
                <button
                  onClick={() => {
                    setError(null)
                    setLoading(true)
                    loadMislabels(true)
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
              Review Potential Mislabels
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
              {currentFrameBoxes ? (
                <div className="relative inline-block max-w-full max-h-full">
                  <img
                    ref={imageRef}
                    src={currentFrameBoxes.imageUrl}
                    alt={`Frame ${currentFrameBoxes.frameIndex}`}
                    className="max-w-full max-h-full object-contain"
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute left-0 top-0 cursor-crosshair"
                    style={{ touchAction: 'none' }}
                    onMouseDown={handleCanvasClick}
                    onMouseMove={handleCanvasMouseMove}
                    onContextMenu={handleCanvasContextMenu}
                  />
                </div>
              ) : (
                <div className="flex min-h-[400px] items-center justify-center text-gray-500 dark:text-gray-400">
                  {loadingFrame ? 'Loading frame...' : 'Select a frame to review'}
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
              <button
                onClick={() => navigate(`/annotate/layout?videoId=${encodeURIComponent(videoId)}`)}
                className="flex-1 rounded py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Layout
              </button>
              <button className="flex-1 rounded py-2 text-sm font-semibold bg-teal-600 text-white">
                Review Labels
              </button>
            </div>

            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Mislabel Review</h2>

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
