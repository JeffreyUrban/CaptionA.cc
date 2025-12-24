import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams, useLoaderData } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'
import { AppLayout } from '~/components/AppLayout'

// Types
interface Frame {
  frame_index: number
  image_url: string
  ocr_text: string
}

type AnnotationState = 'predicted' | 'confirmed' | 'gap'

interface Annotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  state: AnnotationState
  pending: boolean  // When true, annotation is treated as pending for workflow purposes
  text: string | null
  created_at?: string
  updated_at?: string
}

type FrameSpacing = 'linear' | 'exponential' | 'hybrid'

// Annotation index granularity (index by 100s)
const ANNOTATION_INDEX_GRANULARITY = 100
const ANNOTATION_CACHE_RANGE = 1000 // Cache annotations within ±1000 frames

// Frame spacing configurations
const FRAME_OFFSETS: Record<FrameSpacing, number[]> = {
  linear: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5],
  exponential: [-8, -4, -2, -1, 0, 1, 2, 4, 8],
  hybrid: [-10, -5, -3, -2, -1, 0, 1, 2, 3, 5, 10]
}

// Opacity for frame distance
const OPACITY_MAP: Record<number, number> = {
  0: 1.0,
  1: 0.9,
  2: 0.7,
  3: 0.6,
  4: 0.5,
  5: 0.4,
  8: 0.3,
  10: 0.2
}

// Loader function to expose environment variables
export async function loader() {
  return {
    defaultVideoId: process.env.DEFAULT_VIDEO_ID || ''
  }
}

// Helper functions for annotation management
function getAnnotationIndexKey(frameIndex: number): number {
  return Math.floor(frameIndex / ANNOTATION_INDEX_GRANULARITY) * ANNOTATION_INDEX_GRANULARITY
}

function getEffectiveState(annotation: Annotation): 'pending' | AnnotationState {
  return annotation.pending ? 'pending' : annotation.state
}

function getAnnotationBorderColor(annotation: Annotation): string {
  const effectiveState = getEffectiveState(annotation)
  switch (effectiveState) {
    case 'pending': return 'border-pink-500'
    case 'predicted': return 'border-indigo-500'
    case 'confirmed': return 'border-teal-500'
    case 'gap': return ''
  }
}

