import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'

import { AppLayout } from '~/components/AppLayout'

interface TextQueueAnnotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  boundary_state: 'predicted' | 'confirmed' | 'gap'
  text: string | null
  text_pending: number
  text_status: string | null
  created_at: string
}

interface Annotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  boundary_state: 'predicted' | 'confirmed' | 'gap'
  boundary_pending: number
  boundary_updated_at: string
  text: string | null
  text_pending: number
  text_status: string | null
  text_notes: string | null
  text_ocr_combined: string | null
  text_updated_at: string | null
  created_at: string
}

interface AnnotationData {
  annotation: Annotation
  combinedImageUrl: string
}

// Loader function to expose environment variables
export async function loader() {
  return {
    defaultVideoId: process.env['DEFAULT_VIDEO_ID'] || '',
  }
}

export default function AnnotateText() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const videoId = searchParams.get('videoId') || ''

  const [queue, setQueue] = useState<TextQueueAnnotation[]>([])
  const [queueIndex, setQueueIndex] = useState(0)
  const [currentAnnotation, setCurrentAnnotation] = useState<AnnotationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalFrames, setTotalFrames] = useState(0)
  const [workflowProgress, setWorkflowProgress] = useState(0)
  const [completedAnnotations, setCompletedAnnotations] = useState(0)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [jumpToAnnotationInput, setJumpToAnnotationInput] = useState('')

  // Form state
  const [text, setText] = useState('')
  const [textStatus, setTextStatus] = useState<string>('valid_caption')
  const [textNotes, setTextNotes] = useState('')

  // Frame navigation state
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0)
  const [perFrameOCR, setPerFrameOCR] = useState<Array<{ frameIndex: number; ocrText: string }>>([])
  const [loadingFrames, setLoadingFrames] = useState(false)

  // Text size preference (as percentage of image width)
  const [textSizePercent, setTextSizePercent] = useState<number>(3.0)
  const [actualTextSize, setActualTextSize] = useState<number>(16)

  // Padding scale (multiplier for horizontal padding relative to text size)
  const [paddingScale, setPaddingScale] = useState<number>(0.75)

  // Text anchor mode (left/center/right)
  const [textAnchor, setTextAnchor] = useState<'left' | 'center' | 'right'>('left')

  // Collapsible section state
  const [textControlsExpanded, setTextControlsExpanded] = useState(false)

  // Use effect to track image width and update text size
  const imageContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return

      const updateTextSize = () => {
        const width = node.offsetWidth
        setActualTextSize(width * (textSizePercent / 100))
      }

      updateTextSize()

      const resizeObserver = new ResizeObserver(updateTextSize)
      resizeObserver.observe(node)

      return () => resizeObserver.disconnect()
    },
    [textSizePercent]
  )

  // Drag state for frame navigation
  const [isDragging, setIsDragging] = useState(false)
  const [dragStartY, setDragStartY] = useState(0)
  const [dragStartFrame, setDragStartFrame] = useState(0)

  // Mark this video as being worked on for stats refresh
  useEffect(() => {
    if (videoId && typeof window !== 'undefined') {
      const touchedVideos = new Set(JSON.parse(localStorage.getItem('touched-videos') || '[]'))
      touchedVideos.add(videoId)
      localStorage.setItem('touched-videos', JSON.stringify(Array.from(touchedVideos)))
    }
  }, [videoId])

  // Load preferences (text size and padding)
  useEffect(() => {
    if (!videoId) return

    const loadPreferences = async () => {
      try {
        const response = await fetch(`/api/preferences/${encodeURIComponent(videoId)}`)
        const data = await response.json()

        if (data.text_size) {
          const percent =
            typeof data.text_size === 'number' ? data.text_size : parseFloat(data.text_size) || 3.0
          setTextSizePercent(percent)
        }

        if (data.padding_scale !== undefined) {
          const scale =
            typeof data.padding_scale === 'number'
              ? data.padding_scale
              : parseFloat(data.padding_scale) || 0.75
          setPaddingScale(scale)
        }

        if (data.text_anchor) {
          setTextAnchor(data.text_anchor as 'left' | 'center' | 'right')
        }
      } catch (error) {
        console.error('Failed to load preferences:', error)
      }
    }

    loadPreferences()
  }, [videoId])

  // Load video metadata and progress
  useEffect(() => {
    if (!videoId) return

    const loadMetadata = async () => {
      try {
        const encodedVideoId = encodeURIComponent(videoId)

        // Load video metadata
        const metadataResponse = await fetch(`/api/videos/${encodedVideoId}/metadata`)
        const metadataData = await metadataResponse.json()
        setTotalFrames(metadataData.totalFrames)

        // Load text workflow progress (we'll need a new endpoint for this)
        // For now, calculate from queue
        const queueResponse = await fetch(`/api/annotations/${encodedVideoId}/text-queue`)
        const queueData = await queueResponse.json()
        setQueue(queueData.annotations)

        // Calculate progress based on annotations with text vs total annotations
        // This is a simplified calculation - you might want a dedicated endpoint
        const totalAnnotations = queueData.total || queueData.annotations.length
        const completedCount = totalAnnotations - queueData.annotations.length
        setCompletedAnnotations(completedCount)
        setWorkflowProgress(totalAnnotations > 0 ? (completedCount / totalAnnotations) * 100 : 0)

        setLoading(false)
      } catch (err) {
        console.error('Failed to load metadata:', err)
        setError((err as Error).message)
        setLoading(false)
      }
    }

    loadMetadata()
  }, [videoId])

  // Load current annotation
  useEffect(() => {
    if (!videoId || queue.length === 0 || queueIndex >= queue.length) return

    const loadAnnotation = async () => {
      const currentItem = queue[queueIndex]
      if (!currentItem) return
      const annotationId = currentItem.id
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/${annotationId}/text`
        )
        if (!response.ok) throw new Error('Failed to load annotation')
        const data = await response.json()

        setCurrentAnnotation(data)
        setText(data.annotation.text || data.annotation.text_ocr_combined || '')
        setTextStatus(data.annotation.text_status || 'valid_caption')
        setTextNotes(data.annotation.text_notes || '')

        // Set initial frame to start of annotation
        setCurrentFrameIndex(data.annotation.start_frame_index)

        setLoading(false)
      } catch (err) {
        setError((err as Error).message)
        setLoading(false)
      }
    }

    loadAnnotation()
  }, [videoId, queue, queueIndex])

  // Load per-frame OCR data when annotation changes
  useEffect(() => {
    if (!videoId || !currentAnnotation) return

    const loadFrameOCR = async () => {
      setLoadingFrames(true)
      try {
        const response = await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/${currentAnnotation.annotation.id}/frames`
        )
        if (!response.ok) throw new Error('Failed to load frame OCR')
        const data = await response.json()

        setPerFrameOCR(data.frames || [])
        setLoadingFrames(false)
      } catch (err) {
        console.error('Failed to load frame OCR:', err)
        setPerFrameOCR([])
        setLoadingFrames(false)
      }
    }

    loadFrameOCR()
  }, [videoId, currentAnnotation])

  // Update progress from server
  const updateProgress = useCallback(async () => {
    if (!videoId) return

    try {
      const encodedVideoId = encodeURIComponent(videoId)
      const queueResponse = await fetch(`/api/annotations/${encodedVideoId}/text-queue`)
      const queueData = await queueResponse.json()

      const totalAnnotations = queueData.total || queueData.annotations.length
      const completedCount = totalAnnotations - queueData.annotations.length
      setCompletedAnnotations(completedCount)
      setWorkflowProgress(totalAnnotations > 0 ? (completedCount / totalAnnotations) * 100 : 0)
    } catch (err) {
      console.error('Failed to update progress:', err)
    }
  }, [videoId])

  // Save annotation with text
  const handleSave = async () => {
    if (!videoId || !currentAnnotation) return

    // Validation: prevent saving if text is empty (use Save Empty Caption instead)
    if (text.trim() === '') {
      setError(
        'Caption text is empty. Use "Save Empty Caption" button to confirm no caption, or enter caption text.'
      )
      return
    }

    try {
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(videoId)}/${currentAnnotation.annotation.id}/text`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            text_status: textStatus,
            text_notes: textNotes,
          }),
        }
      )

      if (!response.ok) throw new Error('Failed to save annotation')

      // Clear any errors
      setError(null)

      // Update progress
      await updateProgress()

      // Move to next annotation
      if (queueIndex < queue.length - 1) {
        setQueueIndex(queueIndex + 1)
      } else {
        // Reload queue to check for new annotations
        const queueResponse = await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/text-queue`
        )
        const queueData = await queueResponse.json()
        setQueue(queueData.annotations)
        setQueueIndex(0)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // Save annotation with empty caption
  const handleSaveEmptyCaption = async () => {
    if (!videoId || !currentAnnotation) return

    try {
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(videoId)}/${currentAnnotation.annotation.id}/text`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: '', // Empty string
            text_status: textStatus,
            text_notes: textNotes,
          }),
        }
      )

      if (!response.ok) throw new Error('Failed to save annotation')

      // Clear any errors
      setError(null)

      // Update progress
      await updateProgress()

      // Move to next annotation
      if (queueIndex < queue.length - 1) {
        setQueueIndex(queueIndex + 1)
      } else {
        // Reload queue to check for new annotations
        const queueResponse = await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/text-queue`
        )
        const queueData = await queueResponse.json()
        setQueue(queueData.annotations)
        setQueueIndex(0)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // Skip to next annotation without saving
  const handleSkip = () => {
    if (queueIndex < queue.length - 1) {
      setQueueIndex(queueIndex + 1)
    }
  }

  // Previous annotation
  const handlePrevious = () => {
    if (queueIndex > 0) {
      setQueueIndex(queueIndex - 1)
    }
  }

  // Handle text size change
  const handleTextSizeChange = async (newPercent: number) => {
    setTextSizePercent(newPercent)

    // Save to database
    if (videoId) {
      try {
        await fetch(`/api/preferences/${encodeURIComponent(videoId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text_size: newPercent }),
        })
      } catch (error) {
        console.error('Failed to save text size preference:', error)
      }
    }
  }

  // Handle padding scale change
  const handlePaddingScaleChange = async (newScale: number) => {
    setPaddingScale(newScale)

    // Save to database
    if (videoId) {
      try {
        await fetch(`/api/preferences/${encodeURIComponent(videoId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ padding_scale: newScale }),
        })
      } catch (error) {
        console.error('Failed to save padding scale preference:', error)
      }
    }
  }

  // Handle text anchor change
  const handleTextAnchorChange = async (newAnchor: 'left' | 'center' | 'right') => {
    const oldAnchor = textAnchor
    setTextAnchor(newAnchor)

    // Reset padding scale to appropriate default when switching anchor modes
    let newPaddingScale = paddingScale

    // When switching to center, default to 0 (centered)
    if (newAnchor === 'center' && oldAnchor !== 'center') {
      newPaddingScale = 0
      setPaddingScale(0)
    }
    // When switching from center to left/right, default to 0.75
    else if (oldAnchor === 'center' && newAnchor !== 'center') {
      newPaddingScale = 0.75
      setPaddingScale(0.75)
    }

    // Save to database
    if (videoId) {
      try {
        await fetch(`/api/preferences/${encodeURIComponent(videoId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text_anchor: newAnchor,
            padding_scale: newPaddingScale,
          }),
        })
      } catch (error) {
        console.error('Failed to save text anchor preference:', error)
      }
    }
  }

  // Get text style based on anchor mode
  const getTextStyle = () => {
    const baseStyle = {
      fontSize: `${actualTextSize}px`,
      paddingTop: '0.75rem',
      paddingBottom: '0.75rem',
    }

    switch (textAnchor) {
      case 'left':
        return {
          ...baseStyle,
          paddingLeft: `${paddingScale}em`,
          paddingRight: '0',
          textAlign: 'left' as const,
        }
      case 'center':
        // Use asymmetric padding to shift centered text while keeping container fixed
        return {
          ...baseStyle,
          paddingLeft: paddingScale >= 0 ? `${paddingScale}em` : '0',
          paddingRight: paddingScale < 0 ? `${-paddingScale}em` : '0',
          textAlign: 'center' as const,
        }
      case 'right':
        return {
          ...baseStyle,
          paddingLeft: '0',
          paddingRight: `${paddingScale}em`,
          textAlign: 'right' as const,
        }
    }
  }

  // Jump to specific annotation ID
  const jumpToAnnotation = useCallback(() => {
    const annotationId = parseInt(jumpToAnnotationInput)
    if (isNaN(annotationId) || annotationId < 0) {
      alert('Invalid annotation ID')
      return
    }

    const index = queue.findIndex(a => a.id === annotationId)
    if (index !== -1) {
      setQueueIndex(index)
      setJumpToAnnotationInput('')
    } else {
      alert(`Annotation ${annotationId} not found in current queue`)
    }
  }, [jumpToAnnotationInput, queue])

  // Switch to boundaries mode
  const switchToBoundaries = () => {
    navigate(`/annotate/boundaries?videoId=${encodeURIComponent(videoId)}`)
  }

  // Frame navigation helpers
  const navigateFrame = useCallback(
    (delta: number) => {
      if (!currentAnnotation) return

      const newIndex = currentFrameIndex + delta
      const minFrame = currentAnnotation.annotation.start_frame_index
      const maxFrame = currentAnnotation.annotation.end_frame_index

      if (newIndex >= minFrame && newIndex <= maxFrame) {
        setCurrentFrameIndex(newIndex)
      }
    },
    [currentFrameIndex, currentAnnotation]
  )

  // Mouse wheel handler for frame navigation
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 1 : -1
      navigateFrame(delta)
    },
    [navigateFrame]
  )

  // Drag handlers for frame navigation
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true)
      setDragStartY(e.clientY)
      setDragStartFrame(currentFrameIndex)
      e.preventDefault()
    },
    [currentFrameIndex]
  )

  const handleDragMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !currentAnnotation) return

      const deltaY = dragStartY - e.clientY
      const framesDelta = Math.floor(deltaY / 10) // 10 pixels per frame

      const newIndex = dragStartFrame + framesDelta
      const minFrame = currentAnnotation.annotation.start_frame_index
      const maxFrame = currentAnnotation.annotation.end_frame_index

      if (newIndex >= minFrame && newIndex <= maxFrame) {
        setCurrentFrameIndex(newIndex)
      }
    },
    [isDragging, dragStartY, dragStartFrame, currentAnnotation]
  )

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Global mouse handlers for drag
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!currentAnnotation) return

      const deltaY = dragStartY - e.clientY
      const framesDelta = Math.floor(deltaY / 10)

      const newIndex = dragStartFrame + framesDelta
      const minFrame = currentAnnotation.annotation.start_frame_index
      const maxFrame = currentAnnotation.annotation.end_frame_index

      if (newIndex >= minFrame && newIndex <= maxFrame) {
        setCurrentFrameIndex(newIndex)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragStartY, dragStartFrame, currentAnnotation])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in input/textarea, unless it's a global shortcut (Ctrl+E)
      const isTyping =
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'

      // Ctrl+E for Save Empty Caption (works even when typing)
      if (e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        handleSaveEmptyCaption()
        return
      }

      // Other shortcuts don't work when typing
      if (isTyping) return

      const key = e.key.toLowerCase()

      // Frame navigation (up/down arrows)
      if (key === 'arrowup') {
        e.preventDefault()
        navigateFrame(-1)
      } else if (key === 'arrowdown') {
        e.preventDefault()
        navigateFrame(1)
      }
      // Annotation navigation
      else if (key === 'enter') {
        e.preventDefault()
        handleSave()
      } else if (key === 'arrowleft') {
        e.preventDefault()
        handlePrevious()
      } else if (key === 'arrowright') {
        e.preventDefault()
        handleSkip()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, handleSaveEmptyCaption, handlePrevious, handleSkip, navigateFrame])

  // Show loading state while metadata loads
  if (loading && queue.length === 0) {
    return (
      <AppLayout fullScreen>
        <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              Loading annotation queue...
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{videoId}</div>
          </div>
        </div>
      </AppLayout>
    )
  }

  // No video selected
  if (!videoId) {
    return (
      <AppLayout fullScreen>
        <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
          <div className="rounded-lg border-2 border-yellow-500 bg-yellow-50 p-6 dark:border-yellow-600 dark:bg-yellow-950">
            <div className="text-lg font-semibold text-yellow-900 dark:text-yellow-100">
              No video selected
            </div>
            <div className="mt-2 text-sm text-yellow-800 dark:text-yellow-200">
              Please select a video from the{' '}
              <a href="/" className="underline hover:text-yellow-900 dark:hover:text-yellow-100">
                home page
              </a>
              .
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout fullScreen>
      <div className="flex h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] flex-col overflow-hidden px-4 py-4">
        {/* Workflow completion banner */}
        {(workflowProgress || 0) >= 100 && (
          <div className="mb-4 rounded-lg bg-green-50 border-2 border-green-500 p-4 dark:bg-green-950 dark:border-green-600">
            <div className="flex items-center gap-3">
              <div className="text-3xl">🎉</div>
              <div className="flex-1">
                <div className="text-lg font-bold text-green-900 dark:text-green-100">
                  Workflow Complete!
                </div>
                <div className="text-sm text-green-700 dark:text-green-300">
                  All annotations have been reviewed. You can continue editing as needed.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border-2 border-red-500 p-4 dark:bg-red-950 dark:border-red-600">
            <div className="flex items-center gap-3">
              <div className="text-2xl">⚠️</div>
              <div className="flex-1">
                <div className="text-lg font-bold text-red-900 dark:text-red-100">Error</div>
                <div className="text-sm text-red-700 dark:text-red-300">{error}</div>
              </div>
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex h-full flex-1 gap-6 overflow-hidden">
          {/* Left: OCR, Image, and Caption Text (2/3 width) */}
          <div className="flex h-full w-2/3 flex-col gap-4 overflow-y-auto">
            {currentAnnotation ? (
              <>
                {/* Frame-by-Frame View */}
                <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                  <div className="p-4">
                    {/* Frame info header */}
                    <div className="mb-3 flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
                      <span className="font-medium">Frame {currentFrameIndex}: Image and OCR</span>
                      <span className="text-xs">
                        ({currentFrameIndex - currentAnnotation.annotation.start_frame_index + 1} of{' '}
                        {currentAnnotation.annotation.end_frame_index -
                          currentAnnotation.annotation.start_frame_index +
                          1}
                        )
                      </span>
                    </div>

                    {/* Frame image */}
                    <div
                      ref={imageContainerRef}
                      className="overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 cursor-grab active:cursor-grabbing"
                      onWheel={handleWheel}
                      onMouseDown={handleDragStart}
                      style={{ userSelect: 'none' }}
                    >
                      <img
                        src={`/api/frames/${encodeURIComponent(videoId)}/${currentFrameIndex}.jpg`}
                        alt={`Frame ${currentFrameIndex}`}
                        className="h-auto w-full"
                        draggable={false}
                      />
                    </div>

                    {/* Per-frame OCR text */}
                    <div className="mt-3">
                      {loadingFrames ? (
                        <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                          Loading frame OCR data...
                        </div>
                      ) : (
                        <div
                          className="rounded-lg bg-gray-50 font-mono whitespace-pre-wrap dark:bg-gray-950 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                          style={getTextStyle()}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            const frameText = perFrameOCR.find(
                              f => f.frameIndex === currentFrameIndex
                            )?.ocrText
                            if (frameText) setText(frameText)
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              const frameText = perFrameOCR.find(
                                f => f.frameIndex === currentFrameIndex
                              )?.ocrText
                              if (frameText) setText(frameText)
                            }
                          }}
                          title="Click to copy to Caption Text"
                        >
                          {perFrameOCR.find(f => f.frameIndex === currentFrameIndex)?.ocrText ||
                            '(No OCR text for this frame)'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Caption Text Editor */}
                <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                  <div className="p-4">
                    <textarea
                      value={text}
                      onChange={e => setText(e.target.value)}
                      className="w-full h-26 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                      style={getTextStyle()}
                      placeholder="Enter caption text..."
                    />
                  </div>
                </div>

                {/* Combined Frames: Image and OCR */}
                <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                  <div className="p-4">
                    {/* Combined image */}
                    <div className="overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
                      <img
                        src={currentAnnotation.combinedImageUrl}
                        alt={`Annotation ${currentAnnotation.annotation.id}`}
                        className="h-auto w-full"
                      />
                    </div>

                    {/* Combined OCR text */}
                    <div className="mt-3">
                      <div
                        className="rounded-lg bg-gray-50 font-mono whitespace-pre-wrap dark:bg-gray-950 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                        style={getTextStyle()}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          const combinedText = currentAnnotation.annotation.text_ocr_combined
                          if (combinedText) setText(combinedText)
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            const combinedText = currentAnnotation.annotation.text_ocr_combined
                            if (combinedText) setText(combinedText)
                          }
                        }}
                        title="Click to copy to Caption Text"
                      >
                        {currentAnnotation.annotation.text_ocr_combined ||
                          '(No OCR text available)'}
                      </div>
                    </div>

                    {/* Title at bottom */}
                    <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 font-medium">
                      Combined Frames {currentAnnotation.annotation.start_frame_index} -{' '}
                      {currentAnnotation.annotation.end_frame_index} (
                      {currentAnnotation.annotation.end_frame_index -
                        currentAnnotation.annotation.start_frame_index +
                        1}{' '}
                      frames): Image and OCR
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <div className="text-center text-gray-500 dark:text-gray-400">
                  {queue.length === 0 ? 'No annotations in queue' : 'Loading annotation...'}
                </div>
              </div>
            )}
          </div>

          {/* Right: Controls (1/3 width) */}
          <div className="flex h-full w-1/3 flex-col gap-4 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            {/* Mode toggle */}
            <div className="flex gap-2 rounded-md border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
              <button
                onClick={switchToBoundaries}
                className="flex-1 rounded py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Boundaries
              </button>
              <button className="flex-1 rounded py-2 text-sm font-semibold bg-teal-600 text-white">
                Text Correction
              </button>
            </div>

            {/* Video info */}
            <div>
              <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">Video</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">{videoId}</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Annotation: {queueIndex + 1} / {queue.length}
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                Progress: {(workflowProgress || 0).toFixed(2)}% ({completedAnnotations} completed)
              </div>

              {/* Jump to annotation */}
              <div className="mt-3 flex gap-2">
                <input
                  type="number"
                  value={jumpToAnnotationInput}
                  onChange={e => setJumpToAnnotationInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && jumpToAnnotation()}
                  placeholder="Annotation ID"
                  className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
                <button
                  onClick={jumpToAnnotation}
                  disabled={!jumpToAnnotationInput}
                  className={`rounded-md px-3 py-1 text-sm font-medium ${
                    jumpToAnnotationInput
                      ? 'bg-teal-600 text-white hover:bg-teal-700'
                      : 'cursor-not-allowed bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-600'
                  }`}
                >
                  Jump
                </button>
              </div>
            </div>

            {/* Active annotation info */}
            {currentAnnotation && (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950">
                <div className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Active Annotation
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">ID:</span>
                    <span className="font-mono font-semibold text-gray-900 dark:text-white">
                      {currentAnnotation.annotation.id}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">State:</span>
                    <span className="font-semibold text-gray-900 dark:text-white capitalize">
                      {currentAnnotation.annotation.boundary_state}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Frames:</span>
                    <span className="font-mono text-gray-900 dark:text-white">
                      {currentAnnotation.annotation.start_frame_index}-
                      {currentAnnotation.annotation.end_frame_index}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Text Display Controls - Collapsible */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
              <button
                type="button"
                onClick={() => setTextControlsExpanded(!textControlsExpanded)}
                className="w-full px-4 py-3 flex items-center justify-between text-left bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 rounded-lg transition-colors"
              >
                <span className="font-semibold text-gray-700 dark:text-gray-300">
                  Text Display Controls
                </span>
                <svg
                  className={`w-5 h-5 text-gray-500 transition-transform ${textControlsExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {textControlsExpanded && (
                <div className="p-4 space-y-4">
                  {/* Text Anchor */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Text Anchor
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleTextAnchorChange('left')}
                        className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                          textAnchor === 'left'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                        }`}
                      >
                        Left
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTextAnchorChange('center')}
                        className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                          textAnchor === 'center'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                        }`}
                      >
                        Center
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTextAnchorChange('right')}
                        className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                          textAnchor === 'right'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                        }`}
                      >
                        Right
                      </button>
                    </div>
                  </div>

                  {/* Text Size */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Text Size: {textSizePercent.toFixed(1)}% ({Math.round(actualTextSize)}px)
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">1%</span>
                      <input
                        type="range"
                        min="1.0"
                        max="10.0"
                        step="0.1"
                        value={textSizePercent}
                        onChange={e => handleTextSizeChange(parseFloat(e.target.value))}
                        className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                      />
                      <span className="text-xs text-gray-500 dark:text-gray-400">10%</span>
                    </div>
                  </div>

                  {/* Padding / Center Offset */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {textAnchor === 'center'
                        ? `Center Offset: ${paddingScale >= 0 ? '+' : ''}${paddingScale.toFixed(2)}em`
                        : `${textAnchor === 'left' ? 'Left' : 'Right'} Padding: ${paddingScale.toFixed(2)}em`}
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {textAnchor === 'center' ? '-2em' : textAnchor === 'right' ? '2em' : '0'}
                      </span>
                      <input
                        type="range"
                        min={textAnchor === 'center' ? '-2.0' : '0.0'}
                        max="2.0"
                        step="0.05"
                        value={textAnchor === 'right' ? 2.0 - paddingScale : paddingScale}
                        onChange={e => {
                          const sliderValue = parseFloat(e.target.value)
                          const actualValue =
                            textAnchor === 'right' ? 2.0 - sliderValue : sliderValue
                          handlePaddingScaleChange(actualValue)
                        }}
                        className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                      />
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {textAnchor === 'center' ? '+2em' : textAnchor === 'right' ? '0' : '2em'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Status
              </label>
              <select
                value={textStatus}
                onChange={e => setTextStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              >
                <option value="valid_caption">Valid Caption</option>
                <option value="ocr_error">OCR Error</option>
                <option value="partial_caption">Partial Caption</option>
                <option value="text_unclear">Text Unclear</option>
                <option value="other_issue">Other Issue</option>
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Notes
              </label>
              <textarea
                value={textNotes}
                onChange={e => setTextNotes(e.target.value)}
                className="w-full h-24 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                placeholder="Optional notes about this annotation..."
              />
            </div>

            {/* Action Buttons */}
            <div className="space-y-2">
              <button
                onClick={handleSave}
                disabled={!currentAnnotation}
                className={`w-full rounded-md px-4 py-2 text-sm font-semibold text-white ${
                  currentAnnotation
                    ? 'bg-teal-600 hover:bg-teal-700'
                    : 'cursor-not-allowed bg-gray-400 dark:bg-gray-700'
                }`}
              >
                Save & Next <span className="text-xs opacity-75">(Enter)</span>
              </button>

              <button
                onClick={handleSaveEmptyCaption}
                disabled={!currentAnnotation}
                className={`w-full rounded-md px-4 py-2 text-sm font-semibold ${
                  currentAnnotation
                    ? 'bg-orange-500 text-white hover:bg-orange-600'
                    : 'cursor-not-allowed bg-gray-400 text-gray-600 dark:bg-gray-700'
                }`}
              >
                Save Empty Caption <span className="text-xs opacity-75">(Ctrl+E)</span>
              </button>

              {/* Navigation */}
              <div className="flex gap-2">
                <button
                  onClick={handlePrevious}
                  disabled={queueIndex === 0}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                    queueIndex > 0
                      ? 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                      : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600'
                  }`}
                >
                  ← Previous
                </button>
                <button
                  onClick={handleSkip}
                  disabled={queueIndex >= queue.length - 1}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                    queueIndex < queue.length - 1
                      ? 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                      : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600'
                  }`}
                >
                  Skip →
                </button>
              </div>
            </div>

            {/* Help button */}
            <button
              onClick={() => setShowHelpModal(true)}
              className="w-full rounded-md border border-teal-500 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100 dark:border-teal-600 dark:bg-teal-950 dark:text-teal-300 dark:hover:bg-teal-900"
            >
              📖 Annotation Guide
            </button>

            {/* Keyboard shortcuts */}
            <details className="rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950">
              <summary className="cursor-pointer p-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">
                Keyboard Shortcuts
              </summary>
              <div className="space-y-1 p-3 pt-1 text-xs text-gray-600 dark:text-gray-400">
                <div>
                  <strong>Frame Navigation:</strong>
                </div>
                <div>↑ : Previous frame</div>
                <div>↓ : Next frame</div>
                <div className="mt-2">
                  <strong>Annotation Navigation:</strong>
                </div>
                <div>← : Previous annotation</div>
                <div>→ : Skip to next</div>
                <div className="mt-2">
                  <strong>Actions:</strong>
                </div>
                <div>Enter: Save & Next (requires text)</div>
                <div>Ctrl+E: Save Empty Caption</div>
              </div>
            </details>
          </div>
        </div>
      </div>

      {/* Help Modal */}
      {showHelpModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-opacity-40 p-16 backdrop-blur-sm"
          onClick={() => setShowHelpModal(false)}
        >
          <div
            className="w-full max-w-3xl rounded-lg bg-white bg-opacity-75 px-2 py-5 shadow-xl dark:bg-gray-900 dark:bg-opacity-75"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Text Annotation Guide
              </h2>
              <button
                onClick={() => setShowHelpModal(false)}
                className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Purpose
                </h3>
                <p>
                  This page helps you review and correct text extracted from video captions. Each
                  annotation shows a combined image of all frames in the caption along with
                  OCR-extracted text that you can correct.
                </p>
              </section>

              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Workflow
                </h3>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>Review the combined image showing all caption frames</li>
                  <li>Check the OCR-extracted text for accuracy</li>
                  <li>Edit the caption text to correct any OCR errors</li>
                  <li>Select the appropriate status for the annotation</li>
                  <li>Add notes if needed (optional)</li>
                  <li>Click "Save & Next" to save and move to the next annotation</li>
                </ol>
              </section>

              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Status Options
                </h3>
                <div className="space-y-2">
                  <div>
                    <strong className="text-gray-900 dark:text-white">Valid Caption:</strong>{' '}
                    Caption text is correct and complete
                  </div>
                  <div>
                    <strong className="text-gray-900 dark:text-white">OCR Error:</strong> OCR
                    extracted incorrect text that was corrected
                  </div>
                  <div>
                    <strong className="text-gray-900 dark:text-white">Partial Caption:</strong> Only
                    part of the caption is visible or readable
                  </div>
                  <div>
                    <strong className="text-gray-900 dark:text-white">Text Unclear:</strong> Text is
                    difficult to read in the image
                  </div>
                  <div>
                    <strong className="text-gray-900 dark:text-white">Other Issue:</strong> Other
                    problems with the annotation (explain in notes)
                  </div>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Tips</h3>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Use the combined image to verify OCR accuracy</li>
                  <li>Empty text field means "no caption" (valid for gaps)</li>
                  <li>Use notes to explain unusual cases or issues</li>
                  <li>Use keyboard shortcuts for faster navigation</li>
                  <li>Progress tracks completed vs total annotations</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
