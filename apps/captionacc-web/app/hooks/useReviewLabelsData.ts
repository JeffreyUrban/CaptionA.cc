import { useState, useEffect, useCallback, useRef } from 'react'

import type { FrameInfo, PotentialMislabel, FrameBoxesData, ViewMode } from '~/types/review-labels'

interface UseReviewLabelsDataParams {
  videoId: string
}

interface UseReviewLabelsDataReturn {
  // Core state
  frames: FrameInfo[]
  loading: boolean
  error: string | null
  setError: (error: string | null) => void

  // View state
  viewMode: ViewMode
  selectedFrameIndex: number | null
  currentFrameBoxes: FrameBoxesData | null
  loadingFrame: boolean
  hasUnsyncedAnnotations: boolean
  setHasUnsyncedAnnotations: (value: boolean) => void

  // Cache
  frameBoxesCache: React.RefObject<Map<number, FrameBoxesData>>

  // Actions
  loadMislabels: (showLoading?: boolean) => Promise<void>
  handleThumbnailClick: (frameIndex: number | 'analysis') => void
  handleBoxClick: (boxIndex: number, label: 'in' | 'out') => Promise<void>
  setCurrentFrameBoxes: React.Dispatch<React.SetStateAction<FrameBoxesData | null>>
  setLoading: (loading: boolean) => void
}

/**
 * Custom hook for managing Review Labels data fetching and state.
 * Extracts the data management logic from the main component.
 */
// eslint-disable-next-line max-lines-per-function -- Review labels data management with loading and saving operations
export function useReviewLabelsData({
  videoId,
}: UseReviewLabelsDataParams): UseReviewLabelsDataReturn {
  // Core state
  const [, setMislabels] = useState<PotentialMislabel[]>([])
  const [frames, setFrames] = useState<FrameInfo[]>([])
  const [, setClusterStats] = useState<{ avgTop: number; avgBottom: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('frame')
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null)
  const [currentFrameBoxes, setCurrentFrameBoxes] = useState<FrameBoxesData | null>(null)
  const [loadingFrame, setLoadingFrame] = useState(false)
  const [hasUnsyncedAnnotations, setHasUnsyncedAnnotations] = useState(false)

  // Cache for frame boxes
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

  // Mark video as being worked on
  useEffect(() => {
    if (videoId && typeof window !== 'undefined') {
      const touchedVideos = new Set(JSON.parse(localStorage.getItem('touched-videos') ?? '[]'))
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
          `/videos/${encodeURIComponent(videoId)}/review-labels`
        )

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error ?? 'Failed to load mislabels')
        }

        const data = await response.json()

        console.log(
          `[Frontend] Received ${data.potentialMislabels?.length ?? 0} potential mislabels`
        )

        setMislabels(data.potentialMislabels ?? [])
        setClusterStats(data.clusterStats ?? null)

        const frameInfos = buildFrameInfos(data.potentialMislabels ?? [], videoId)
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

  // Prefetch frame boxes for all frames in queue
  useEffect(() => {
    if (!videoId || frames.length === 0) return
    void prefetchFrameBoxes(videoId, frames, frameBoxesCache.current)
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
      void loadMislabels(true)
    }, 3000)

    return () => {
      console.log('[Polling] Cleaning up poll interval')
      clearInterval(pollInterval)
    }
  }, [error, loadMislabels])

  // Load frame boxes when frame selected
  useEffect(() => {
    if (!videoId || viewMode !== 'frame' || selectedFrameIndex === null) return

    const cached = frameBoxesCache.current.get(selectedFrameIndex)
    if (cached) {
      console.log(`[Cache] Using cached boxes for frame ${selectedFrameIndex}`)
      setCurrentFrameBoxes(cached)
      setLoadingFrame(false)
      return
    }

    void loadFrameBoxesAsync(
      videoId,
      selectedFrameIndex,
      frameBoxesCache.current,
      setCurrentFrameBoxes,
      setLoadingFrame
    )
  }, [videoId, viewMode, selectedFrameIndex])

  // Handle thumbnail click
  const handleThumbnailClick = useCallback(
    (frameIndex: number | 'analysis') => {
      console.log(`[Frontend] Thumbnail clicked: ${frameIndex}`)

      const isChangingView =
        (frameIndex === 'analysis' && viewMode !== 'analysis') ||
        (frameIndex !== 'analysis' && (viewMode !== 'frame' || selectedFrameIndex !== frameIndex))

      if (frameIndex === 'analysis') {
        setViewMode('analysis')
        setSelectedFrameIndex(
          prev => prev ?? (frames.length > 0 ? (frames[0]?.frameIndex ?? null) : null)
        )
      } else {
        setViewMode('frame')
        setSelectedFrameIndex(frameIndex)
      }

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

  // Handle box annotation
  const handleBoxClick = useCallback(
    async (boxIndex: number, label: 'in' | 'out') => {
      if (!videoId || !currentFrameBoxes) return

      try {
        setCurrentFrameBoxes(prev => updateBoxLabel(prev, boxIndex, label))

        const response = await fetch(
          `/videos/${encodeURIComponent(videoId)}/frames/${currentFrameBoxes.frameIndex}/boxes`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ annotations: [{ boxIndex, label }] }),
          }
        )

        if (!response.ok) {
          throw new Error('Failed to save annotation')
        }

        frameBoxesCache.current.delete(currentFrameBoxes.frameIndex)
        setHasUnsyncedAnnotations(true)
      } catch (err) {
        console.error('Failed to save box annotation:', err)
        setSelectedFrameIndex(prev => prev)
      }
    },
    [videoId, currentFrameBoxes]
  )

  return {
    frames,
    loading,
    error,
    setError,
    viewMode,
    selectedFrameIndex,
    currentFrameBoxes,
    loadingFrame,
    hasUnsyncedAnnotations,
    setHasUnsyncedAnnotations,
    frameBoxesCache,
    loadMislabels,
    handleThumbnailClick,
    handleBoxClick,
    setCurrentFrameBoxes,
    setLoading,
  }
}