export default function BoundaryWorkflow() {
  const [searchParams] = useSearchParams()
  const loaderData = useLoaderData<typeof loader>()
  const defaultVideoId = loaderData?.defaultVideoId || ''

  // Get videoId from URL params, fallback to empty string
  const videoIdFromUrl = searchParams.get('videoId') || ''

  // State
  const [videoId, setVideoId] = useState(videoIdFromUrl)
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0)
  const [totalFrames, setTotalFrames] = useState(0)
  const [frames, setFrames] = useState<Map<number, Frame>>(new Map())
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(true)

  // Annotation management
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [annotationIndex, setAnnotationIndex] = useState<Map<number, Annotation[]>>(new Map())
  const [activeAnnotation, setActiveAnnotation] = useState<Annotation | null>(null)
  const [markedStart, setMarkedStart] = useState<number | null>(null)
  const [markedEnd, setMarkedEnd] = useState<number | null>(null)
  const [hasPrevAnnotation, setHasPrevAnnotation] = useState(false)
  const [hasNextAnnotation, setHasNextAnnotation] = useState(false)

  // Workflow progress tracking
  const [workflowProgress, setWorkflowProgress] = useState(0) // Percentage of completed frames
  const [completedFrames, setCompletedFrames] = useState(0) // Count of non-gap, non-pending frames

  const [frameSpacing, setFrameSpacing] = useState<FrameSpacing>('linear')
  const [windowHeight, setWindowHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 1000)
  const [jumpToFrameInput, setJumpToFrameInput] = useState('')
  const [showHelpModal, setShowHelpModal] = useState(false)

  // Drag-to-scroll state (using refs for synchronous access)
  const isDraggingRef = useRef(false)
  const dragStartYRef = useRef(0)
  const dragStartFrameRef = useRef(0)
  const lastYRef = useRef(0)
  const lastTimeRef = useRef(0)
  const velocityRef = useRef(0)
  const momentumFrameRef = useRef<number | null>(null)
  const [cursorStyle, setCursorStyle] = useState<'grab' | 'grabbing'>('grab')

  // Cleanup momentum animation on unmount
  useEffect(() => {
    return () => {
      if (momentumFrameRef.current !== null) {
        cancelAnimationFrame(momentumFrameRef.current)
      }
    }
  }, [])

  // Load video metadata and initial annotation on mount
  useEffect(() => {
    const loadMetadata = async () => {
      try {
        // URL encode the videoId to handle slashes
        const encodedVideoId = encodeURIComponent(videoId)

        // Load video metadata
        const metadataResponse = await fetch(`/api/videos/${encodedVideoId}/metadata`)
        const metadataData = await metadataResponse.json()
        setTotalFrames(metadataData.totalFrames)

        // Load workflow progress
        const progressResponse = await fetch(`/api/annotations/${encodedVideoId}/progress`)
        const progressData = await progressResponse.json()
        setWorkflowProgress(progressData.progress_percent)
        setCompletedFrames(progressData.completed_frames)

        // Load next annotation to work on
        const nextResponse = await fetch(`/api/annotations/${encodedVideoId}/next`)
        const nextData = await nextResponse.json()

        if (nextData.annotation) {
          setActiveAnnotation(nextData.annotation)
          setCurrentFrameIndex(nextData.annotation.start_frame_index)
          setMarkedStart(nextData.annotation.start_frame_index)
          setMarkedEnd(nextData.annotation.end_frame_index)

          // Initial load: check if there's any other annotation (most recently updated)
          // We need to check all annotations, not just ones before this timestamp
          const allAnnotationsResponse = await fetch(
            `/api/annotations/${encodedVideoId}?start=0&end=999999`
          )
          const allAnnotationsData = await allAnnotationsResponse.json()
          // Check if there's at least one other annotation besides the active one
          setHasPrevAnnotation(allAnnotationsData.annotations && allAnnotationsData.annotations.length > 1)
          setHasNextAnnotation(false)
        }

        setIsLoadingMetadata(false)
      } catch (error) {
        console.error('Failed to load video metadata:', error)
        setIsLoadingMetadata(false)
      }
    }
    loadMetadata()
  }, [videoId])

  // Helper: Update progress from database
  const updateProgress = useCallback(async () => {
    try {
      const encodedVideoId = encodeURIComponent(videoId)
      const progressResponse = await fetch(`/api/annotations/${encodedVideoId}/progress`)
      const progressData = await progressResponse.json()
      setWorkflowProgress(progressData.progress_percent)
      setCompletedFrames(progressData.completed_frames)
    } catch (error) {
      console.error('Failed to update progress:', error)
    }
  }, [videoId])

  // Helper: Load annotations for visible range
  const loadAnnotations = useCallback(async (startFrame: number, endFrame: number) => {
    const encodedVideoId = encodeURIComponent(videoId)

    try {
      const response = await fetch(
        `/api/annotations/${encodedVideoId}?start=${startFrame}&end=${endFrame}`
      )
      const data = await response.json()
      setAnnotations(data.annotations || [])
    } catch (error) {
      console.error('Failed to load annotations:', error)
    }
  }, [videoId])

  // Mark this video as being worked on for stats refresh on Videos page
  useEffect(() => {
    if (videoId && typeof window !== 'undefined') {
      const touchedVideos = new Set(
        JSON.parse(localStorage.getItem('touched-videos') || '[]')
      )
      touchedVideos.add(videoId)
      localStorage.setItem('touched-videos', JSON.stringify(Array.from(touchedVideos)))
    }
  }, [videoId])

  // Track window height for dynamic frame count
  useEffect(() => {
    if (typeof window === 'undefined') return

    setWindowHeight(window.innerHeight)
    const handleResize = () => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Computed: visible frame indices based on window height
  const visibleFrameIndices = useMemo(() => {
    // Calculate available height: total window height minus navbar (64px) and padding
    const navbarHeight = 64
    // Safety: ensure minimum window height to prevent empty frame list
    const safeWindowHeight = Math.max(windowHeight, 400)
    const availableHeight = Math.max(safeWindowHeight - navbarHeight, 300)

    // Estimate frame height: ~80-120px depending on aspect ratio
    // Using 90px as conservative estimate to ensure we fill the height
    const estimatedFrameHeight = 90

    // Calculate how many frames we need to fill the height
    const framesToFill = Math.max(Math.ceil(availableHeight / estimatedFrameHeight), 3)

    // Get base offsets for the selected spacing
    const baseOffsets = FRAME_OFFSETS[frameSpacing]

    // Extend offsets to fill the available height
    let adjustedOffsets = [...baseOffsets]
    const maxBaseOffset = Math.max(...baseOffsets.map(Math.abs))

    // Add more frames until we have enough to fill the height
    if (framesToFill > baseOffsets.length) {
      const additionalFramesNeeded = framesToFill - baseOffsets.length
      const framesPerSide = Math.ceil(additionalFramesNeeded / 2)

      for (let i = 1; i <= framesPerSide; i++) {
        const offset = maxBaseOffset + i
        adjustedOffsets.push(-offset)
        adjustedOffsets.push(offset)
      }
      adjustedOffsets.sort((a, b) => a - b)
    }

    return adjustedOffsets
      .map(offset => currentFrameIndex + offset)
      .filter(idx => idx >= 0 && idx < totalFrames)
  }, [currentFrameIndex, frameSpacing, totalFrames, windowHeight])

  // Get opacity for frame distance
  const getOpacity = useCallback((frameIndex: number) => {
    const distance = Math.abs(frameIndex - currentFrameIndex)
    return OPACITY_MAP[distance] ?? 0.3
  }, [currentFrameIndex])

  // Can save if both boundaries marked (single frame captions allowed: start == end)
  const canSave = markedStart !== null && markedEnd !== null && markedStart <= markedEnd

  // Navigation functions
  const navigateFrame = useCallback((delta: number) => {
    setCurrentFrameIndex(prev => Math.max(0, Math.min(prev + delta, totalFrames - 1)))
  }, [totalFrames])

  // Marking functions
  const markStart = useCallback(() => {
    setMarkedStart(currentFrameIndex)
    // If marking start after current end, clear end to prevent invalid order
    if (markedEnd !== null && currentFrameIndex > markedEnd) {
      setMarkedEnd(null)
    }
  }, [currentFrameIndex, markedEnd])

  const markEnd = useCallback(() => {
    setMarkedEnd(currentFrameIndex)
    // If marking end before current start, clear start to prevent invalid order
    if (markedStart !== null && currentFrameIndex < markedStart) {
      setMarkedStart(null)
    }
  }, [currentFrameIndex, markedStart])

  const jumpToStart = useCallback(() => {
    if (markedStart !== null) {
      setCurrentFrameIndex(markedStart)
    }
  }, [markedStart])

  const jumpToEnd = useCallback(() => {
    if (markedEnd !== null) {
      setCurrentFrameIndex(markedEnd)
    }
  }, [markedEnd])

  const clearMarks = useCallback(() => {
    // Reset marks to original annotation boundaries (cancel any changes)
    if (activeAnnotation) {
      setMarkedStart(activeAnnotation.start_frame_index)
      setMarkedEnd(activeAnnotation.end_frame_index)
    }
  }, [activeAnnotation])

  // Drag-to-scroll handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault() // Prevent default drag behavior

    // Cancel momentum if running
    if (momentumFrameRef.current !== null) {
      cancelAnimationFrame(momentumFrameRef.current)
      momentumFrameRef.current = null
    }

    isDraggingRef.current = true
    dragStartYRef.current = e.clientY
    dragStartFrameRef.current = currentFrameIndex
    lastYRef.current = e.clientY
    lastTimeRef.current = Date.now()
    velocityRef.current = 0
    setCursorStyle('grabbing')

    // Add global listeners for move and up
    const handleMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return

      const now = Date.now()
      const deltaY = dragStartYRef.current - moveEvent.clientY
      const frameDelta = Math.round(deltaY / 30) // 30 pixels per frame
      const newFrame = Math.max(0, Math.min(dragStartFrameRef.current + frameDelta, totalFrames - 1))

      // Calculate velocity for momentum
      const timeDelta = now - lastTimeRef.current
      if (timeDelta > 0) {
        const yDelta = lastYRef.current - moveEvent.clientY
        velocityRef.current = (yDelta / timeDelta) * 16 / 30 // Convert to frames per 16ms
      }

      lastYRef.current = moveEvent.clientY
      lastTimeRef.current = now
      setCurrentFrameIndex(newFrame)
    }

    const handleUp = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      setCursorStyle('grab')

      // Remove listeners
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)

      // Apply momentum with fractional position tracking
      const initialVelocity = velocityRef.current
      if (Math.abs(initialVelocity) > 0.05) {
        let velocity = initialVelocity
        let position = currentFrameIndex // Track fractional position
        const friction = 0.99 // Friction factor for smooth deceleration

        const animate = () => {
          velocity *= friction

          // Stop when velocity becomes negligible
          if (Math.abs(velocity) < 0.01) {
            momentumFrameRef.current = null
            return
          }

          // Update fractional position
          position += velocity

          // Clamp to valid range
          position = Math.max(0, Math.min(position, totalFrames - 1))

          // Update displayed frame (rounded from fractional position)
          const newFrame = Math.round(position)
          setCurrentFrameIndex(newFrame)

          momentumFrameRef.current = requestAnimationFrame(animate)
        }
        momentumFrameRef.current = requestAnimationFrame(animate)
      }
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [currentFrameIndex, totalFrames])

  // Navigate to previous/next annotation by updated_at time
  const navigateToAnnotation = useCallback(async (direction: 'prev' | 'next') => {
    if (!activeAnnotation) return

    try {
      const encodedVideoId = encodeURIComponent(videoId)
      const response = await fetch(
        `/api/annotations/${encodedVideoId}/navigate?direction=${direction}&currentId=${activeAnnotation.id}`
      )
      const data = await response.json()

      if (data.annotation) {
        setActiveAnnotation(data.annotation)
        setCurrentFrameIndex(data.annotation.start_frame_index)
        setMarkedStart(data.annotation.start_frame_index)
        setMarkedEnd(data.annotation.end_frame_index)

        // After navigating, check both directions
        checkNavigationAvailability(data.annotation.id)
      }
    } catch (error) {
      console.error(`Failed to navigate to ${direction} annotation:`, error)
    }
  }, [activeAnnotation, videoId])

  // Helper to check navigation availability
  const checkNavigationAvailability = useCallback(async (annotationId: number) => {
    const encodedVideoId = encodeURIComponent(videoId)

    try {
      // Check for previous
      const prevResponse = await fetch(
        `/api/annotations/${encodedVideoId}/navigate?direction=prev&currentId=${annotationId}`
      )
      const prevData = await prevResponse.json()
      setHasPrevAnnotation(!!prevData.annotation)

      // Check for next
      const nextResponse = await fetch(
        `/api/annotations/${encodedVideoId}/navigate?direction=next&currentId=${annotationId}`
      )
      const nextData = await nextResponse.json()
      setHasNextAnnotation(!!nextData.annotation)
    } catch (error) {
      console.error('Failed to check navigation:', error)
    }
  }, [videoId])

  // Jump to frame and load annotation containing it
  const jumpToFrame = useCallback(async () => {
    const frameNumber = parseInt(jumpToFrameInput)
    if (isNaN(frameNumber) || frameNumber < 0 || frameNumber >= totalFrames) {
      alert(`Invalid frame number. Must be between 0 and ${totalFrames - 1}`)
      return
    }

    try {
      const encodedVideoId = encodeURIComponent(videoId)
      // Query for annotations containing this frame
      const response = await fetch(
        `/api/annotations/${encodedVideoId}?start=${frameNumber}&end=${frameNumber}`
      )
      const data = await response.json()

      if (data.annotations && data.annotations.length > 0) {
        const annotation = data.annotations[0]
        setActiveAnnotation(annotation)
        setCurrentFrameIndex(frameNumber)
        setMarkedStart(annotation.start_frame_index)
        setMarkedEnd(annotation.end_frame_index)

        // After jumping, check navigation availability
        checkNavigationAvailability(annotation.id)
        setJumpToFrameInput('')
      } else {
        alert(`No annotation found containing frame ${frameNumber}`)
      }
    } catch (error) {
      console.error('Failed to jump to frame:', error)
      alert('Failed to jump to frame')
    }
  }, [jumpToFrameInput, totalFrames, videoId, checkNavigationAvailability])

  // Delete active annotation
  const deleteAnnotation = useCallback(async () => {
    if (!activeAnnotation) return

    try {
      const encodedVideoId = encodeURIComponent(videoId)

      const response = await fetch(
        `/api/annotations/${encodedVideoId}/${activeAnnotation.id}/delete`,
        { method: 'POST' }
      )

      if (!response.ok) {
        throw new Error('Failed to delete annotation')
      }

      // Update progress from database
      await updateProgress()

      // Load next annotation
      const nextResponse = await fetch(`/api/annotations/${encodedVideoId}/next`)
      const nextData = await nextResponse.json()

      if (nextData.annotation) {
        setActiveAnnotation(nextData.annotation)
        setCurrentFrameIndex(nextData.annotation.start_frame_index)
        setMarkedStart(nextData.annotation.start_frame_index)
        setMarkedEnd(nextData.annotation.end_frame_index)

        // After delete, we know there's a previous (the deleted one became a gap)
        // and no next (we loaded the next pending/gap)
        setHasPrevAnnotation(true)
        setHasNextAnnotation(false)
      } else {
        // No more annotations - workflow complete
        setActiveAnnotation(null)
        setMarkedStart(null)
        setMarkedEnd(null)
        setHasPrevAnnotation(false)
        setHasNextAnnotation(false)
      }
    } catch (error) {
      console.error('Failed to delete annotation:', error)
    }
  }, [activeAnnotation, videoId, updateProgress])

  // Save annotation
  const saveAnnotation = useCallback(async () => {
    if (!canSave || !activeAnnotation || markedStart === null || markedEnd === null) return

    try {
      const encodedVideoId = encodeURIComponent(videoId)

      // Save the annotation with overlap resolution
      const saveResponse = await fetch(`/api/annotations/${encodedVideoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activeAnnotation.id,
          start_frame_index: markedStart,
          end_frame_index: markedEnd,
          state: activeAnnotation.state === 'gap' ? 'confirmed' : activeAnnotation.state,
          pending: false
        })
      })

      if (!saveResponse.ok) {
        throw new Error('Failed to save annotation')
      }

      // Update progress from database
      await updateProgress()

      // Reload annotations in current visible range to show updated borders
      const startFrame = Math.min(...visibleFrameIndices)
      const endFrame = Math.max(...visibleFrameIndices)
      await loadAnnotations(startFrame, endFrame)

      // Load next annotation
      const nextResponse = await fetch(`/api/annotations/${encodedVideoId}/next`)
      const nextData = await nextResponse.json()

      if (nextData.annotation) {
        setActiveAnnotation(nextData.annotation)
        setCurrentFrameIndex(nextData.annotation.start_frame_index)
        setMarkedStart(nextData.annotation.start_frame_index)
        setMarkedEnd(nextData.annotation.end_frame_index)

        // After save, we know there's a previous (the one we just saved)
        setHasPrevAnnotation(true)
        setHasNextAnnotation(false)
      } else {
        // No more annotations - workflow complete
        setActiveAnnotation(null)
        setMarkedStart(null)
        setMarkedEnd(null)
        setHasPrevAnnotation(false)
        setHasNextAnnotation(false)
      }
    } catch (error) {
      console.error('Failed to save annotation:', error)
    }
  }, [canSave, markedStart, markedEnd, videoId, activeAnnotation, updateProgress, visibleFrameIndices, loadAnnotations])

  // Keyboard event handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in input/textarea
      if (document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.tagName === 'TEXTAREA') {
        return
      }

      const key = e.key.toLowerCase()

      // Navigation
      if (key === 'arrowdown' || key === 'arrowright') {
        e.preventDefault()
        const jump = e.ctrlKey ? 50 : e.shiftKey ? 10 : 1
        navigateFrame(jump)
      } else if (key === 'arrowup' || key === 'arrowleft') {
        e.preventDefault()
        const jump = e.ctrlKey ? 50 : e.shiftKey ? 10 : 1
        navigateFrame(-jump)
      }

      // Marking
      else if (key === 'a') {
        e.preventDefault()
        jumpToStart()
      } else if (key === 's') {
        e.preventDefault()
        markStart()
      } else if (key === 'd') {
        e.preventDefault()
        markEnd()
      } else if (key === 'f') {
        e.preventDefault()
        jumpToEnd()
      }

      // Actions
      else if (key === 'enter') {
        e.preventDefault()
        saveAnnotation()
      } else if (key === 'escape') {
        e.preventDefault()
        clearMarks()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigateFrame, markStart, markEnd, jumpToStart, jumpToEnd, saveAnnotation, clearMarks])

  // Mouse wheel handler for frame navigation
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // Check if we're over the frame container
      const target = e.target as HTMLElement
      if (target.closest('.frame-stack-container')) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? 1 : -1
        navigateFrame(delta)
      }
    }

    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [navigateFrame])

  // Load annotations in visible range
  useEffect(() => {
    if (visibleFrameIndices.length === 0) return

    const startFrame = Math.min(...visibleFrameIndices)
    const endFrame = Math.max(...visibleFrameIndices)
    loadAnnotations(startFrame, endFrame)
  }, [visibleFrameIndices, loadAnnotations])

  // Load frames for visible indices
  useEffect(() => {
    const newFrames = new Map(frames)
    const encodedVideoId = encodeURIComponent(videoId)
    visibleFrameIndices.forEach(idx => {
      if (!newFrames.has(idx)) {
        newFrames.set(idx, {
          frame_index: idx,
          image_url: `/api/frames/${encodedVideoId}/${idx}.jpg`,
          ocr_text: '' // OCR text not used in boundary workflow
        })
      }
    })
    setFrames(newFrames)
  }, [visibleFrameIndices, videoId])

  // Find annotation(s) for a given frame
  const getAnnotationsForFrame = useCallback((frameIndex: number) => {
    return annotations.filter(
      ann => frameIndex >= ann.start_frame_index && frameIndex <= ann.end_frame_index
    )
  }, [annotations])

  // Make current frame's annotation active
  const activateCurrentFrameAnnotation = useCallback(async () => {
    try {
      const encodedVideoId = encodeURIComponent(videoId)
      // Query database directly for annotations at current frame
      const response = await fetch(
        `/api/annotations/${encodedVideoId}?start=${currentFrameIndex}&end=${currentFrameIndex}`
      )
      const data = await response.json()

      if (data.annotations && data.annotations.length > 0) {
        const annotation = data.annotations[0]
        setActiveAnnotation(annotation)
        setMarkedStart(annotation.start_frame_index)
        setMarkedEnd(annotation.end_frame_index)
        await checkNavigationAvailability(annotation.id)
      }
    } catch (error) {
      console.error('Failed to activate current frame annotation:', error)
    }
  }, [currentFrameIndex, videoId, checkNavigationAvailability])

  // Check if frame is in marked range (active annotation being edited)
  const isInMarkedRange = useCallback((frameIndex: number) => {
    if (markedStart === null || markedEnd === null) return false
    return frameIndex >= markedStart && frameIndex <= markedEnd
  }, [markedStart, markedEnd])

  // Show loading state while metadata loads
  if (isLoadingMetadata) {
    return (
      <AppLayout fullScreen>
        <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              Loading video metadata...
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {videoId}
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
                  All {totalFrames.toLocaleString()} frames have been annotated. You can continue reviewing and editing as needed.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex h-full flex-1 gap-6 overflow-hidden">
          {/* Left: Frame stack (2/3 width) */}
          <div
            className={`frame-stack-container relative flex h-full w-2/3 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 cursor-${cursorStyle}`}
            onMouseDown={handleDragStart}
          >
            <div className="flex h-full flex-1 flex-col justify-center gap-1 overflow-hidden p-4">
              {visibleFrameIndices.map((frameIndex, visibleIndex) => {
                const frame = frames.get(frameIndex)
                const isCurrent = frameIndex === currentFrameIndex
                const opacity = getOpacity(frameIndex)
                const frameAnnotations = getAnnotationsForFrame(frameIndex)

                // Determine if this is part of the active annotation being edited
                const isMarkedStart = frameIndex === markedStart
                const isMarkedEnd = frameIndex === markedEnd
                const inRange = isInMarkedRange(frameIndex)

                // Find the primary annotation to display (prefer active annotation)
                const primaryAnnotation =
                  frameAnnotations.find(
                    (ann) => activeAnnotation && ann.id === activeAnnotation.id
                  ) || frameAnnotations[0]

                // Determine border classes
                let borderClasses = ''
                let borderColor = ''

                if (primaryAnnotation) {
                  borderColor = getAnnotationBorderColor(primaryAnnotation)

                  // Check if this frame is at the start or end of the annotation
                  const isAnnotationStart =
                    frameIndex === primaryAnnotation.start_frame_index
                  const isAnnotationEnd =
                    frameIndex === primaryAnnotation.end_frame_index

                  if (borderColor) {
                    // Create continuous border for the annotation
                    borderClasses = `border-l-4 border-r-4 ${borderColor}`
                    if (isAnnotationStart) {
                      borderClasses += ' border-t-4 rounded-t'
                    }
                    if (isAnnotationEnd) {
                      borderClasses += ' border-b-4 rounded-b'
                    }
                  }
                }

                // Orange border for marked range (what will be saved)
                let orangeBorderClasses = ''
                if (
                  markedStart !== null &&
                  markedEnd !== null &&
                  frameIndex >= markedStart &&
                  frameIndex <= markedEnd
                ) {
                  // Create continuous orange border around the marked range
                  orangeBorderClasses =
                    'border-l-4 border-r-4 border-orange-500'
                  if (frameIndex === markedStart) {
                    orangeBorderClasses += ' border-t-4 rounded-t'
                  }
                  if (frameIndex === markedEnd) {
                    orangeBorderClasses += ' border-b-4 rounded-b'
                  }
                }

                return (
                  <div key={frameIndex} className="relative">
                    {/* Orange border overlay (not affected by opacity) */}
                    {orangeBorderClasses && (
                      <div
                        className={`absolute inset-0 pointer-events-none z-10 ${orangeBorderClasses}`}
                        style={{ opacity: 1 }}
                      />
                    )}

                    {/* Current frame indicators - gray triangles on left and right */}
                    {isCurrent && (
                      <>
                        {/* Left triangle pointing right */}
                        <div
                          className="absolute top-1/2 -translate-y-1/2 pointer-events-none z-20"
                          style={{
                            left: '-12px',
                            width: 0,
                            height: 0,
                            borderTop: '12px solid transparent',
                            borderBottom: '12px solid transparent',
                            borderLeft: '12px solid rgb(156, 163, 175)' // gray-400
                          }}
                        />
                        {/* Right triangle pointing left */}
                        <div
                          className="absolute top-1/2 -translate-y-1/2 pointer-events-none z-20"
                          style={{
                            right: '-12px',
                            width: 0,
                            height: 0,
                            borderTop: '12px solid transparent',
                            borderBottom: '12px solid transparent',
                            borderRight: '12px solid rgb(156, 163, 175)' // gray-400
                          }}
                        />
                      </>
                    )}

                    {/* Frame container */}
                    <div
                      onClick={() => {
                        setMarkedStart(frameIndex)
                        // Reset end if it's before the new start
                        if (markedEnd !== null && frameIndex > markedEnd) {
                          setMarkedEnd(null)
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setMarkedEnd(frameIndex)
                        // Reset start if it's after the new end
                        if (markedStart !== null && frameIndex < markedStart) {
                          setMarkedStart(null)
                        }
                      }}
                      style={{ opacity }}
                      className={`relative overflow-hidden cursor-pointer ${borderClasses}`}
                    >
                      {/* Frame image */}
                      {frame ? (
                        <img
                          src={frame.image_url}
                          alt={`Frame ${frameIndex}`}
                          className="w-full"
                          draggable={false}
                          onError={(e) => {
                            // Fallback for missing images
                            const target = e.target as HTMLImageElement
                            target.style.display = 'none'
                            target.parentElement!.innerHTML += `
                                <div class="flex h-24 items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                                  Frame ${frameIndex}
                                </div>
                              `
                          }}
                        />
                      ) : (
                        <div className="flex h-24 items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                          Loading frame {frameIndex}...
                        </div>
                      )}
                    </div>

                    {/* Border connector to next frame in marked range */}
                    {orangeBorderClasses &&
                      frameIndex !== markedEnd &&
                      visibleIndex < visibleFrameIndices.length - 1 && (
                        <div
                          className="absolute left-0 right-0 border-l-4 border-r-4 border-orange-500 pointer-events-none"
                          style={{ top: '100%', height: '0.5rem', opacity: 1 }}
                        />
                      )}

                    {/* Border connector for regular annotation borders */}
                    {primaryAnnotation &&
                      borderColor &&
                      frameIndex !== primaryAnnotation.end_frame_index &&
                      visibleIndex < visibleFrameIndices.length - 1 && (
                        <div
                          className={`absolute left-0 right-0 border-l-4 border-r-4 ${borderColor} pointer-events-none`}
                          style={{ top: '100%', height: '0.25rem', opacity }}
                        />
                      )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right: Controls (1/3 width) */}
          <div className="flex h-full w-1/3 flex-col gap-4 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            {/* Mode toggle */}
            <div className="flex gap-2 rounded-md border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
              <button className="flex-1 rounded py-2 text-sm font-semibold bg-teal-600 text-white">
                Boundaries
              </button>
              <button className="flex-1 rounded py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
                Text Correction
              </button>
            </div>

            {/* Video info */}
            <div>
              <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                Video
              </div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {videoId}
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Frame: {currentFrameIndex.toLocaleString()} /{' '}
                {totalFrames.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                Progress: {(workflowProgress || 0).toFixed(2)}% (
                {(completedFrames || 0).toLocaleString()} /{' '}
                {totalFrames.toLocaleString()} completed)
              </div>

              {/* Jump to frame */}
              <div className="mt-3 flex gap-2">
                <input
                  type="number"
                  value={jumpToFrameInput}
                  onChange={(e) => setJumpToFrameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && jumpToFrame()}
                  placeholder="Frame #"
                  className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
                <button
                  onClick={jumpToFrame}
                  disabled={!jumpToFrameInput}
                  className={`rounded-md px-3 py-1 text-sm font-medium ${
                    jumpToFrameInput
                      ? 'bg-teal-600 text-white hover:bg-teal-700'
                      : 'cursor-not-allowed bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-600'
                  }`}
                >
                  Jump
                </button>
              </div>

              {/* Activate current frame's annotation */}
              <button
                onClick={activateCurrentFrameAnnotation}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Activate Current Frame
              </button>
            </div>

            {/* Frame spacing */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                Frame Spacing
              </label>
              <select
                value={frameSpacing}
                onChange={(e) =>
                  setFrameSpacing(e.target.value as FrameSpacing)
                }
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              >
                <option value="linear">Linear (1,1,1...)</option>
                <option value="exponential">Exponential (1,2,4,8...)</option>
                <option value="hybrid">Hybrid (1,2,3,5,10...)</option>
              </select>
            </div>

            {/* Boundaries */}
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Boundaries
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">
                    Start:
                  </span>
                  <span className="font-mono font-semibold text-gray-900 dark:text-white">
                    {markedStart ?? 'not set'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">End:</span>
                  <span className="font-mono font-semibold text-gray-900 dark:text-white">
                    {markedEnd ?? 'not set'}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={jumpToStart}
                  disabled={!activeAnnotation}
                  className={`rounded-md border px-3 py-2 text-sm font-medium ${
                    activeAnnotation
                      ? 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                      : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600'
                  }`}
                >
                  Jump Start <span className="text-xs text-gray-500">(A)</span>
                </button>
                <button
                  onClick={markStart}
                  disabled={!activeAnnotation}
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${
                    activeAnnotation
                      ? 'bg-orange-500 text-white hover:bg-orange-600'
                      : 'cursor-not-allowed bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-600'
                  }`}
                >
                  Mark Start <span className="text-xs opacity-75">(S)</span>
                </button>
                <button
                  onClick={jumpToEnd}
                  disabled={!activeAnnotation}
                  className={`rounded-md border px-3 py-2 text-sm font-medium ${
                    activeAnnotation
                      ? 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                      : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600'
                  }`}
                >
                  Jump End <span className="text-xs text-gray-500">(F)</span>
                </button>
                <button
                  onClick={markEnd}
                  disabled={!activeAnnotation}
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${
                    activeAnnotation
                      ? 'bg-orange-500 text-white hover:bg-orange-600'
                      : 'cursor-not-allowed bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-600'
                  }`}
                >
                  Mark End <span className="text-xs opacity-75">(D)</span>
                </button>
              </div>

              <button
                onClick={clearMarks}
                disabled={!activeAnnotation}
                className={`mt-2 w-full rounded-md border px-4 py-2 text-sm font-medium ${
                  activeAnnotation
                    ? 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                    : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600'
                }`}
              >
                Clear Marks
              </button>
            </div>

            {/* Active annotation info */}
            {activeAnnotation && (
              <div className="space-y-3">
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950">
                  <div className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Active Annotation
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">
                        State:
                      </span>
                      <span className="font-semibold text-gray-900 dark:text-white capitalize">
                        {getEffectiveState(activeAnnotation)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">
                        Range:
                      </span>
                      <span className="font-mono text-gray-900 dark:text-white">
                        {activeAnnotation.start_frame_index}-
                        {activeAnnotation.end_frame_index}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">
                        Frames:
                      </span>
                      <span className="font-mono text-gray-900 dark:text-white">
                        {activeAnnotation.end_frame_index -
                          activeAnnotation.start_frame_index +
                          1}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <button
                  onClick={saveAnnotation}
                  disabled={!canSave}
                  className={`w-full rounded-md px-4 py-2 text-sm font-semibold text-white ${
                    canSave
                      ? 'bg-teal-600 hover:bg-teal-700'
                      : 'cursor-not-allowed bg-gray-400 dark:bg-gray-700'
                  }`}
                >
                  Save & Next{' '}
                  <span className="text-xs opacity-75">(Enter)</span>
                </button>

                {/* History Navigation */}
                <div className="flex gap-2">
                  <button
                    onClick={() => navigateToAnnotation('prev')}
                    disabled={!hasPrevAnnotation}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                      hasPrevAnnotation
                        ? 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                        : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600'
                    }`}
                  >
                    ← Previous
                  </button>
                  <button
                    onClick={() => navigateToAnnotation('next')}
                    disabled={!hasNextAnnotation}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                      hasNextAnnotation
                        ? 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                        : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600'
                    }`}
                  >
                    Next →
                  </button>
                </div>

                <button
                  onClick={deleteAnnotation}
                  disabled={
                    !activeAnnotation || activeAnnotation.state === 'gap'
                  }
                  className={`w-full rounded-md border-2 px-4 py-2 text-sm font-semibold ${
                    activeAnnotation && activeAnnotation.state !== 'gap'
                      ? 'border-red-500 text-red-600 hover:bg-red-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-950'
                      : 'cursor-not-allowed border-gray-300 text-gray-400 dark:border-gray-700 dark:text-gray-600'
                  }`}
                >
                  Delete Caption
                </button>
              </div>
            )}

            {/* Help button */}
            <button
              onClick={() => setShowHelpModal(true)}
              className="w-full rounded-md border border-teal-500 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100 dark:border-teal-600 dark:bg-teal-950 dark:text-teal-300 dark:hover:bg-teal-900"
            >
              📖 Annotation Guide
            </button>

            {/* Mouse shortcuts */}
            <details className="rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950">
              <summary className="cursor-pointer p-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">
                Mouse Shortcuts
              </summary>
              <div className="space-y-1 p-3 pt-1 text-xs text-gray-600 dark:text-gray-400">
                <div>
                  <strong>Navigation:</strong>
                </div>
                <div>Scroll Wheel: Navigate frames</div>
                <div>Click & Drag: Scroll with momentum</div>
                <div className="mt-2">
                  <strong>Marking:</strong>
                </div>
                <div>Left Click: Mark Start</div>
                <div>Right Click: Mark End</div>
              </div>
            </details>

            {/* Keyboard shortcuts */}
            <details className="rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950">
              <summary className="cursor-pointer p-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">
                Keyboard Shortcuts
              </summary>
              <div className="space-y-1 p-3 pt-1 text-xs text-gray-600 dark:text-gray-400">
                <div>
                  <strong>Navigation:</strong>
                </div>
                <div>↑/↓ or ←/→: ±1 frame</div>
                <div>Shift + Arrow: ±10 frames</div>
                <div>Ctrl + Arrow: ±50 frames</div>
                <div className="mt-2">
                  <strong>Marking:</strong>
                </div>
                <div>A: Jump to Start</div>
                <div>S: Mark Start</div>
                <div>D: Mark End</div>
                <div>F: Jump to End</div>
                <div className="mt-2">
                  <strong>Actions:</strong>
                </div>
                <div>Enter: Save & Next</div>
                <div>Esc: Clear Marks</div>
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
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Caption Annotation Guide
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
                  This page helps you review and correct frame range boundaries
                  for video content. Each annotation is either a single
                  caption&apos;s range or a single non-caption range between
                  captions.
                </p>
                <p className="mt-2">
                  <strong>Important:</strong> The bounds should include both the
                  start and end frames of the range, as shown by the colored
                  border around the frames.
                </p>
              </section>

              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Annotation Types
                </h3>
                <div className="space-y-3">
                  <div className="rounded-md border-l-2 border-orange-500 bg-orange-50 p-3 dark:bg-orange-900">
                    <div className="font-semibold text-orange-600 dark:text-orange-200">
                      Active (Orange Border)
                    </div>
                    <p className="mt-1 text-orange-200 dark:text-orange-300">
                      The active caption that is presently editable.
                    </p>
                  </div>

                  <div className="rounded-md border-l-2 border-indigo-500 bg-indigo-50 p-3 dark:bg-indigo-950">
                    <div className="font-semibold text-indigo-900 dark:text-indigo-200">
                      Predicted (Indigo Border)
                    </div>
                    <p className="mt-1 text-indigo-800 dark:text-indigo-300">
                      Machine learning predictions for frame range boundaries
                      (captions or non-caption content). These are considered
                      complete and are not included in the review workflow.
                    </p>
                  </div>

                  <div className="rounded-md border-l-2 border-teal-500 bg-teal-50 p-3 dark:bg-teal-950">
                    <div className="font-semibold text-teal-900 dark:text-teal-200">
                      Confirmed (Teal Border)
                    </div>
                    <p className="mt-1 text-teal-800 dark:text-teal-300">
                      Human-verified annotations with correct boundaries for
                      either captions or non-caption content. These are
                      considered complete and accurate.
                    </p>
                  </div>

                  <div className="rounded-md border-l-2 border-pink-500 bg-pink-50 p-3 dark:bg-pink-950">
                    <div className="font-semibold text-pink-900 dark:text-pink-200">
                      Pending (Pink Border)
                    </div>
                    <p className="mt-1 text-pink-800 dark:text-pink-300">
                      Annotations for captions or non-caption content that need
                      review or correction. These appear in the workflow queue
                      for human verification.
                    </p>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Gaps
                </h3>
                <p>
                  Gaps are frame ranges that haven&apos;t been assigned yet.
                  They appear in the workflow queue so you can determine what
                  type of content they contain and annotate them accordingly.
                </p>
              </section>

              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Workflow
                </h3>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>
                    Review the active annotation or gap shown with a colored
                    border
                  </li>
                  <li>
                    Navigate through frames using scroll wheel, drag, or
                    keyboard shortcuts
                  </li>
                  <li>
                    Adjust boundaries using Mark Start/End buttons or (left,
                    right) mouse clicks
                  </li>
                  <li>
                    The orange border shows the range that will be saved as the
                    caption / non-caption
                  </li>
                  <li>
                    Click &ldquo;Save &amp; Next&rdquo; to confirm and move to
                    the next annotation
                  </li>
                  <li>
                    Use &ldquo;Clear Marks&rdquo; to reset to original
                    boundaries if needed
                  </li>
                </ol>
              </section>

              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Rules &amp; Tips
                </h3>
                <ul className="list-disc space-y-2 pl-5">
                  <li>
                    Boundaries must include both start and end frames
                    (inclusive)
                  </li>
                  <li>A caption can be a single frame (start = end)</li>
                  <li>
                    Annotations cannot overlap - each frame belongs to exactly
                    one annotation
                  </li>
                  <li>
                    A caption can be set to overlap with another caption - that
                    caption will be adjusted and set to Pending status
                  </li>
                  <li>
                    The teal ring highlights the currently displayed frame
                  </li>
                  <li>
                    Use frame spacing controls to adjust visible frame density
                  </li>
                  <li>
                    Progress tracks the percentage of confirmed and predicted
                    frames
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
