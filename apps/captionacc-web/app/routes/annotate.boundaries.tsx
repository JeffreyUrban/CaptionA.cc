import { useState, useEffect, useMemo, useCallback, useRef, startTransition } from 'react'
import { useSearchParams } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { BoundaryActionButtons } from '~/components/annotation/BoundaryActionButtons'
import { BoundaryAnnotationInfo } from '~/components/annotation/BoundaryAnnotationInfo'
import { BoundaryFrameStack } from '~/components/annotation/BoundaryFrameStack'
import { BoundaryHelpModal } from '~/components/annotation/BoundaryHelpModal'
import { BoundaryMarkingControls } from '~/components/annotation/BoundaryMarkingControls'
import { BoundaryShortcutsPanel } from '~/components/annotation/BoundaryShortcutsPanel'
import { BoundarySpacingControl } from '~/components/annotation/BoundarySpacingControl'
import { BoundaryVideoInfo } from '~/components/annotation/BoundaryVideoInfo'
import { CompletionBanner } from '~/components/annotation/CompletionBanner'
import { useKeyboardShortcuts } from '~/hooks/useKeyboardShortcuts'
import { useVideoMetadata } from '~/hooks/useVideoMetadata'
import { useVideoTouched } from '~/hooks/useVideoTouched'
import { useWorkflowProgress } from '~/hooks/useWorkflowProgress'

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
  pending: boolean // When true, annotation is treated as pending for workflow purposes
  text: string | null
  created_at?: string
  updated_at?: string
}

type FrameSpacing = 'linear' | 'exponential' | 'hybrid'

// Opacity calculation for frame distance
// Uses exponential decay to smoothly fade frames as they get farther from current
// Min opacity of 0.1 ensures distant frames remain slightly visible
const MIN_OPACITY = 0.1
const OPACITY_DECAY_RATE = 0.12

// Loader function to expose environment variables
export async function loader() {
  return {
    defaultVideoId: process.env['DEFAULT_VIDEO_ID'] ?? '',
  }
}

function getEffectiveState(annotation: Annotation): 'pending' | AnnotationState {
  return annotation.pending ? 'pending' : annotation.state
}

function getAnnotationBorderColor(annotation: Annotation): string {
  const effectiveState = getEffectiveState(annotation)
  switch (effectiveState) {
    case 'pending':
      return 'border-pink-500'
    case 'predicted':
      return 'border-indigo-500'
    case 'confirmed':
      return 'border-teal-500'
    case 'gap':
      return ''
  }
}

