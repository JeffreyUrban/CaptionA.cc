import { useState, useEffect, useMemo, useCallback, useRef, startTransition } from 'react'
import { useSearchParams } from 'react-router'

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
    defaultVideoId: process.env['DEFAULT_VIDEO_ID'] || '',
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
  const videoIdFromUrl = searchParams.get('videoId') || ''

  // State
  const [videoId] = useState(videoIdFromUrl)
  const [totalFrames, setTotalFrames] = useState(0)
  const [cropWidth, setCropWidth] = useState<number>(0)
  const [cropHeight, setCropHeight] = useState<number>(0)
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(true)

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
        setCropWidth(metadataData.cropWidth || 0)
        setCropHeight(metadataData.cropHeight || 0)

        // Load workflow progress
        const progressResponse = await fetch(`/api/annotations/${encodedVideoId}/progress`)
        const progressData = await progressResponse.json()
        workflowProgressRef.current = progressData.progress_percent
        completedFramesRef.current = progressData.completed_frames

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
      workflowProgressRef.current = progressData.progress_percent
      completedFramesRef.current = progressData.completed_frames
    } catch (error) {
      console.error('Failed to update progress:', error)
    }
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
        annotationsRef.current = data.annotations || []
      } catch (error) {
        console.error('Failed to load annotations:', error)
      }
    },
    [videoId]
  )

  // Mark this video as being worked on for stats refresh on Videos page
  useEffect(() => {
    if (videoId && typeof window !== 'undefined') {
      const touchedVideos = new Set(JSON.parse(localStorage.getItem('touched-videos') || '[]'))
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
          checkNavigationAvailability(data.annotation.id)
        }
      } catch (error) {
        console.error(`Failed to navigate to ${direction} annotation:`, error)
      }
    },
    [activeAnnotation, videoId]
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
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in input/textarea
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
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
    if (visibleFramePositions.length === 0) return

    const startFrame = Math.min(...visibleFramePositions)
    const endFrame = Math.max(...visibleFramePositions)
    loadAnnotations(startFrame, endFrame)
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
      const currentFrames = framesRef.current
      const encodedVideoId = encodeURIComponent(videoId)
      const CHUNK_SIZE = 100
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

        if (moduloLevelIndex >= moduloLevels.length) return chunks

        const { modulo, range } = moduloLevels[moduloLevelIndex]!
        const rangeStart = Math.max(0, centerFrame - range)
        const rangeEnd = Math.min(totalFrames - 1, centerFrame + range)

        // Chunk size in frame indices = 32 frames × modulo spacing
        // For modulo 32: 32 frames × 32 = 1024 frame indices [0-1023]
        const chunkSize = FRAMES_PER_CHUNK * modulo

        // Align to chunk boundaries
        const firstChunkStart = Math.floor(rangeStart / chunkSize) * chunkSize
        const lastChunkStart = Math.floor(rangeEnd / chunkSize) * chunkSize

        // Get cached chunks and in-flight requests for this modulo
        const cachedChunks = loadedChunks.get(modulo) || []
        const inFlightChunks = requestedChunks.get(modulo) || new Set()

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
            if (chunk.frames.length === 0) return false
            const chunkStart = chunk.frames[0]!
            const chunkEnd = chunk.frames[chunk.frames.length - 1]!
            const rangeStart = currentFrame - chunk.range
            const rangeEnd = currentFrame + chunk.range
            // Chunk overlaps if: chunkStart <= rangeEnd && chunkEnd >= rangeStart
            return chunkStart <= rangeEnd && chunkEnd >= rangeStart
          })

          if (queue.length === 0) break

          // Process multiple chunks concurrently
          const batch = queue.splice(0, MAX_CONCURRENT)

          // Mark chunks as requested IMMEDIATELY (before fetch) to prevent duplicate requests
          const requestedChunks = requestedChunksRef.current
          for (const chunk of batch) {
            const chunkSize = 32 * chunk.modulo
            const chunkStart = Math.floor(chunk.frames[0]! / chunkSize) * chunkSize

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
              const bytes = new Uint8Array(binaryData.length)
              for (let i = 0; i < binaryData.length; i++) {
                bytes[i] = binaryData.charCodeAt(i)
              }
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
            const chunkSize = 32 * chunk.modulo
            const chunkStart = Math.floor(chunk.frames[0]! / chunkSize) * chunkSize

            // Remove from requested
            const inFlight = requestedChunks.get(chunk.modulo)
            if (inFlight) {
              inFlight.delete(chunkStart)
            }

            // Add to loaded cache
            let cache = loadedChunks.get(chunk.modulo)
            if (!cache) {
              cache = []
              loadedChunks.set(chunk.modulo, cache)
            }

            // Add to end (most recent)
            if (!cache.includes(chunkStart)) {
              cache.push(chunkStart)

              // Evict oldest if exceeds limit
              if (cache.length > MAX_CHUNKS_PER_MODULO) {
                const evicted = cache.shift()!
                const evictedEnd = evicted + chunkSize - 1
              }
            }
          }
        }
      } catch (error: unknown) {
        console.error('Failed to load frames:', error)
      }
    }

    loadFrameHierarchy()

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
        {(workflowProgress || 0) >= 100 && (
          <div className="mb-4 rounded-lg bg-green-50 border-2 border-green-500 p-4 dark:bg-green-950 dark:border-green-600">
            <div className="flex items-center gap-3">
              <div className="text-3xl">🎉</div>
              <div className="flex-1">
                <div className="text-lg font-bold text-green-900 dark:text-green-100">
                  Workflow Complete!
                </div>
                <div className="text-sm text-green-700 dark:text-green-300">
                  All {totalFrames.toLocaleString()} frames have been annotated. You can continue
                  reviewing and editing as needed.
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
              {visibleFramePositions.map((framePosition, slotIndex) => {
                // Find finest available frame by checking coarsest to finest
                // Check coarsest first (loads first, widest coverage) but keep finest found
                // Read from frames state (updated by RAF loop from framesRef)
                let alignedFrameIndex = framePosition
                let frame = frames.get(alignedFrameIndex)

                if (!frame) {
                  // Check from coarse to fine, keeping the finest available
                  // Short-circuit if a level is missing (finer levels won't exist yet)
                  for (const modulo of [32, 16, 8, 4, 2]) {
                    const testIndex = Math.round(framePosition / modulo) * modulo
                    const testFrame = frames.get(testIndex)
                    if (testFrame) {
                      frame = testFrame
                      alignedFrameIndex = testIndex
                      // Stop if we found the exact frame requested
                      if (alignedFrameIndex === framePosition) break
                      // Continue checking for finer frames
                    } else {
                      // Missing this level, finer levels won't exist - stop checking
                      break
                    }
                  }
                }

                // Current indicator based on position, not aligned frame
                const isCurrent = framePosition === currentFrameIndex
                const opacity = getOpacity(framePosition)
                const frameAnnotations = getAnnotationsForFrame(framePosition)

                // Find the primary annotation to display (prefer active annotation)
                const primaryAnnotation =
                  frameAnnotations.find(
                    ann => activeAnnotation && ann.id === activeAnnotation.id
                  ) || frameAnnotations[0]

                // Determine border classes
                let borderClasses = ''
                let borderColor = ''

                if (primaryAnnotation) {
                  borderColor = getAnnotationBorderColor(primaryAnnotation)

                  // Check if this frame is at the start or end of the annotation
                  const isAnnotationStart = framePosition === primaryAnnotation.start_frame_index
                  const isAnnotationEnd = framePosition === primaryAnnotation.end_frame_index

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
                  framePosition >= markedStart &&
                  framePosition <= markedEnd
                ) {
                  // Create continuous orange border around the marked range
                  orangeBorderClasses = 'border-l-4 border-r-4 border-orange-500'
                  if (framePosition === markedStart) {
                    orangeBorderClasses += ' border-t-4 rounded-t'
                  }
                  if (framePosition === markedEnd) {
                    orangeBorderClasses += ' border-b-4 rounded-b'
                  }
                }

                return (
                  <div key={slotIndex} className="relative">
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
                            borderLeft: '12px solid rgb(156, 163, 175)', // gray-400
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
                            borderRight: '12px solid rgb(156, 163, 175)', // gray-400
                          }}
                        />
                      </>
                    )}

                    {/* Frame container */}
                    <div
                      onClick={() => {
                        markedStartRef.current = framePosition
                        // Reset end if it's before the new start
                        if (markedEnd !== null && framePosition > markedEnd) {
                          markedEndRef.current = null
                        }
                      }}
                      onContextMenu={e => {
                        e.preventDefault()
                        markedEndRef.current = framePosition
                        // Reset start if it's after the new end
                        if (markedStart !== null && framePosition < markedStart) {
                          markedStartRef.current = null
                        }
                      }}
                      style={{
                        opacity,
                        aspectRatio:
                          cropWidth > 0 && cropHeight > 0
                            ? `${cropWidth}/${cropHeight}`
                            : undefined,
                      }}
                      className={`relative overflow-hidden cursor-pointer ${borderClasses}`}
                    >
                      {/* Frame image */}
                      {frame ? (
                        <img
                          src={frame.image_url}
                          alt={`Frame ${alignedFrameIndex}`}
                          className="w-full"
                          draggable={false}
                          onError={e => {
                            // Fallback for missing images
                            const target = e.target as HTMLImageElement
                            target.style.display = 'none'
                            target.parentElement!.innerHTML += `
                                <div class="flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400" style="width: 100%; height: 100%;">
                                  Frame ${alignedFrameIndex}
                                </div>
                              `
                          }}
                        />
                      ) : (
                        <div className="flex w-full h-full items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                          Loading frame {framePosition}...
                        </div>
                      )}
                    </div>

                    {/* Border connector to next frame in marked range */}
                    {orangeBorderClasses &&
                      framePosition !== markedEnd &&
                      slotIndex < visibleFramePositions.length - 1 && (
                        <div
                          className="absolute left-0 right-0 border-l-4 border-r-4 border-orange-500 pointer-events-none"
                          style={{ top: '100%', height: '0.5rem', opacity: 1 }}
                        />
                      )}

                    {/* Border connector for regular annotation borders */}
                    {primaryAnnotation &&
                      borderColor &&
                      framePosition !== primaryAnnotation.end_frame_index &&
                      slotIndex < visibleFramePositions.length - 1 && (
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
              <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">Video</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">{videoId}</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Frame: {currentFrameIndex.toLocaleString()} / {totalFrames.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                Progress: {(workflowProgress || 0).toFixed(2)}% (
                {(completedFrames || 0).toLocaleString()} / {totalFrames.toLocaleString()}{' '}
                completed)
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
            onClick={e => e.stopPropagation()}
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
                  This page helps you review and correct frame range boundaries for video content.
                  Each annotation is either a single caption&apos;s range or a single non-caption
                  range between captions.
                </p>
                <p className="mt-2">
                  <strong>Important:</strong> The bounds should include both the start and end
                  frames of the range, as shown by the colored border around the frames.
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
                      Machine learning predictions for frame range boundaries (captions or
                      non-caption content). These are considered complete and are not included in
                      the review workflow.
                    </p>
                  </div>

                  <div className="rounded-md border-l-2 border-teal-500 bg-teal-50 p-3 dark:bg-teal-950">
                    <div className="font-semibold text-teal-900 dark:text-teal-200">
                      Confirmed (Teal Border)
                    </div>
                    <p className="mt-1 text-teal-800 dark:text-teal-300">
                      Human-verified annotations with correct boundaries for either captions or
                      non-caption content. These are considered complete and accurate.
                    </p>
                  </div>

                  <div className="rounded-md border-l-2 border-pink-500 bg-pink-50 p-3 dark:bg-pink-950">
                    <div className="font-semibold text-pink-900 dark:text-pink-200">
                      Pending (Pink Border)
                    </div>
                    <p className="mt-1 text-pink-800 dark:text-pink-300">
                      Annotations for captions or non-caption content that need review or
                      correction. These appear in the workflow queue for human verification.
                    </p>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Gaps</h3>
                <p>
                  Gaps are frame ranges that haven&apos;t been assigned yet. They appear in the
                  workflow queue so you can determine what type of content they contain and annotate
                  them accordingly.
                </p>
              </section>

              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Workflow
                </h3>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>Review the active annotation or gap shown with a colored border</li>
                  <li>Navigate through frames using scroll wheel, drag, or keyboard shortcuts</li>
                  <li>
                    Adjust boundaries using Mark Start/End buttons or (left, right) mouse clicks
                  </li>
                  <li>
                    The orange border shows the range that will be saved as the caption /
                    non-caption
                  </li>
                  <li>
                    Click &ldquo;Save &amp; Next&rdquo; to confirm and move to the next annotation
                  </li>
                  <li>Use &ldquo;Clear Marks&rdquo; to reset to original boundaries if needed</li>
                </ol>
              </section>

              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Rules &amp; Tips
                </h3>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Boundaries must include both start and end frames (inclusive)</li>
                  <li>A caption can be a single frame (start = end)</li>
                  <li>Annotations cannot overlap - each frame belongs to exactly one annotation</li>
                  <li>
                    A caption can be set to overlap with another caption - that caption will be
                    adjusted and set to Pending status
                  </li>
                  <li>The teal ring highlights the currently displayed frame</li>
                  <li>Use frame spacing controls to adjust visible frame density</li>
                  <li>Progress tracks the percentage of confirmed and predicted frames</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
