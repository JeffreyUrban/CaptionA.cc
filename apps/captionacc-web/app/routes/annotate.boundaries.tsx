import { useState, useEffect, useMemo, useCallback } from 'react'
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
  video_id: string
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
    case 'predicted': return 'border-blue-500'
    case 'confirmed': return 'border-green-500'
    case 'gap': return ''
  }
}

export default function BoundaryWorkflow() {
  // State
  const [videoId, setVideoId] = useState('a_bite_of_china/3')
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

  const [frameSpacing, setFrameSpacing] = useState<FrameSpacing>('linear')
  const [windowHeight, setWindowHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 1000)
  const [jumpToFrameInput, setJumpToFrameInput] = useState('')

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
    const availableHeight = windowHeight - navbarHeight

    // Estimate frame height: ~80-120px depending on aspect ratio
    // Using 90px as conservative estimate to ensure we fill the height
    const estimatedFrameHeight = 90

    // Calculate how many frames we need to fill the height
    const framesToFill = Math.ceil(availableHeight / estimatedFrameHeight)

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

  // Can save if both boundaries marked
  const canSave = markedStart !== null && markedEnd !== null && markedStart < markedEnd

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
    setMarkedStart(null)
    setMarkedEnd(null)
  }, [])

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
  }, [activeAnnotation, videoId])

  // Save annotation
  const saveAnnotation = useCallback(async () => {
    if (!canSave || !activeAnnotation) return

    // TODO: Implement full save logic with overlap resolution
    console.log('Saving annotation:', {
      id: activeAnnotation.id,
      start_frame_index: markedStart,
      end_frame_index: markedEnd
    })

    // For now, just load the next annotation
    try {
      const encodedVideoId = encodeURIComponent(videoId)
      const response = await fetch(`/api/annotations/${encodedVideoId}/next`)
      const data = await response.json()

      if (data.annotation) {
        setActiveAnnotation(data.annotation)
        setCurrentFrameIndex(data.annotation.start_frame_index)
        setMarkedStart(data.annotation.start_frame_index)
        setMarkedEnd(data.annotation.end_frame_index)

        // After save, we know there's a previous (the one we just saved)
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
      console.error('Failed to load next annotation:', error)
    }
  }, [canSave, markedStart, markedEnd, videoId, activeAnnotation])

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

    const loadAnnotations = async () => {
      const startFrame = Math.min(...visibleFrameIndices)
      const endFrame = Math.max(...visibleFrameIndices)
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
    }

    loadAnnotations()
  }, [visibleFrameIndices, videoId])

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
        {/* Main content */}
        <div className="flex h-full flex-1 gap-6 overflow-hidden">
          {/* Left: Frame stack (2/3 width) */}
          <div className="frame-stack-container flex h-full w-2/3 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex h-full flex-1 flex-col justify-center gap-1 overflow-hidden p-4">
                {visibleFrameIndices.map(frameIndex => {
                  const frame = frames.get(frameIndex)
                  const isCurrent = frameIndex === currentFrameIndex
                  const opacity = getOpacity(frameIndex)
                  const frameAnnotations = getAnnotationsForFrame(frameIndex)

                  // Determine if this is part of the active annotation being edited
                  const isMarkedStart = frameIndex === markedStart
                  const isMarkedEnd = frameIndex === markedEnd
                  const inRange = isInMarkedRange(frameIndex)

                  // Find the primary annotation to display (prefer active annotation)
                  const primaryAnnotation = frameAnnotations.find(
                    ann => activeAnnotation && ann.id === activeAnnotation.id
                  ) || frameAnnotations[0]

                  // Determine border classes
                  let borderClasses = ''
                  let borderColor = ''

                  if (primaryAnnotation) {
                    borderColor = getAnnotationBorderColor(primaryAnnotation)

                    // Check if this frame is at the start or end of the annotation
                    const isAnnotationStart = frameIndex === primaryAnnotation.start_frame_index
                    const isAnnotationEnd = frameIndex === primaryAnnotation.end_frame_index

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

                  // Background color for frames in the editing range
                  let bgColor = ''
                  if (inRange && activeAnnotation) {
                    bgColor = 'bg-orange-50 dark:bg-orange-950'
                  }

                  return (
                    <div
                      key={frameIndex}
                      className="relative"
                      style={{ opacity }}
                    >
                      {/* Frame container */}
                      <div
                        className={`relative overflow-hidden ${
                          isCurrent ? 'ring-4 ring-teal-500 rounded' : ''
                        } ${bgColor} ${borderClasses}`}
                      >
                        {/* Frame image */}
                        {frame ? (
                          <img
                            src={frame.image_url}
                            alt={`Frame ${frameIndex}`}
                            className="w-full"
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
              <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">Video</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">{videoId}</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Frame: {currentFrameIndex.toLocaleString()} / {totalFrames.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                Progress: {((currentFrameIndex / totalFrames) * 100).toFixed(2)}%
              </div>

              {/* Jump to frame */}
              <div className="mt-3 flex gap-2">
                <input
                  type="number"
                  value={jumpToFrameInput}
                  onChange={e => setJumpToFrameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && jumpToFrame()}
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
            </div>

            {/* Frame spacing */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                Frame Spacing
              </label>
              <select
                value={frameSpacing}
                onChange={e => setFrameSpacing(e.target.value as FrameSpacing)}
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
                  <span className="text-gray-600 dark:text-gray-400">Start:</span>
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
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Jump Start <span className="text-xs text-gray-500">(A)</span>
                </button>
                <button
                  onClick={markStart}
                  className="rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-600"
                >
                  Mark Start <span className="text-xs opacity-75">(S)</span>
                </button>
                <button
                  onClick={jumpToEnd}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Jump End <span className="text-xs text-gray-500">(F)</span>
                </button>
                <button
                  onClick={markEnd}
                  className="rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-600"
                >
                  Mark End <span className="text-xs opacity-75">(D)</span>
                </button>
              </div>

              <button
                onClick={clearMarks}
                className="mt-2 w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
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
                      <span className="text-gray-600 dark:text-gray-400">State:</span>
                      <span className="font-semibold text-gray-900 dark:text-white capitalize">
                        {getEffectiveState(activeAnnotation)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Range:</span>
                      <span className="font-mono text-gray-900 dark:text-white">
                        {activeAnnotation.start_frame_index}-{activeAnnotation.end_frame_index}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Frames:</span>
                      <span className="font-mono text-gray-900 dark:text-white">
                        {activeAnnotation.end_frame_index - activeAnnotation.start_frame_index + 1}
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
                  Save & Next <span className="text-xs opacity-75">(Enter)</span>
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
                  disabled={!activeAnnotation || activeAnnotation.state === 'gap'}
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


            {/* Keyboard shortcuts */}
            <details className="rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950">
              <summary className="cursor-pointer p-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">
                Keyboard Shortcuts
              </summary>
              <div className="space-y-1 p-3 pt-1 text-xs text-gray-600 dark:text-gray-400">
                <div><strong>Navigation:</strong></div>
                <div>↑/↓ or ←/→: ±1 frame</div>
                <div>Shift + Arrow: ±10 frames</div>
                <div>Ctrl + Arrow: ±50 frames</div>
                <div className="mt-2"><strong>Marking:</strong></div>
                <div>A: Jump to Start</div>
                <div>S: Mark Start</div>
                <div>D: Mark End</div>
                <div>F: Jump to End</div>
                <div className="mt-2"><strong>Actions:</strong></div>
                <div>Enter: Save & Next</div>
                <div>Esc: Clear Marks</div>
              </div>
            </details>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
