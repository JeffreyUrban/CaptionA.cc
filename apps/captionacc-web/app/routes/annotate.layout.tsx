import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'
import { AppLayout } from '~/components/AppLayout'

interface FrameInfo {
  frameIndex: number
  totalBoxCount: number
  captionBoxCount: number
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
  selectionMode: 'hard' | 'soft' | 'disabled'
  verticalPosition: number | null
  verticalStd: number | null
  boxHeight: number | null
  boxHeightStd: number | null
  anchorType: 'left' | 'center' | 'right' | null
  anchorPosition: number | null
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
export async function loader({ }: LoaderFunctionArgs) {
  return {
    defaultVideoId: process.env.DEFAULT_VIDEO_ID || ''
  }
}

export default function AnnotateLayout() {
  const [searchParams] = useSearchParams()
  const videoId = searchParams.get('videoId') || ''

  // Core state
  const [frames, setFrames] = useState<FrameInfo[]>([])
  const [layoutConfig, setLayoutConfig] = useState<LayoutConfig | null>(null)
  const [subtitleAnalysisUrl, setSubtitleAnalysisUrl] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('analysis')
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null)
  const [currentFrameBoxes, setCurrentFrameBoxes] = useState<FrameBoxesData | null>(null)
  const [loadingFrame, setLoadingFrame] = useState(false)

  // Canvas state
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [hoveredBoxIndex, setHoveredBoxIndex] = useState<number | null>(null)

