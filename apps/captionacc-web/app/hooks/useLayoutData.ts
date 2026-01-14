/**
 * Custom hook for managing Layout annotation data fetching and state.
 * Extracts the data management logic from the main AnnotateLayout component.
 *
 * Updated to use CR-SQLite database via useLayoutDatabase hook instead of REST API calls.
 * All existing function signatures and return types are maintained for backward compatibility.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

import {
  RECALC_THRESHOLD,
  type FrameInfo,
  type LayoutConfig,
  type BoxData,
  type FrameBoxesData,
  type ViewMode,
  type LayoutQueueResponse,
  type BoxStats,
  type CropRegionEdit,
  type SelectionRectEdit,
  type LayoutParamsEdit,
  type EditStateUpdaters,
} from '~/types/layout'
import { useLayoutDatabase, type UseLayoutDatabaseReturn } from './useLayoutDatabase'
import type {
  LayoutQueueResult,
  BoxDataResult,
  FrameBoxesResult,
  FrameInfoResult,
  LayoutConfigResult,
} from '~/services/database-queries'

// =============================================================================
// Interface Params & Return
// =============================================================================

interface UseLayoutDataParams {
  videoId: string
  tenantId?: string // Optional tenant ID for S3 path
  showAlert?: (title: string, message: string, type: 'info' | 'error' | 'success') => void
}

interface UseLayoutDataReturn {
  frames: FrameInfo[]
  layoutConfig: LayoutConfig | null
  layoutApproved: boolean
  loading: boolean
  error: string | null
  setError: (error: string | null) => void
  setLoading: (loading: boolean) => void
  viewMode: ViewMode
  selectedFrameIndex: number | null
  currentFrameBoxes: FrameBoxesData | null
  loadingFrame: boolean
  analysisBoxes: BoxData[] | null
  hasUnsyncedAnnotations: boolean
  annotationsSinceRecalc: number
  isRecalculating: boolean
  cropRegionMismatch: boolean
  analysisThumbnailUrl: string | null
  setAnalysisThumbnailUrl: (url: string | null) => void
  cropRegionEdit: CropRegionEdit | null
  setCropRegionEdit: (value: CropRegionEdit | null) => void
  boxStats: BoxStats | null
  pulseStartTime: number
  frameBoxesCache: React.RefObject<Map<number, FrameBoxesData>>
  loadQueue: (showLoading?: boolean, skipEditStateUpdate?: boolean) => Promise<void>
  loadAnalysisBoxes: () => Promise<void>
  recalculateCropRegion: () => Promise<void>
  handleThumbnailClick: (frameIndex: number | 'analysis') => void
  handleBoxClick: (boxIndex: number, label: 'in' | 'out') => Promise<void>
  setCurrentFrameBoxes: React.Dispatch<React.SetStateAction<FrameBoxesData | null>>
  setHasUnsyncedAnnotations: (value: boolean) => void
  setAnnotationsSinceRecalc: (count: number) => void
  setLayoutApproved: (approved: boolean) => void
  handleClearAll: () => Promise<void>
  // New properties for lock status (UI can use these to show lock banner)
  canEdit: boolean
  lockState:
    | 'loading'
    | 'checking'
    | 'acquiring'
    | 'granted'
    | 'denied'
    | 'transferring'
    | 'server_processing'
    | 'released'
    | 'error'
  lockHolder: { userId: string; displayName?: string; isCurrentUser: boolean } | null
  acquireLock: () => Promise<void>
  releaseLock: () => Promise<void>
}

// =============================================================================
// Type Converters
// =============================================================================

/**
 * Convert FrameInfoResult to FrameInfo (for backward compatibility).
 */
function convertFrameInfo(result: FrameInfoResult): FrameInfo {
  return {
    frameIndex: result.frameIndex,
    totalBoxCount: result.totalBoxCount,
    captionBoxCount: result.captionBoxCount,
    minConfidence: result.minConfidence,
    hasAnnotations: result.hasAnnotations,
    imageUrl: result.imageUrl,
  }
}

/**
 * Convert LayoutConfigResult to LayoutConfig (for backward compatibility).
 */