export default function BoundaryWorkflow() {
  const [searchParams] = useSearchParams()

  // Get videoId from URL params, fallback to empty string
  const videoIdFromUrl = searchParams.get('videoId') ?? ''

  // State
  const [videoId] = useState(videoIdFromUrl)

  // Load video metadata and workflow progress using hooks
  const { metadata, loading: isLoadingMetadata } = useVideoMetadata(videoId)
  const {
    workflowProgress: workflowProgressHook,
    completedFrames: completedFramesHook,
    updateProgress,
  } = useWorkflowProgress(videoId)

  // Extract metadata values (with defaults for loading state)
  const totalFrames = metadata?.totalFrames ?? 0
  const cropWidth = metadata?.cropWidth ?? 0
  const cropHeight = metadata?.cropHeight ?? 0

  // Internal state (refs - updated by events, never trigger renders)
  const currentFrameIndexRef = useRef(0)
  const framesRef = useRef<Map<number, Frame>>(new Map())
  const annotationsRef = useRef<Annotation[]>([])
  const activeAnnotationRef = useRef<Annotation | null>(null)
  const markedStartRef = useRef<number | null>(null)
  const markedEndRef = useRef<number | null>(null)
  const hasPrevAnnotationRef = useRef(false)
  const hasNextAnnotationRef = useRef(false)
  const workflowProgressRef = useRef(0)
  const completedFramesRef = useRef(0)
  const cursorStyleRef = useRef<'grab' | 'grabbing'>('grab')

  // Display state (ONLY updated by RAF loop - single source of renders)
  const [displayState, setDisplayState] = useState({
    currentFrameIndex: 0,
    frames: new Map<number, Frame>(),
    annotations: [] as Annotation[],
    activeAnnotation: null as Annotation | null,
    markedStart: null as number | null,
    markedEnd: null as number | null,
    hasPrevAnnotation: false,
    hasNextAnnotation: false,
    workflowProgress: 0,
    completedFrames: 0,
    cursorStyle: 'grab' as 'grab' | 'grabbing',
  })

  // Extract for convenience in render
  const currentFrameIndex = displayState.currentFrameIndex
  const frames = displayState.frames
  const annotations = displayState.annotations
  const activeAnnotation = displayState.activeAnnotation
  const markedStart = displayState.markedStart
  const markedEnd = displayState.markedEnd
  const hasPrevAnnotation = displayState.hasPrevAnnotation
  const hasNextAnnotation = displayState.hasNextAnnotation
  const workflowProgress = displayState.workflowProgress
  const completedFrames = displayState.completedFrames
  const cursorStyle = displayState.cursorStyle

  const [frameSpacing, setFrameSpacing] = useState<FrameSpacing>('linear')
  const [windowHeight, setWindowHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 1000
  )
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

  // Cleanup momentum animation on unmount
  useEffect(() => {
    return () => {
      if (momentumFrameRef.current !== null) {
        cancelAnimationFrame(momentumFrameRef.current)
      }
    }
  }, [])

  // Sync hook values to refs (for RAF loop)
  useEffect(() => {
    workflowProgressRef.current = workflowProgressHook
    completedFramesRef.current = completedFramesHook
  }, [workflowProgressHook, completedFramesHook])

  // Load initial annotation on mount (metadata and progress loaded by hooks)
  useEffect(() => {
    if (!videoId) return

    const loadInitialAnnotation = async () => {
      try {
        // URL encode the videoId to handle slashes
        const encodedVideoId = encodeURIComponent(videoId)

        // Load next annotation to work on
        const nextResponse = await fetch(`/api/annotations/${encodedVideoId}/next`)
        const nextData = await nextResponse.json()

        if (nextData.annotation) {
          activeAnnotationRef.current = nextData.annotation
          currentFrameIndexRef.current = nextData.annotation.start_frame_index
          markedStartRef.current = nextData.annotation.start_frame_index
          markedEndRef.current = nextData.annotation.end_frame_index

          // Initial load: check if there's any other annotation (most recently updated)
          // We need to check all annotations, not just ones before this timestamp
          const allAnnotationsResponse = await fetch(
            `/api/annotations/${encodedVideoId}?start=0&end=999999`
          )
          const allAnnotationsData = await allAnnotationsResponse.json()
          // Check if there's at least one other annotation besides the active one
          hasPrevAnnotationRef.current =
            allAnnotationsData.annotations && allAnnotationsData.annotations.length > 1
          hasNextAnnotationRef.current = false
        }
      } catch (error) {
        console.error('Failed to load initial annotation:', error)
      }
    }
    void loadInitialAnnotation()
  }, [videoId])

  // Helper: Load annotations for visible range
  const loadAnnotations = useCallback(
    async (startFrame: number, endFrame: number) => {
      const encodedVideoId = encodeURIComponent(videoId)

      try {
        const response = await fetch(
          `/api/annotations/${encodedVideoId}?start=${startFrame}&end=${endFrame}`
        )
        const data = await response.json()
        annotationsRef.current = data.annotations ?? []
      } catch (error) {
        console.error('Failed to load annotations:', error)
      }
    },
    [videoId]
  )

  // Mark this video as being worked on for stats refresh on Videos page
  useVideoTouched(videoId)

  // Track window height for dynamic frame count
  useEffect(() => {
    if (typeof window === 'undefined') return

    setWindowHeight(window.innerHeight)
    const handleResize = () => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Computed: visible frame positions (always sequential)
  const visibleFramePositions = useMemo(() => {
    // Calculate available height: total window height minus navbar (64px) and padding
    const navbarHeight = 64
    const safeWindowHeight = Math.max(windowHeight, 400)
    const availableHeight = Math.max(safeWindowHeight - navbarHeight, 300)

    // Calculate actual frame height based on crop dimensions and container width
    const containerWidth = (typeof window !== 'undefined' ? window.innerWidth : 1000) * (2 / 3) - 32
    const frameHeight =
      cropWidth > 0 && cropHeight > 0 ? (containerWidth * cropHeight) / cropWidth : 90
    const frameHeightWithGap = frameHeight + 4

    // Calculate how many slots we need to fill the height
    const totalSlots = Math.max(Math.ceil(availableHeight / frameHeightWithGap), 3)

    // Generate sequential frame positions centered on current frame
    // These positions are always sequential: [..., 98, 99, 100, 101, 102, ...]
    const positions: number[] = []
    for (let i = 0; i < totalSlots; i++) {
      const position = currentFrameIndex + i - Math.floor(totalSlots / 2)
      const clampedPosition = Math.max(0, Math.min(position, totalFrames - 1))
      positions.push(clampedPosition)
    }

    return positions
  }, [currentFrameIndex, totalFrames, windowHeight, cropWidth, cropHeight])

  // Get opacity for frame distance
  // Uses exponential decay: opacity = max(MIN_OPACITY, e^(-DECAY_RATE * distance))
  const getOpacity = useCallback(
    (frameIndex: number) => {
      const distance = Math.abs(frameIndex - currentFrameIndex)
      if (distance === 0) return 1.0
      const opacity = Math.exp(-OPACITY_DECAY_RATE * distance)
      return Math.max(MIN_OPACITY, opacity)
    },
    [currentFrameIndex]
  )

  // Can save if both boundaries marked (single frame captions allowed: start == end)
  const canSave = markedStart !== null && markedEnd !== null && markedStart <= markedEnd

  // Navigation functions
  const navigateFrame = useCallback(
    (delta: number) => {
      const newIndex = Math.max(0, Math.min(currentFrameIndexRef.current + delta, totalFrames - 1))
      currentFrameIndexRef.current = newIndex
    },
    [totalFrames]
  )

  // Marking functions
  const markStart = useCallback(() => {
    markedStartRef.current = currentFrameIndex
    // If marking start after current end, clear end to prevent invalid order
    if (markedEnd !== null && currentFrameIndex > markedEnd) {
      markedEndRef.current = null
    }
  }, [currentFrameIndex, markedEnd])

  const markEnd = useCallback(() => {
    markedEndRef.current = currentFrameIndex
    // If marking end before current start, clear start to prevent invalid order
    if (markedStart !== null && currentFrameIndex < markedStart) {
      markedStartRef.current = null
    }
  }, [currentFrameIndex, markedStart])

  const jumpToStart = useCallback(() => {
    if (markedStart !== null) {
      currentFrameIndexRef.current = markedStart
    }
  }, [markedStart])

  const jumpToEnd = useCallback(() => {
    if (markedEnd !== null) {
      currentFrameIndexRef.current = markedEnd
    }
  }, [markedEnd])

  const clearMarks = useCallback(() => {
    // Reset marks to original annotation boundaries (cancel any changes)
    if (activeAnnotation) {
      markedStartRef.current = activeAnnotation.start_frame_index
      markedEndRef.current = activeAnnotation.end_frame_index
    }
  }, [activeAnnotation])

  const setCurrentFrameIndex = useCallback((newIndex: number) => {
    // Update ref only - no render (RAF loop handles display)
    currentFrameIndexRef.current = newIndex
  }, [])

  // Drag-to-scroll handlers
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
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
      cursorStyleRef.current = 'grabbing'

      // Add global listeners for move and up
      const handleMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) return

        const now = Date.now()
        const deltaY = dragStartYRef.current - moveEvent.clientY
        const frameDelta = Math.round(deltaY / 30) // 30 pixels per frame
        const newFrame = Math.max(
          0,
          Math.min(dragStartFrameRef.current + frameDelta, totalFrames - 1)
        )

        // Calculate velocity for momentum
        const timeDelta = now - lastTimeRef.current
        if (timeDelta > 0) {
          const yDelta = lastYRef.current - moveEvent.clientY
          velocityRef.current = ((yDelta / timeDelta) * 16) / 30 // Convert to frames per 16ms
        }

        lastYRef.current = moveEvent.clientY
        lastTimeRef.current = now
        setCurrentFrameIndex(newFrame)
      }

      const handleUp = () => {
        if (!isDraggingRef.current) return
        isDraggingRef.current = false
        cursorStyleRef.current = 'grab'

        // Remove listeners
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)

        // Apply momentum with fractional position tracking
        const initialVelocity = velocityRef.current
        if (Math.abs(initialVelocity) > 0.01) {
          let velocity = initialVelocity
          let position = currentFrameIndex // Track fractional position
          const friction = 0.95 // Friction factor for smooth deceleration

          const animate = () => {
            velocity *= friction

            // Stop when velocity becomes negligible
            if (Math.abs(velocity) < 0.001) {
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
    },
    [currentFrameIndex, totalFrames, setCurrentFrameIndex]
  )

  // Helper to check navigation availability
  const checkNavigationAvailability = useCallback(
    async (annotationId: number) => {
      const encodedVideoId = encodeURIComponent(videoId)

      try {
        // Check for previous
        const prevResponse = await fetch(
          `/api/annotations/${encodedVideoId}/navigate?direction=prev&currentId=${annotationId}`
        )
        const prevData = await prevResponse.json()
        hasPrevAnnotationRef.current = !!prevData.annotation

        // Check for next
        const nextResponse = await fetch(
          `/api/annotations/${encodedVideoId}/navigate?direction=next&currentId=${annotationId}`
        )
        const nextData = await nextResponse.json()
        hasNextAnnotationRef.current = !!nextData.annotation
      } catch (error) {
        console.error('Failed to check navigation:', error)
      }
    },
    [videoId]
  )

  // Navigate to previous/next annotation by updated_at time
  const navigateToAnnotation = useCallback(
    async (direction: 'prev' | 'next') => {
      if (!activeAnnotation) return

      try {
        const encodedVideoId = encodeURIComponent(videoId)
        const response = await fetch(
          `/api/annotations/${encodedVideoId}/navigate?direction=${direction}&currentId=${activeAnnotation.id}`
        )
        const data = await response.json()

        if (data.annotation) {
          activeAnnotationRef.current = data.annotation
          currentFrameIndexRef.current = data.annotation.start_frame_index
          markedStartRef.current = data.annotation.start_frame_index
          markedEndRef.current = data.annotation.end_frame_index

          // After navigating, check both directions
          void checkNavigationAvailability(data.annotation.id)
        }
      } catch (error) {
        console.error(`Failed to navigate to ${direction} annotation:`, error)
      }
    },
    [activeAnnotation, videoId, checkNavigationAvailability]
  )

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
        activeAnnotationRef.current = annotation
        currentFrameIndexRef.current = frameNumber
        markedStartRef.current = annotation.start_frame_index
        markedEndRef.current = annotation.end_frame_index

        // After jumping, check navigation availability
        void checkNavigationAvailability(annotation.id)
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
        activeAnnotationRef.current = nextData.annotation
        currentFrameIndexRef.current = nextData.annotation.start_frame_index
        markedStartRef.current = nextData.annotation.start_frame_index
        markedEndRef.current = nextData.annotation.end_frame_index

        // After delete, we know there's a previous (the deleted one became a gap)
        // and no next (we loaded the next pending/gap)
        hasPrevAnnotationRef.current = true
        hasNextAnnotationRef.current = false
      } else {
        // No more annotations - workflow complete
        activeAnnotationRef.current = null
        markedStartRef.current = null
        markedEndRef.current = null
        hasPrevAnnotationRef.current = false
        hasNextAnnotationRef.current = false
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
          pending: false,
        }),
      })

      if (!saveResponse.ok) {
        throw new Error('Failed to save annotation')
      }

      // Update progress from database
      await updateProgress()

      // Reload annotations in current visible range to show updated borders
      const startFrame = Math.min(...visibleFramePositions)
      const endFrame = Math.max(...visibleFramePositions)
      await loadAnnotations(startFrame, endFrame)

      // Load next annotation
      const nextResponse = await fetch(`/api/annotations/${encodedVideoId}/next`)
      const nextData = await nextResponse.json()

      if (nextData.annotation) {
        activeAnnotationRef.current = nextData.annotation
        currentFrameIndexRef.current = nextData.annotation.start_frame_index
        markedStartRef.current = nextData.annotation.start_frame_index
        markedEndRef.current = nextData.annotation.end_frame_index

        // After save, we know there's a previous (the one we just saved)
        hasPrevAnnotationRef.current = true
        hasNextAnnotationRef.current = false
      } else {
        // No more annotations - workflow complete
        activeAnnotationRef.current = null
        markedStartRef.current = null
        markedEndRef.current = null
        hasPrevAnnotationRef.current = false
        hasNextAnnotationRef.current = false
      }
    } catch (error) {
      console.error('Failed to save annotation:', error)
    }
  }, [
    canSave,
    markedStart,
    markedEnd,
    videoId,
    activeAnnotation,
    updateProgress,
    visibleFramePositions,
    loadAnnotations,
  ])

  // Keyboard event handler
  useKeyboardShortcuts(
    e => {
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
        void saveAnnotation()
      } else if (key === 'escape') {
        e.preventDefault()
        clearMarks()
      }
    },
    [navigateFrame, markStart, markEnd, jumpToStart, jumpToEnd, saveAnnotation, clearMarks]
  )

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
    if (visibleFramePositions.length === 0) return

    const startFrame = Math.min(...visibleFramePositions)
    const endFrame = Math.max(...visibleFramePositions)
    void loadAnnotations(startFrame, endFrame)
  }, [visibleFramePositions, loadAnnotations])

  // LRU cache of loaded chunks per modulo to avoid reloading
  // Map: modulo → array of chunk start positions (most recent at end)
  const loadedChunksRef = useRef<Map<number, number[]>>(new Map())
  // Track chunks currently being fetched (not yet received)
  const requestedChunksRef = useRef<Map<number, Set<number>>>(new Map())
  const MAX_CHUNKS_PER_MODULO = 5

  // RAF render loop - ONLY source of renders
  // Throttled to 60fps, only updates when data changes
  useEffect(() => {
    let rafId: number
    let lastUpdateTime = 0
    let lastFrameIndex = 0
    let lastFrameCount = 0
    const targetFps = 60
    const frameInterval = 1000 / targetFps // ~16ms

    const loop = (currentTime: number) => {
      const timeSinceUpdate = currentTime - lastUpdateTime

      // Check if data changed OR enough time passed for 60fps
      const frameIndex = currentFrameIndexRef.current
      const frameCount = framesRef.current.size
      const dataChanged = frameIndex !== lastFrameIndex || frameCount !== lastFrameCount

      if (dataChanged && timeSinceUpdate >= frameInterval) {
        // Update display from ALL refs (non-urgent, batched by React 18)
        startTransition(() => {
          setDisplayState({
            currentFrameIndex: currentFrameIndexRef.current,
            frames: new Map(framesRef.current),
            annotations: [...annotationsRef.current],
            activeAnnotation: activeAnnotationRef.current,
            markedStart: markedStartRef.current,
            markedEnd: markedEndRef.current,
            hasPrevAnnotation: hasPrevAnnotationRef.current,
            hasNextAnnotation: hasNextAnnotationRef.current,
            workflowProgress: workflowProgressRef.current,
            completedFrames: completedFramesRef.current,
            cursorStyle: cursorStyleRef.current,
          })
        })

        lastUpdateTime = currentTime
        lastFrameIndex = frameIndex
        lastFrameCount = frameCount
      }

      // Continue loop
      rafId = requestAnimationFrame(loop)
    }

    // Start loop
    rafId = requestAnimationFrame(loop)

    // Cleanup on unmount
    return () => cancelAnimationFrame(rafId)
  }, []) // Run once on mount

  // Load frames with priority queue: prioritize high modulo, filter by range from current frame
  useEffect(() => {
    // Skip loading until initial metadata and annotation are loaded
    if (isLoadingMetadata) return

    let cancelled = false

    const loadFrameHierarchy = async () => {
      if (cancelled) return
      const encodedVideoId = encodeURIComponent(videoId)
      const MAX_CONCURRENT = 6

      // Modulo levels with their preload ranges
      const moduloLevels: Array<{ modulo: number; range: number }> = [
        { modulo: 32, range: 1024 },
        { modulo: 16, range: 512 },
        { modulo: 8, range: 256 },
        { modulo: 4, range: 128 },
        { modulo: 2, range: 64 },
        { modulo: 1, range: 32 },
      ]

      // Build priority queue as chunks: each chunk is frames at one modulo level
      interface QueueChunk {
        modulo: number
        range: number
        frames: number[]
      }

      const buildQueueForModulo = (centerFrame: number, moduloLevelIndex: number): QueueChunk[] => {
        const chunks: QueueChunk[] = []
        const FRAMES_PER_CHUNK = 32 // Always load 32 frames per chunk
        const loadedChunks = loadedChunksRef.current
        const requestedChunks = requestedChunksRef.current

        const level = moduloLevels[moduloLevelIndex]
        if (!level) return chunks

        const { modulo, range } = level
        const rangeStart = Math.max(0, centerFrame - range)
        const rangeEnd = Math.min(totalFrames - 1, centerFrame + range)

        // Chunk size in frame indices = 32 frames × modulo spacing
        // For modulo 32: 32 frames × 32 = 1024 frame indices [0-1023]
        const chunkSize = FRAMES_PER_CHUNK * modulo

        // Align to chunk boundaries
        const firstChunkStart = Math.floor(rangeStart / chunkSize) * chunkSize
        const lastChunkStart = Math.floor(rangeEnd / chunkSize) * chunkSize

        // Get cached chunks and in-flight requests for this modulo
        const cachedChunks = loadedChunks.get(modulo) ?? []
        const inFlightChunks = requestedChunks.get(modulo) ?? new Set()

        // Collect frames in chunks of 32 frames each
        for (
          let chunkStart = firstChunkStart;
          chunkStart <= lastChunkStart;
          chunkStart += chunkSize
        ) {
          // Skip if chunk is already loaded or being fetched
          if (cachedChunks.includes(chunkStart) || inFlightChunks.has(chunkStart)) {
            continue
          }

          const chunkEnd = chunkStart + chunkSize - 1
          const chunkFrames: number[] = []

          // Collect ALL frames at modulo positions within this chunk
          // Chunks are atomic - we load all frames or none (cache check handles skip)
          for (let i = chunkStart; i <= Math.min(chunkEnd, totalFrames - 1); i++) {
            if (i % modulo === 0) {
              chunkFrames.push(i)
            }
          }

          // Add chunk if it has frames (including edge chunks with <32 frames)
          if (chunkFrames.length > 0) {
            chunks.push({
              modulo,
              range,
              frames: chunkFrames,
            })
          }
        }

        return chunks
      }

      try {
        // Progressive loading: start with coarsest modulo, move to finer levels as each completes
        let currentModuloLevel = 0
        let queue = buildQueueForModulo(currentFrameIndex, currentModuloLevel)

        // Continue while we have chunks to load or more modulo levels to try
        while (queue.length > 0 || currentModuloLevel < moduloLevels.length - 1) {
          // Check if cancelled (frame changed, new load started)
          if (cancelled) return

          // If current level complete, move to next finer level
          if (queue.length === 0) {
            currentModuloLevel++
            queue = buildQueueForModulo(currentFrameIndex, currentModuloLevel)
            if (queue.length === 0) continue // Skip to next level if nothing to load
          }

          if (queue.length === 0) break // All levels complete
          // Filter to drop entire chunks outside range of current frame
          const currentFrame = currentFrameIndexRef.current
          queue = queue.filter(chunk => {
            // Check if chunk overlaps with range (not just center)
            const firstFrame = chunk.frames[0]
            const lastFrame = chunk.frames[chunk.frames.length - 1]
            if (firstFrame === undefined || lastFrame === undefined) return false
            const rangeStart = currentFrame - chunk.range
            const rangeEnd = currentFrame + chunk.range
            // Chunk overlaps if: chunkStart <= rangeEnd && chunkEnd >= rangeStart
            return firstFrame <= rangeEnd && lastFrame >= rangeStart
          })

          if (queue.length === 0) break

          // Process multiple chunks concurrently
          const batch = queue.splice(0, MAX_CONCURRENT)

          // Mark chunks as requested IMMEDIATELY (before fetch) to prevent duplicate requests
          const requestedChunks = requestedChunksRef.current
          for (const chunk of batch) {
            const firstChunkFrame = chunk.frames[0]
            if (firstChunkFrame === undefined) continue
            const chunkSize = 32 * chunk.modulo
            const chunkStart = Math.floor(firstChunkFrame / chunkSize) * chunkSize

            // Get or create set for this modulo
            let inFlight = requestedChunks.get(chunk.modulo)
            if (!inFlight) {
              inFlight = new Set()
              requestedChunks.set(chunk.modulo, inFlight)
            }

            inFlight.add(chunkStart)
          }

          // Load chunks concurrently
          const batchPromises = batch.map(async chunk => {
            const indicesParam = chunk.frames.join(',')
            const response = await fetch(
              `/api/frames/${encodedVideoId}/batch?indices=${indicesParam}`
            )
            return response.json() as Promise<{
              frames: Array<{ frame_index: number; image_data: string }>
            }>
          })

          const results = await Promise.all(batchPromises)

          // Update framesRef directly (silent, no re-render)
          // RAF loop will pick up changes and update display
          for (const data of results) {
            for (const frame of data.frames) {
              const binaryData = atob(frame.image_data)
              const bytes = Uint8Array.from(binaryData, char => char.charCodeAt(0))
              const blob = new Blob([bytes], { type: 'image/jpeg' })
              const imageUrl = URL.createObjectURL(blob)
              framesRef.current.set(frame.frame_index, {
                frame_index: frame.frame_index,
                image_url: imageUrl,
                ocr_text: '',
              })
            }
          }

          // Move chunks from requested to loaded
          const loadedChunks = loadedChunksRef.current
          // Reuse requestedChunks declared above
          for (const chunk of batch) {
            const chunkFirstFrame = chunk.frames[0]
            if (chunkFirstFrame === undefined) continue
            const chunkSize = 32 * chunk.modulo
            const chunkStart = Math.floor(chunkFirstFrame / chunkSize) * chunkSize

            // Remove from requested
            const inFlight = requestedChunks.get(chunk.modulo)
            if (inFlight) {
              inFlight.delete(chunkStart)
            }

            // Add to loaded cache (with LRU eviction)
            const cache = loadedChunks.get(chunk.modulo) ?? []
            if (!loadedChunks.has(chunk.modulo)) {
              loadedChunks.set(chunk.modulo, cache)
            }
            const shouldAdd = !cache.includes(chunkStart)
            if (shouldAdd) cache.push(chunkStart)
            if (cache.length > MAX_CHUNKS_PER_MODULO) cache.shift()
          }
        }
      } catch (error: unknown) {
        console.error('Failed to load frames:', error)
      }
    }

    void loadFrameHierarchy()

    // Cleanup: cancel load if frame changes
    return () => {
      cancelled = true
    }
  }, [currentFrameIndex, totalFrames, videoId, isLoadingMetadata])

  // Find annotation(s) for a given frame
  const getAnnotationsForFrame = useCallback(
    (frameIndex: number) => {
      return annotations.filter(
        ann => frameIndex >= ann.start_frame_index && frameIndex <= ann.end_frame_index
      )
    },
    [annotations]
  )

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
        activeAnnotationRef.current = annotation
        markedStartRef.current = annotation.start_frame_index
        markedEndRef.current = annotation.end_frame_index
        await checkNavigationAvailability(annotation.id)
      }
    } catch (error) {
      console.error('Failed to activate current frame annotation:', error)
    }
  }, [currentFrameIndex, videoId, checkNavigationAvailability])

  // Show loading state while metadata loads
  if (isLoadingMetadata) {
    return (
      <AppLayout fullScreen>
        <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              Loading video metadata...
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{videoId}</div>
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

        {/* Main content */}
        <div className="flex h-full flex-1 gap-6 overflow-hidden">
          {/* Left: Frame stack (2/3 width) */}
          <BoundaryFrameStack
            visibleFramePositions={visibleFramePositions}
            frames={frames}
            currentFrameIndex={currentFrameIndex}
            markedStart={markedStart}
            markedEnd={markedEnd}
            activeAnnotation={activeAnnotation}
            cropWidth={cropWidth}
            cropHeight={cropHeight}
            cursorStyle={cursorStyle}
            getOpacity={getOpacity}
            getAnnotationsForFrame={getAnnotationsForFrame}
            getAnnotationBorderColor={getAnnotationBorderColor}
            onDragStart={handleDragStart}
            onMarkStart={framePosition => {
              markedStartRef.current = framePosition
              // Reset end if it's before the new start
              if (markedEnd !== null && framePosition > markedEnd) {
                markedEndRef.current = null
              }
            }}
            onMarkEnd={framePosition => {
              markedEndRef.current = framePosition
              // Reset start if it's after the new end
              if (markedStart !== null && framePosition < markedStart) {
                markedStartRef.current = null
              }
            }}
          />

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
            <BoundaryVideoInfo
              videoId={videoId}
              currentFrameIndex={currentFrameIndex}
              totalFrames={totalFrames}
              workflowProgress={workflowProgress || 0}
              completedFrames={completedFrames || 0}
              jumpToFrameInput={jumpToFrameInput}
              onJumpInputChange={setJumpToFrameInput}
              onJump={() => void jumpToFrame()}
              onActivateCurrentFrame={() => void activateCurrentFrameAnnotation()}
            />

            {/* Frame spacing */}
            <BoundarySpacingControl
              frameSpacing={frameSpacing}
              onChange={spacing => setFrameSpacing(spacing)}
            />

            {/* Boundaries */}
            <BoundaryMarkingControls
              markedStart={markedStart}
              markedEnd={markedEnd}
              hasActiveAnnotation={!!activeAnnotation}
              onJumpToStart={jumpToStart}
              onMarkStart={markStart}
              onJumpToEnd={jumpToEnd}
              onMarkEnd={markEnd}
              onClearMarks={clearMarks}
            />

            {/* Active annotation info */}
            {activeAnnotation && (
              <div className="space-y-3">
                <BoundaryAnnotationInfo
                  annotation={activeAnnotation}
                  getEffectiveState={getEffectiveState}
                />

                {/* Actions */}
                <BoundaryActionButtons
                  canSave={canSave}
                  hasPrevAnnotation={hasPrevAnnotation}
                  hasNextAnnotation={hasNextAnnotation}
                  activeAnnotation={activeAnnotation}
                  onSave={() => void saveAnnotation()}
                  onPrevious={() => void navigateToAnnotation('prev')}
                  onNext={() => void navigateToAnnotation('next')}
                  onDelete={() => void deleteAnnotation()}
                />
              </div>
            )}

            {/* Help button */}
            <button
              onClick={() => setShowHelpModal(true)}
              className="w-full rounded-md border border-teal-500 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100 dark:border-teal-600 dark:bg-teal-950 dark:text-teal-300 dark:hover:bg-teal-900"
            >
              📖 Annotation Guide
            </button>

            {/* Keyboard and mouse shortcuts */}
            <BoundaryShortcutsPanel />
          </div>
        </div>
      </div>

      {/* Help Modal */}
      <BoundaryHelpModal isOpen={showHelpModal} onClose={() => setShowHelpModal(false)} />
    </AppLayout>
  )
}