  // Layout controls state (local modifications before save)
  const [cropBoundsEdit, setCropBoundsEdit] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null)
  const [selectionRectEdit, setSelectionRectEdit] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null)
  const [selectionMode, setSelectionMode] = useState<'hard' | 'soft' | 'disabled'>('hard')
  const [layoutParamsEdit, setLayoutParamsEdit] = useState<any>(null)

  // Mark video as being worked on
  useEffect(() => {
    if (videoId && typeof window !== 'undefined') {
      const touchedVideos = new Set(
        JSON.parse(localStorage.getItem('touched-videos') || '[]')
      )
      touchedVideos.add(videoId)
      localStorage.setItem('touched-videos', JSON.stringify(Array.from(touchedVideos)))
    }
  }, [videoId])

  // Load layout queue (top frames + config)
  useEffect(() => {
    if (!videoId) return

    const loadQueue = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/layout-queue`
        )
        if (!response.ok) throw new Error('Failed to load layout queue')
        const data = await response.json()

        setFrames(data.frames || [])
        setLayoutConfig(data.layoutConfig || null)
        setSubtitleAnalysisUrl(data.subtitleAnalysisUrl || '')

        // Initialize edit state from config
        if (data.layoutConfig) {
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
          setSelectionMode(data.layoutConfig.selectionMode || 'hard')
          setLayoutParamsEdit({
            verticalPosition: data.layoutConfig.verticalPosition,
            verticalStd: data.layoutConfig.verticalStd,
            boxHeight: data.layoutConfig.boxHeight,
            boxHeightStd: data.layoutConfig.boxHeightStd,
            anchorType: data.layoutConfig.anchorType,
            anchorPosition: data.layoutConfig.anchorPosition,
          })
        }

        setLoading(false)
      } catch (err) {
        console.error('Failed to load layout queue:', err)
        setError((err as Error).message)
        setLoading(false)
      }
    }

    loadQueue()
  }, [videoId])

  // Load frame boxes when frame selected
  useEffect(() => {
    if (!videoId || viewMode !== 'frame' || selectedFrameIndex === null) return

    const loadFrameBoxes = async () => {
      setLoadingFrame(true)
      try {
        const response = await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/frames/${selectedFrameIndex}/boxes`
        )
        if (!response.ok) throw new Error('Failed to load frame boxes')
        const data = await response.json()

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
  const handleThumbnailClick = useCallback((frameIndex: number | 'analysis') => {
    if (frameIndex === 'analysis') {
      setViewMode('analysis')
      setSelectedFrameIndex(null)
    } else {
      setViewMode('frame')
      setSelectedFrameIndex(frameIndex)
    }
  }, [])

  // Handle box annotation (left click = in, right click = out)
  const handleBoxClick = useCallback(async (boxIndex: number, label: 'in' | 'out') => {
    if (!videoId || !currentFrameBoxes) return

    try {
      // Update local state optimistically
      setCurrentFrameBoxes(prev => {
        if (!prev) return prev
        return {
          ...prev,
          boxes: prev.boxes.map(box =>
            box.boxIndex === boxIndex
              ? { ...box, userLabel: label, colorCode: label === 'in' ? 'annotated_in' : 'annotated_out' }
              : box
          )
        }
      })

      // Save to server
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(videoId)}/frames/${currentFrameBoxes.frameIndex}/boxes`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            annotations: [{ boxIndex, label }]
          })
        }
      )

      if (!response.ok) {
        throw new Error('Failed to save annotation')
      }

      console.log(`Annotated box ${boxIndex} as ${label}`)
    } catch (err) {
      console.error('Failed to save box annotation:', err)
      // Reload frame to revert optimistic update
      setSelectedFrameIndex(prev => prev)
    }
  }, [videoId, currentFrameBoxes])

  // Handle canvas resize
  useEffect(() => {
    const updateCanvasSize = () => {
      if (canvasRef.current) {
        const container = canvasRef.current.parentElement
        if (container) {
          // Account for padding (p-4 = 1rem = 16px on each side)
          const padding = 32 // 16px * 2
          setCanvasSize({
            width: container.clientWidth - padding,
            height: 600 // Match the explicit canvas height
          })
        }
      }
    }

    updateCanvasSize()
    window.addEventListener('resize', updateCanvasSize)
    return () => window.removeEventListener('resize', updateCanvasSize)
  }, [])

  // Update canvas size when switching to frame view
  useEffect(() => {
    if (viewMode === 'frame' && canvasRef.current) {
      const container = canvasRef.current.parentElement
      if (container) {
        const padding = 32
        setCanvasSize({
          width: container.clientWidth - padding,
          height: 600
        })
      }
    }
  }, [viewMode, currentFrameBoxes])

  // Draw canvas (boxes on frame)
  useEffect(() => {
    if (!canvasRef.current || viewMode !== 'frame' || !currentFrameBoxes) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    console.log('Drawing canvas:', {
      canvasSize,
      frameWidth: currentFrameBoxes.frameWidth,
      frameHeight: currentFrameBoxes.frameHeight,
      imageUrl: currentFrameBoxes.imageUrl
    })

    // Set canvas dimensions
    canvas.width = canvasSize.width
    canvas.height = canvasSize.height

    // Load and draw frame image
    const img = new Image()
    img.src = currentFrameBoxes.imageUrl
    img.onerror = (e) => {
      console.error('Failed to load frame image:', currentFrameBoxes.imageUrl, e)
    }
    img.onload = () => {
      console.log('Image loaded:', img.width, 'x', img.height)

      // Calculate scaling to fit full frame on canvas
      const scale = Math.min(
        canvasSize.width / currentFrameBoxes.frameWidth,
        canvasSize.height / currentFrameBoxes.frameHeight
      )
      const scaledWidth = currentFrameBoxes.frameWidth * scale
      const scaledHeight = currentFrameBoxes.frameHeight * scale
      const offsetX = (canvasSize.width - scaledWidth) / 2
      const offsetY = (canvasSize.height - scaledHeight) / 2

      console.log('Drawing full frame:', {
        scale,
        scaledWidth,
        scaledHeight,
        offsetX,
        offsetY
      })

      // Clear and draw full frame image
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight)

      // Draw boxes using original bounds
      currentFrameBoxes.boxes.forEach((box, index) => {
        // Convert original pixel bounds to canvas coordinates
        const boxX = offsetX + (box.originalBounds.left / currentFrameBoxes.frameWidth) * scaledWidth
        const boxY = offsetY + (box.originalBounds.top / currentFrameBoxes.frameHeight) * scaledHeight
        const boxWidth = ((box.originalBounds.right - box.originalBounds.left) / currentFrameBoxes.frameWidth) * scaledWidth
        const boxHeight = ((box.originalBounds.bottom - box.originalBounds.top) / currentFrameBoxes.frameHeight) * scaledHeight

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
          ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
          ctx.fillRect(boxX, boxY - 20, boxWidth, 20)
          ctx.fillStyle = '#ffffff'
          ctx.font = '12px monospace'
          ctx.fillText(box.text, boxX + 4, boxY - 6)
        }
      })
    }
  }, [canvasRef, canvasSize, viewMode, currentFrameBoxes, hoveredBoxIndex])

  // Get box colors based on color code
  const getBoxColors = (colorCode: string): { border: string; background: string } => {
    const colorMap: Record<string, { border: string; background: string }> = {
      annotated_in: { border: '#14b8a6', background: 'rgba(20,184,166,0.25)' },
      annotated_out: { border: '#dc2626', background: 'rgba(220,38,38,0.25)' },
      predicted_in_high: { border: '#10b981', background: 'rgba(16,185,129,0.15)' },
      predicted_in_medium: { border: '#34d399', background: 'rgba(52,211,153,0.1)' },
      predicted_in_low: { border: '#6ee7b7', background: 'rgba(110,231,183,0.08)' },
      predicted_out_high: { border: '#ef4444', background: 'rgba(239,68,68,0.15)' },
      predicted_out_medium: { border: '#f87171', background: 'rgba(248,113,113,0.1)' },
      predicted_out_low: { border: '#fca5a5', background: 'rgba(252,165,165,0.08)' },
      predicted_uncertain: { border: '#f59e0b', background: 'rgba(245,158,11,0.1)' },
    }
    return colorMap[colorCode] || { border: '#9ca3af', background: 'rgba(156,163,175,0.1)' }
  }

  // Handle canvas mouse events for box interaction
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!currentFrameBoxes || !canvasRef.current) return

    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Calculate scaling
    const scale = Math.min(
      canvasSize.width / currentFrameBoxes.frameWidth,
      canvasSize.height / currentFrameBoxes.frameHeight
    )
    const scaledWidth = currentFrameBoxes.frameWidth * scale
    const scaledHeight = currentFrameBoxes.frameHeight * scale
    const offsetX = (canvasSize.width - scaledWidth) / 2
    const offsetY = (canvasSize.height - scaledHeight) / 2

    // Find clicked box using original bounds
    for (let i = currentFrameBoxes.boxes.length - 1; i >= 0; i--) {
      const box = currentFrameBoxes.boxes[i]
      const boxX = offsetX + (box.originalBounds.left / currentFrameBoxes.frameWidth) * scaledWidth
      const boxY = offsetY + (box.originalBounds.top / currentFrameBoxes.frameHeight) * scaledHeight
      const boxWidth = ((box.originalBounds.right - box.originalBounds.left) / currentFrameBoxes.frameWidth) * scaledWidth
      const boxHeight = ((box.originalBounds.bottom - box.originalBounds.top) / currentFrameBoxes.frameHeight) * scaledHeight

      if (x >= boxX && x <= boxX + boxWidth && y >= boxY && y <= boxY + boxHeight) {
        // Left click = in, Right click = out
        const label = e.button === 0 ? 'in' : 'out'
        handleBoxClick(box.boxIndex, label)
        return
      }
    }
  }, [currentFrameBoxes, canvasSize, handleBoxClick])

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    handleCanvasClick(e)
  }, [handleCanvasClick])

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!currentFrameBoxes || !canvasRef.current) return

    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Calculate scaling
    const scale = Math.min(
      canvasSize.width / currentFrameBoxes.frameWidth,
      canvasSize.height / currentFrameBoxes.frameHeight
    )
    const scaledWidth = currentFrameBoxes.frameWidth * scale
    const scaledHeight = currentFrameBoxes.frameHeight * scale
    const offsetX = (canvasSize.width - scaledWidth) / 2
    const offsetY = (canvasSize.height - scaledHeight) / 2

    // Find hovered box using original bounds
    let foundIndex: number | null = null
    for (let i = currentFrameBoxes.boxes.length - 1; i >= 0; i--) {
      const box = currentFrameBoxes.boxes[i]
      const boxX = offsetX + (box.originalBounds.left / currentFrameBoxes.frameWidth) * scaledWidth
      const boxY = offsetY + (box.originalBounds.top / currentFrameBoxes.frameHeight) * scaledHeight
      const boxWidth = ((box.originalBounds.right - box.originalBounds.left) / currentFrameBoxes.frameWidth) * scaledWidth
      const boxHeight = ((box.originalBounds.bottom - box.originalBounds.top) / currentFrameBoxes.frameHeight) * scaledHeight

      if (x >= boxX && x <= boxX + boxWidth && y >= boxY && y <= boxY + boxHeight) {
        foundIndex = i
        break
      }
    }

    setHoveredBoxIndex(foundIndex)
  }, [currentFrameBoxes, canvasSize])

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
              handleThumbnailClick(frames[currentIndex - 1].frameIndex)
            }
          }
          break

        case 'ArrowRight':
          e.preventDefault()
          // Next frame
          if (viewMode === 'frame' && selectedFrameIndex !== null) {
            const currentIndex = frames.findIndex(f => f.frameIndex === selectedFrameIndex)
            if (currentIndex < frames.length - 1) {
              handleThumbnailClick(frames[currentIndex + 1].frameIndex)
            }
          } else if (viewMode === 'analysis' && frames.length > 0) {
            handleThumbnailClick(frames[0].frameIndex)
          }
          break

        case 'Escape':
          e.preventDefault()
          // Return to analysis view
          handleThumbnailClick('analysis')
          break

        case 'i':
        case 'I':
          e.preventDefault()
          // Mark hovered box as "in"
          if (hoveredBoxIndex !== null && currentFrameBoxes) {
            const box = currentFrameBoxes.boxes[hoveredBoxIndex]
            if (box) {
              handleBoxClick(box.boxIndex, 'in')
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
              handleBoxClick(box.boxIndex, 'out')
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
        case '9':
          e.preventDefault()
          // Quick jump to frame (1-based index)
          const frameNum = parseInt(e.key) - 1
          if (frameNum < frames.length) {
            handleThumbnailClick(frames[frameNum].frameIndex)
          }
          break

        case '0':
          e.preventDefault()
          // Jump to analysis view
          handleThumbnailClick('analysis')
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewMode, selectedFrameIndex, frames, hoveredBoxIndex, currentFrameBoxes, handleThumbnailClick, handleBoxClick])

  if (loading) {
    return (
      <AppLayout>
        <div className="flex h-screen items-center justify-center">
          <div className="text-lg text-gray-500 dark:text-gray-400">
            Loading layout annotation data...
          </div>
        </div>
      </AppLayout>
    )
  }

  if (error) {
    return (
      <AppLayout>
        <div className="flex h-screen items-center justify-center">
          <div className="text-lg text-red-500">Error: {error}</div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="flex h-screen flex-col gap-4 p-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Caption Layout Annotation
            </h1>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Video: {videoId}
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-1 gap-4 overflow-auto">
          {/* Left: Canvas (2/3 width) */}
          <div className="flex w-2/3 flex-col gap-4">
            {/* Main canvas */}
            <div className="relative rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950 p-4">
              {viewMode === 'analysis' && subtitleAnalysisUrl ? (
                <img
                  src={subtitleAnalysisUrl}
                  alt="Subtitle Analysis"
                  className="max-h-full max-w-full object-contain"
                />
              ) : viewMode === 'frame' && currentFrameBoxes ? (
                <img
                  src={currentFrameBoxes.imageUrl}
                  alt={`Frame ${currentFrameBoxes.frameIndex}`}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="flex min-h-[400px] items-center justify-center text-gray-500 dark:text-gray-400">
                  {loadingFrame ? 'Loading frame...' : 'Select a frame to annotate'}
                </div>
              )}
            </div>

            {/* Thumbnail panel */}
            <div
              className="w-full rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}
            >
              {/* Subtitle analysis thumbnail */}
              <button
                onClick={() => handleThumbnailClick('analysis')}
                className={`w-full overflow-hidden rounded border-2 ${
                  viewMode === 'analysis'
                    ? 'border-teal-600'
                    : 'border-gray-300 dark:border-gray-700'
                }`}
              >
                <img
                  src={subtitleAnalysisUrl}
                  alt="Analysis"
                  className="h-20 w-full object-cover"
                />
                <div className="bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800">
                  Analysis
                </div>
              </button>

              {/* Frame thumbnails */}
              {frames.map(frame => (
                <button
                  key={frame.frameIndex}
                  onClick={() => handleThumbnailClick(frame.frameIndex)}
                  className={`w-full overflow-hidden rounded border-2 ${
                    selectedFrameIndex === frame.frameIndex
                      ? 'border-teal-600'
                      : 'border-gray-300 dark:border-gray-700'
                  }`}
                >
                  <img
                    src={frame.imageUrl}
                    alt={`Frame ${frame.frameIndex}`}
                    className="h-20 w-full object-cover"
                  />
                  <div className="bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800">
                    Frame {frame.frameIndex}
                    <br />
                    {frame.captionBoxCount}/{frame.totalBoxCount} boxes
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right: Controls (1/3 width) */}
          <div className="flex w-1/3 flex-col gap-4 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Layout Controls
            </h2>

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
                  {currentFrameBoxes.boxes.filter(b => b.userLabel === 'in').length} annotated as caption
                  <br />
                  {currentFrameBoxes.boxes.filter(b => b.userLabel === 'out').length} annotated as noise
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
                  <div className="h-4 w-4 rounded border-2" style={{ borderColor: '#14b8a6', backgroundColor: 'rgba(20,184,166,0.25)' }} />
                  <span className="text-gray-700 dark:text-gray-300">Annotated: Caption</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded border-2" style={{ borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.25)' }} />
                  <span className="text-gray-700 dark:text-gray-300">Annotated: Noise</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded border-2" style={{ borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.15)' }} />
                  <span className="text-gray-700 dark:text-gray-300">Predicted: Caption (high conf)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded border-2" style={{ borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.15)' }} />
                  <span className="text-gray-700 dark:text-gray-300">Predicted: Noise (high conf)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded border-2" style={{ borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)' }} />
                  <span className="text-gray-700 dark:text-gray-300">Uncertain</span>
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
                  <div>Vertical Position: {layoutConfig.verticalPosition ?? 'N/A'}px (±{layoutConfig.verticalStd ?? 'N/A'})</div>
                  <div>Box Height: {layoutConfig.boxHeight ?? 'N/A'}px (±{layoutConfig.boxHeightStd ?? 'N/A'})</div>
                  <div>Anchor: {layoutConfig.anchorType ?? 'N/A'} ({layoutConfig.anchorPosition ?? 'N/A'}px)</div>
                  <div>Crop: [{layoutConfig.cropLeft}, {layoutConfig.cropTop}] - [{layoutConfig.cropRight}, {layoutConfig.cropBottom}]</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