function convertLayoutConfig(result: LayoutConfigResult): LayoutConfig {
  return {
    frameWidth: result.frameWidth,
    frameHeight: result.frameHeight,
    cropLeft: result.cropLeft,
    cropTop: result.cropTop,
    cropRight: result.cropRight,
    cropBottom: result.cropBottom,
    selectionLeft: result.selectionLeft,
    selectionTop: result.selectionTop,
    selectionRight: result.selectionRight,
    selectionBottom: result.selectionBottom,
    verticalPosition: result.verticalPosition,
    verticalStd: result.verticalStd,
    boxHeight: result.boxHeight,
    boxHeightStd: result.boxHeightStd,
    anchorType: result.anchorType,
    anchorPosition: result.anchorPosition,
    topEdgeStd: result.topEdgeStd,
    bottomEdgeStd: result.bottomEdgeStd,
    horizontalStdSlope: result.horizontalStdSlope,
    horizontalStdIntercept: result.horizontalStdIntercept,
    cropRegionVersion: result.cropRegionVersion,
  }
}

/**
 * Convert BoxDataResult to BoxData (for backward compatibility).
 */
function convertBoxData(result: BoxDataResult): BoxData {
  return {
    boxIndex: result.boxIndex,
    text: result.text,
    originalBounds: result.originalBounds,
    displayBounds: result.displayBounds,
    predictedLabel: result.predictedLabel ?? 'in',
    predictedConfidence: result.predictedConfidence,
    userLabel: result.userLabel,
    colorCode: result.colorCode,
  }
}

/**
 * Convert FrameBoxesResult to FrameBoxesData (for backward compatibility).
 */
