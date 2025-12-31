import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { AnnotationInfoPanel } from '~/components/annotation/AnnotationInfoPanel'
import { CaptionTextForm } from '~/components/annotation/CaptionTextForm'
import { CombinedImageDisplay } from '~/components/annotation/CombinedImageDisplay'
import { CompletionBanner } from '~/components/annotation/CompletionBanner'
import { ErrorBanner } from '~/components/annotation/ErrorBanner'
import { FrameViewer } from '~/components/annotation/FrameViewer'
import { PerFrameOCRDisplay } from '~/components/annotation/PerFrameOCRDisplay'
import { TextAnnotationActions } from '~/components/annotation/TextAnnotationActions'
import { TextDisplayControls } from '~/components/annotation/TextDisplayControls'
import { VideoInfoPanel } from '~/components/annotation/VideoInfoPanel'
import { useKeyboardShortcuts } from '~/hooks/useKeyboardShortcuts'
import { useVideoTouched } from '~/hooks/useVideoTouched'

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
    defaultVideoId: process.env['DEFAULT_VIDEO_ID'] ?? '',
  }
}

export default function AnnotateText() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const videoId = searchParams.get('videoId') ?? ''

  const [queue, setQueue] = useState<TextQueueAnnotation[]>([])
  const [queueIndex, setQueueIndex] = useState(0)
  const [currentAnnotation, setCurrentAnnotation] = useState<AnnotationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
  useVideoTouched(videoId)

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

    void loadPreferences()
  }, [videoId])

  // Load video metadata and progress
  useEffect(() => {
    if (!videoId) return

    const loadMetadata = async () => {
      try {
        const encodedVideoId = encodeURIComponent(videoId)

        // Load video metadata
        const metadataResponse = await fetch(`/api/videos/${encodedVideoId}/metadata`)
        // Load metadata but we don't need to store totalFrames
        await metadataResponse.json()

        // Load text workflow progress (we'll need a new endpoint for this)
        // For now, calculate from queue
        const queueResponse = await fetch(`/api/annotations/${encodedVideoId}/text-queue`)
        const queueData = await queueResponse.json()
        setQueue(queueData.annotations)

        // Calculate progress based on annotations with text vs total annotations
        // This is a simplified calculation - you might want a dedicated endpoint
        const totalAnnotations = queueData.total ?? queueData.annotations.length
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

    void loadMetadata()
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
        setText(data.annotation.text ?? data.annotation.text_ocr_combined ?? '')
        setTextStatus(data.annotation.text_status ?? 'valid_caption')
        setTextNotes(data.annotation.text_notes ?? '')

        // Set initial frame to start of annotation
        setCurrentFrameIndex(data.annotation.start_frame_index)

        setLoading(false)
      } catch (err) {
        setError((err as Error).message)
        setLoading(false)
      }
    }

    void loadAnnotation()
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

        setPerFrameOCR(data.frames ?? [])
        setLoadingFrames(false)
      } catch (err) {
        console.error('Failed to load frame OCR:', err)
        setPerFrameOCR([])
        setLoadingFrames(false)
      }
    }

    void loadFrameOCR()
  }, [videoId, currentAnnotation])

  // Update progress from server
  const updateProgress = useCallback(async () => {
    if (!videoId) return

    try {
      const encodedVideoId = encodeURIComponent(videoId)
      const queueResponse = await fetch(`/api/annotations/${encodedVideoId}/text-queue`)
      const queueData = await queueResponse.json()

      const totalAnnotations = queueData.total ?? queueData.annotations.length
      const completedCount = totalAnnotations - queueData.annotations.length
      setCompletedAnnotations(completedCount)
      setWorkflowProgress(totalAnnotations > 0 ? (completedCount / totalAnnotations) * 100 : 0)
    } catch (err) {
      console.error('Failed to update progress:', err)
    }
  }, [videoId])

  // Save annotation with text
  const handleSave = useCallback(async () => {
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
  }, [
    videoId,
    currentAnnotation,
    text,
    textStatus,
    textNotes,
    updateProgress,
    queueIndex,
    queue.length,
  ])

  // Save annotation with empty caption
  const handleSaveEmptyCaption = useCallback(async () => {
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
  }, [videoId, currentAnnotation, textStatus, textNotes, updateProgress, queueIndex, queue.length])

  // Skip to next annotation without saving
  const handleSkip = useCallback(() => {
    if (queueIndex < queue.length - 1) {
      setQueueIndex(queueIndex + 1)
    }
  }, [queueIndex, queue.length])

  // Previous annotation
  const handlePrevious = useCallback(() => {
    if (queueIndex > 0) {
      setQueueIndex(queueIndex - 1)
    }
  }, [queueIndex])

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
    void navigate(`/annotate/boundaries?videoId=${encodeURIComponent(videoId)}`)
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
  useKeyboardShortcuts(
    e => {
      // Ctrl+E for Save Empty Caption (works even when typing)
      if (e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        void handleSaveEmptyCaption()
        return
      }

      // Skip if typing in input/textarea for other shortcuts
      const isTyping =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
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
        void handleSave()
      } else if (key === 'arrowleft') {
        e.preventDefault()
        handlePrevious()
      } else if (key === 'arrowright') {
        e.preventDefault()
        handleSkip()
      }
    },
    [handleSave, handleSaveEmptyCaption, handlePrevious, handleSkip, navigateFrame],
    { skipWhenTyping: false } // Handle typing check manually for Ctrl+E
  )

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
        <CompletionBanner workflowProgress={workflowProgress || 0} />

        {/* Error banner */}
        <ErrorBanner error={error} />

        {/* Main content */}
        <div className="flex h-full flex-1 gap-6 overflow-hidden">
          {/* Left: OCR, Image, and Caption Text (2/3 width) */}
          <div className="flex h-full w-2/3 flex-col gap-4 overflow-y-auto">
            {currentAnnotation ? (
              <>
                {/* Frame-by-Frame View */}
                <div>
                  <FrameViewer
                    videoId={videoId}
                    currentFrameIndex={currentFrameIndex}
                    startFrameIndex={currentAnnotation.annotation.start_frame_index}
                    endFrameIndex={currentAnnotation.annotation.end_frame_index}
                    imageContainerRef={imageContainerRef}
                    onWheel={handleWheel}
                    onMouseDown={handleDragStart}
                  />

                  {/* Per-frame OCR text */}
                  <PerFrameOCRDisplay
                    currentFrameIndex={currentFrameIndex}
                    perFrameOCR={perFrameOCR}
                    loadingFrames={loadingFrames}
                    textStyle={getTextStyle()}
                    onTextSelect={setText}
                  />
                </div>

                {/* Caption Text Editor */}
                <CaptionTextForm text={text} onChange={setText} textStyle={getTextStyle()} />

                {/* Combined Frames: Image and OCR */}
                <CombinedImageDisplay
                  annotation={currentAnnotation.annotation}
                  combinedImageUrl={currentAnnotation.combinedImageUrl}
                  textStyle={getTextStyle()}
                  onTextSelect={setText}
                />
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
            <VideoInfoPanel
              videoId={videoId}
              queueIndex={queueIndex}
              queueLength={queue.length}
              workflowProgress={workflowProgress || 0}
              completedAnnotations={completedAnnotations}
              jumpToAnnotationInput={jumpToAnnotationInput}
              onJumpInputChange={setJumpToAnnotationInput}
              onJump={jumpToAnnotation}
            />

            {/* Active annotation info */}
            <AnnotationInfoPanel annotation={currentAnnotation?.annotation ?? null} />

            {/* Text Display Controls - Collapsible */}
            <TextDisplayControls
              textAnchor={textAnchor}
              textSizePercent={textSizePercent}
              paddingScale={paddingScale}
              actualTextSize={actualTextSize}
              expanded={textControlsExpanded}
              onExpandedChange={setTextControlsExpanded}
              onTextAnchorChange={anchor => void handleTextAnchorChange(anchor)}
              onTextSizeChange={size => void handleTextSizeChange(size)}
              onPaddingScaleChange={padding => void handlePaddingScaleChange(padding)}
            />

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
            <TextAnnotationActions
              onSave={() => void handleSave()}
              onSaveEmpty={() => void handleSaveEmptyCaption()}
              onPrevious={handlePrevious}
              onSkip={handleSkip}
              canSave={!!currentAnnotation}
              hasPrevious={queueIndex > 0}
              hasNext={queueIndex < queue.length - 1}
            />

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
                  <li>Click &quot;Save &amp; Next&quot; to save and move to the next annotation</li>
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
                  <li>Empty text field means &quot;no caption&quot; (valid for gaps)</li>
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