// --- Helper Functions ---

function buildFrameInfos(potentialMislabels: PotentialMislabel[], videoId: string): FrameInfo[] {
  const frameIndices = (
    Array.from(new Set(potentialMislabels.map(m => m.frameIndex))) as number[]
  ).sort((a, b) => a - b)

  return frameIndices.map(frameIndex => {
    const frameMislabels = potentialMislabels.filter(m => m.frameIndex === frameIndex)
    const confidenceValues = frameMislabels
      .map(m => m.predictedConfidence)
      .filter((c): c is number => c !== null)
    const minConfidence = confidenceValues.length > 0 ? Math.min(...confidenceValues) : 0

    return {
      frameIndex,
      totalBoxCount: frameMislabels.length,
      captionBoxCount: frameMislabels.filter(m => m.userLabel === 'in').length,
      minConfidence,
      hasAnnotations: true,
      imageUrl: `/api/full-frames/${encodeURIComponent(videoId)}/${frameIndex}.jpg`,
    }
  })
}

async function prefetchFrameBoxes(
  videoId: string,
  frames: FrameInfo[],
  cache: Map<number, FrameBoxesData>
): Promise<void> {
  console.log(`[Prefetch] Starting prefetch for ${frames.length} frames`)

  const prefetchPromises = frames.map(async frame => {
    if (cache.has(frame.frameIndex)) return

    try {
      console.log(`[Prefetch] Fetching frame ${frame.frameIndex}`)
      const response = await fetch(
        `/videos/${encodeURIComponent(videoId)}/frames/${frame.frameIndex}/boxes`
      )
      if (!response.ok) return

      const data = await response.json()
      cache.set(frame.frameIndex, data)
      console.log(`[Prefetch] Cached frame ${frame.frameIndex}`)
    } catch (err) {
      console.warn(`[Prefetch] Failed to prefetch frame ${frame.frameIndex}:`, err)
    }
  })

  await Promise.all(prefetchPromises)
  console.log(`[Prefetch] Completed`)
}

async function loadFrameBoxesAsync(
  videoId: string,
  frameIndex: number,
  cache: Map<number, FrameBoxesData>,
  setCurrentFrameBoxes: (data: FrameBoxesData | null) => void,
  setLoadingFrame: (loading: boolean) => void
): Promise<void> {
  setLoadingFrame(true)
  try {
    console.log(`[Fetch] Loading boxes for frame ${frameIndex}`)
    const response = await fetch(
      `/videos/${encodeURIComponent(videoId)}/frames/${frameIndex}/boxes`
    )
    if (!response.ok) throw new Error('Failed to load frame boxes')
    const data = await response.json()

    cache.set(frameIndex, data)
    setCurrentFrameBoxes(data)
    setLoadingFrame(false)
  } catch (err) {
    console.error('Failed to load frame boxes:', err)
    setCurrentFrameBoxes(null)
    setLoadingFrame(false)
  }
}

function updateBoxLabel(
  prev: FrameBoxesData | null,
  boxIndex: number,
  label: 'in' | 'out'
): FrameBoxesData | null {
  if (!prev) return prev
  return {
    ...prev,
    boxes: prev.boxes.map(box =>
      box.boxIndex === boxIndex
        ? { ...box, userLabel: label, colorCode: label === 'in' ? 'annotated_in' : 'annotated_out' }
        : box
    ),
  }
}