function convertFrameBoxesData(result: FrameBoxesResult): FrameBoxesData {
  return {
    frameIndex: result.frameIndex,
    imageUrl: result.imageUrl,
    cropRegion: result.cropRegion,
    frameWidth: result.frameWidth,
    frameHeight: result.frameHeight,
    boxes: result.boxes.map(convertBoxData),
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function updateEditStateFromConfig(layoutConfig: LayoutConfig, updaters: EditStateUpdaters): void {
  updaters.setCropRegionEdit({
    left: layoutConfig.cropLeft,
    top: layoutConfig.cropTop,
    right: layoutConfig.cropRight,
    bottom: layoutConfig.cropBottom,
  })

  const hasSelection =
    layoutConfig.selectionLeft !== null &&
    layoutConfig.selectionTop !== null &&
    layoutConfig.selectionRight !== null &&
    layoutConfig.selectionBottom !== null

  updaters.setSelectionRectEdit(
    hasSelection
      ? {
          left: layoutConfig.selectionLeft as number,
          top: layoutConfig.selectionTop as number,
          right: layoutConfig.selectionRight as number,
          bottom: layoutConfig.selectionBottom as number,
        }
      : null
  )

  updaters.setLayoutParamsEdit({
    verticalPosition: layoutConfig.verticalPosition,
    verticalStd: layoutConfig.verticalStd,
    boxHeight: layoutConfig.boxHeight,
    boxHeightStd: layoutConfig.boxHeightStd,
    anchorType: layoutConfig.anchorType,
    anchorPosition: layoutConfig.anchorPosition,
  })
}

function processQueueResponse(
  data: LayoutQueueResult,
  skipEditStateUpdate: boolean,
  setFrames: (frames: FrameInfo[]) => void,
  setLayoutConfig: (config: LayoutConfig | null) => void,
  setLayoutApproved: (approved: boolean) => void,
  editUpdaters: EditStateUpdaters
): void {
  setFrames(data.frames.map(convertFrameInfo))
  const config = data.layoutConfig ? convertLayoutConfig(data.layoutConfig) : null
  setLayoutConfig(config)
  setLayoutApproved(data.layoutApproved)

  if (config && !skipEditStateUpdate) {
    updateEditStateFromConfig(config, editUpdaters)
  }
}

// =============================================================================
// Main Hook
// =============================================================================

export function useLayoutData({
  videoId,
  tenantId,
  showAlert,
}: UseLayoutDataParams): UseLayoutDataReturn {
  // Use the new database hook
  const db = useLayoutDatabase({
    videoId,
    tenantId,
    autoAcquireLock: true,
    onError: err => {
      console.error('[useLayoutData] Database error:', err)
      setError(err.message)
    },
  })

  // Local state
  const [frames, setFrames] = useState<FrameInfo[]>([])
  const [layoutConfig, setLayoutConfig] = useState<LayoutConfig | null>(null)
  const [layoutApproved, setLayoutApprovedState] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('analysis')
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null)
  const [currentFrameBoxes, setCurrentFrameBoxes] = useState<FrameBoxesData | null>(null)
  const [loadingFrame, setLoadingFrame] = useState(false)
  const [analysisBoxes, setAnalysisBoxes] = useState<BoxData[] | null>(null)
  const [hasUnsyncedAnnotations, setHasUnsyncedAnnotations] = useState(false)
  const [annotationsSinceRecalc, setAnnotationsSinceRecalc] = useState(0)
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [analysisThumbnailUrl, setAnalysisThumbnailUrl] = useState<string | null>(null)
  const [pulseStartTime, setPulseStartTime] = useState(Date.now())
  const [cropRegionEdit, setCropRegionEdit] = useState<CropRegionEdit | null>(null)
  const [approvedCropRegion, setApprovedCropRegion] = useState<CropRegionEdit | null>(null)
  const [, setSelectionRectEdit] = useState<SelectionRectEdit | null>(null)
  const [, setLayoutParamsEdit] = useState<LayoutParamsEdit | null>(null)

  const frameBoxesCache = useRef<Map<number, FrameBoxesData>>(new Map())

  // Sync loading state with database
  useEffect(() => {
    if (db.isLoading) {
      setLoading(true)
    }
  }, [db.isLoading])

  // Handle database error
  useEffect(() => {
    if (db.error) {
      setError(db.error.message)
      setLoading(false)
    }
  }, [db.error])

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

  const editUpdaters: EditStateUpdaters = useMemo(
    () => ({ setCropRegionEdit, setSelectionRectEdit, setLayoutParamsEdit }),
    []
  )

  // Save crop region when layout is approved
  useEffect(() => {
    if (layoutApproved && layoutConfig && !approvedCropRegion) {
      setApprovedCropRegion({
        left: layoutConfig.cropLeft,
        top: layoutConfig.cropTop,
        right: layoutConfig.cropRight,
        bottom: layoutConfig.cropBottom,
      })
    }
  }, [layoutApproved, layoutConfig, approvedCropRegion])

  // Calculate if crop region has changed since approval
  const cropRegionMismatch = useMemo(() => {
    if (!layoutApproved || !approvedCropRegion || !layoutConfig) return false
    return (
      approvedCropRegion.left !== layoutConfig.cropLeft ||
      approvedCropRegion.top !== layoutConfig.cropTop ||
      approvedCropRegion.right !== layoutConfig.cropRight ||
      approvedCropRegion.bottom !== layoutConfig.cropBottom
    )
  }, [layoutApproved, approvedCropRegion, layoutConfig])

  useEffect(() => {
    if (frames.length > 0 && selectedFrameIndex === null) {
      const firstFrame = frames[0]
      if (firstFrame) setSelectedFrameIndex(firstFrame.frameIndex)
    }
  }, [frames, selectedFrameIndex])

  useEffect(() => {
    if (selectedFrameIndex !== null) setPulseStartTime(Date.now())
  }, [selectedFrameIndex])

  // Load queue using database
  const loadQueue = useCallback(
    async (showLoading = true, skipEditStateUpdate = false) => {
      if (!videoId || !db.isReady) return
      if (showLoading) setError(null)

      try {
        const data = await db.getQueue()
        processQueueResponse(
          data,
          skipEditStateUpdate,
          setFrames,
          setLayoutConfig,
          setLayoutApprovedState,
          editUpdaters
        )
        if (showLoading) setLoading(false)
      } catch (err) {
        console.error('Failed to load layout queue:', err)
        if (showLoading) {
          setError((err as Error).message)
          setLoading(false)
        }
      }
    },
    [videoId, db.isReady, db.getQueue, editUpdaters]
  )

  // Load analysis boxes using database
  const loadAnalysisBoxes = useCallback(async () => {
    if (!videoId || !db.isReady) return
    try {
      const data = await db.getAnalysisBoxes()
      setAnalysisBoxes(Array.isArray(data.boxes) ? data.boxes.map(convertBoxData) : [])
    } catch (loadError) {
      console.error('Error loading analysis boxes:', loadError)
      setAnalysisBoxes([]) // Clear on error to prevent filter errors
    }
  }, [videoId, db.isReady, db.getAnalysisBoxes])

  // Recalculate crop region
  const recalculateCropRegion = useCallback(async () => {
    if (!videoId || !db.isReady) return
    setIsRecalculating(true)
    try {
      await db.recalculatePredictions()
      const result = await db.resetCropRegion()
      if (!result.success) {
        showAlert?.(
          'Recalculation Failed',
          result.message ?? 'Failed to recalculate crop region',
          'error'
        )
        setError(result.message ?? null)
        setAnnotationsSinceRecalc(0)
        return
      }
      await loadQueue(false, true)
      await loadAnalysisBoxes()
      setAnnotationsSinceRecalc(0)
    } catch (recalcError) {
      console.error('Error recalculating crop region:', recalcError)
    } finally {
      setIsRecalculating(false)
    }
  }, [
    videoId,
    db.isReady,
    db.recalculatePredictions,
    db.resetCropRegion,
    loadQueue,
    loadAnalysisBoxes,
    showAlert,
  ])

  // Prefetch frame boxes when frames change
  useEffect(() => {
    if (!videoId || !db.isReady || frames.length === 0) return
    void db.prefetchFrameBoxes(frames, frameBoxesCache.current as Map<number, FrameBoxesResult>)
  }, [videoId, db.isReady, db.prefetchFrameBoxes, frames])

  // Initial load when database is ready
  useEffect(() => {
    if (!videoId || !db.isReady) return
    void loadAnalysisBoxes()
    void loadQueue(true)
  }, [videoId, db.isReady, loadAnalysisBoxes, loadQueue])

  // Subscribe to database changes for real-time updates
  useEffect(() => {
    if (!db.isReady) return

    const unsubscribe = db.onChanges(event => {
      if (event.type === 'boxes_changed') {
        // Refresh boxes when they change (from server sync)
        void loadAnalysisBoxes()
        // Clear cache to force reload of frame boxes
        frameBoxesCache.current.clear()
      } else if (event.type === 'config_changed') {
        // Refresh queue when config changes
        void loadQueue(false, true)
      }
    })

    return unsubscribe
  }, [db.isReady, db.onChanges, loadAnalysisBoxes, loadQueue])

  // Poll if processing error (backward compatibility)
  useEffect(() => {
    if (!error?.startsWith('Processing:')) return
    const pollInterval = setInterval(() => {
      setError(null)
      void loadQueue(true)
    }, 3000)
    return () => clearInterval(pollInterval)
  }, [error, loadQueue])

  // Load frame boxes when frame selection changes
  useEffect(() => {
    if (!videoId || !db.isReady || viewMode !== 'frame' || selectedFrameIndex === null) return
    const cached = frameBoxesCache.current.get(selectedFrameIndex)
    if (cached) {
      setCurrentFrameBoxes(cached)
      setLoadingFrame(false)
      return
    }

    const loadFrameBoxes = async () => {
      setLoadingFrame(true)
      try {
        const data = await db.getFrameBoxes(selectedFrameIndex)
        const converted = convertFrameBoxesData(data)
        frameBoxesCache.current.set(selectedFrameIndex, converted)
        setCurrentFrameBoxes(converted)
      } catch (err) {
        console.error('Failed to load frame boxes:', err)
        setCurrentFrameBoxes(null)
      }
      setLoadingFrame(false)
    }
    void loadFrameBoxes()
  }, [videoId, db.isReady, db.getFrameBoxes, viewMode, selectedFrameIndex])

  const handleThumbnailClick = useCallback(
    (frameIndex: number | 'analysis') => {
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
        void loadQueue(false)
        setHasUnsyncedAnnotations(false)
      }
    },
    [frames, viewMode, selectedFrameIndex, hasUnsyncedAnnotations, loadQueue]
  )

  const handleBoxClick = useCallback(
    async (boxIndex: number, label: 'in' | 'out') => {
      if (!videoId || !db.isReady || !db.canEdit || !currentFrameBoxes) return
      try {
        const box = currentFrameBoxes.boxes.find(b => b.boxIndex === boxIndex)
        if (!box) return
        const isNewAnnotation = box.userLabel === null

        // Optimistic update
        setCurrentFrameBoxes(prev =>
          prev
            ? {
                ...prev,
                boxes: prev.boxes.map(b =>
                  b.boxIndex === boxIndex
                    ? {
                        ...b,
                        userLabel: label,
                        colorCode: label === 'in' ? 'annotated_in' : 'annotated_out',
                      }
                    : b
                ),
              }
            : prev
        )

        await db.saveAnnotations(currentFrameBoxes.frameIndex, [{ boxIndex, label }])
        frameBoxesCache.current.delete(currentFrameBoxes.frameIndex)
        setHasUnsyncedAnnotations(true)

        if (isNewAnnotation) {
          const newCount = annotationsSinceRecalc + 1
          setAnnotationsSinceRecalc(newCount)
          if (newCount >= RECALC_THRESHOLD) void recalculateCropRegion()
        }
      } catch (err) {
        console.error('Failed to save box annotation:', err)
        // Revert optimistic update by reloading
        setSelectedFrameIndex(prev => prev)
      }
    },
    [
      videoId,
      db.isReady,
      db.canEdit,
      db.saveAnnotations,
      currentFrameBoxes,
      annotationsSinceRecalc,
      recalculateCropRegion,
    ]
  )

  const handleClearAll = useCallback(async () => {
    if (!videoId || !db.isReady || !db.canEdit) return
    setIsRecalculating(true)
    try {
      const result = await db.clearAllAnnotations()
      console.log(`[Clear All] Deleted ${result.deletedCount} annotations`)
      await db.recalculatePredictions()
      await db.resetCropRegion()
      await loadQueue(false, true)
      await loadAnalysisBoxes()
      frameBoxesCache.current.clear()

      if (viewMode === 'frame' && selectedFrameIndex !== null) {
        const data = await db.getFrameBoxes(selectedFrameIndex)
        const converted = convertFrameBoxesData(data)
        setCurrentFrameBoxes(converted)
        frameBoxesCache.current.set(selectedFrameIndex, converted)
      }

      setAnnotationsSinceRecalc(0)
      showAlert?.(
        'Annotations Cleared',
        `Successfully cleared ${result.deletedCount} annotations and reset to seed model.`,
        'success'
      )
    } catch (err) {
      console.error('Error clearing annotations:', err)
      showAlert?.('Clear Failed', 'Failed to clear annotations', 'error')
    } finally {
      setIsRecalculating(false)
    }
  }, [videoId, db, viewMode, selectedFrameIndex, loadQueue, loadAnalysisBoxes, showAlert])

  // Lock management wrappers
  const acquireLock = useCallback(async () => {
    await db.acquireLock()
  }, [db.acquireLock])

  const releaseLock = useCallback(async () => {
    await db.releaseLock()
  }, [db.releaseLock])

  // Wrapper for setLayoutApproved to also call the database
  const setLayoutApproved = useCallback(
    (approved: boolean) => {
      setLayoutApprovedState(approved)
      if (approved && db.isReady && db.canEdit) {
        void db.approveLayout()
      }
    },
    [db.isReady, db.canEdit, db.approveLayout]
  )

  return {
    frames,
    layoutConfig,
    layoutApproved,
    loading,
    error,
    setError,
    setLoading,
    viewMode,
    selectedFrameIndex,
    currentFrameBoxes,
    loadingFrame,
    analysisBoxes,
    hasUnsyncedAnnotations,
    annotationsSinceRecalc,
    isRecalculating,
    cropRegionMismatch,
    analysisThumbnailUrl,
    setAnalysisThumbnailUrl,
    cropRegionEdit,
    setCropRegionEdit,
    boxStats,
    pulseStartTime,
    frameBoxesCache,
    loadQueue,
    loadAnalysisBoxes,
    recalculateCropRegion,
    handleThumbnailClick,
    handleBoxClick,
    setCurrentFrameBoxes,
    setHasUnsyncedAnnotations,
    setAnnotationsSinceRecalc,
    setLayoutApproved,
    handleClearAll,
    // New properties for lock status
    canEdit: db.canEdit,
    lockState: db.lockState,
    lockHolder: db.lockHolder ?? null,
    acquireLock,
    releaseLock,
  }
}
