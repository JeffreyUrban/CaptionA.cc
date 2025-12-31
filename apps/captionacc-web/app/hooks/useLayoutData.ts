/**
 * Custom hook for managing Layout annotation data fetching and state.
 * Extracts the data management logic from the main AnnotateLayout component.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

import type {
  FrameInfo,
  LayoutConfig,
  BoxData,
  FrameBoxesData,
  ViewMode,
  LayoutQueueResponse,
  BoxStats,
  CropBoundsEdit,
  SelectionRectEdit,
  LayoutParamsEdit,
  EditStateUpdaters,
} from '~/types/layout'
import { RECALC_THRESHOLD } from '~/types/layout'
import {
  fetchLayoutQueue,
  fetchAnalysisBoxes,
  fetchFrameBoxes,
  saveBoxAnnotations,
  recalculatePredictions,
  resetCropBounds,
  clearAllAnnotations,
  prefetchFrameBoxes,
} from '~/utils/layout-api'

interface UseLayoutDataParams {
  videoId: string
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
  analysisThumbnailUrl: string | null
  setAnalysisThumbnailUrl: (url: string | null) => void
  cropBoundsEdit: CropBoundsEdit | null
  setCropBoundsEdit: (value: CropBoundsEdit | null) => void
  boxStats: BoxStats | null
  pulseStartTime: number
  frameBoxesCache: React.RefObject<Map<number, FrameBoxesData>>
  loadQueue: (showLoading?: boolean, skipEditStateUpdate?: boolean) => Promise<void>
  loadAnalysisBoxes: () => Promise<void>
  recalculateCropBounds: () => Promise<void>
  handleThumbnailClick: (frameIndex: number | 'analysis') => void
  handleBoxClick: (boxIndex: number, label: 'in' | 'out') => Promise<void>
  setCurrentFrameBoxes: React.Dispatch<React.SetStateAction<FrameBoxesData | null>>
  setHasUnsyncedAnnotations: (value: boolean) => void
  setAnnotationsSinceRecalc: (count: number) => void
  setLayoutApproved: (approved: boolean) => void
  handleClearAll: () => Promise<void>
}

function updateEditStateFromConfig(layoutConfig: LayoutConfig, updaters: EditStateUpdaters): void {
  updaters.setCropBoundsEdit({
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
  data: LayoutQueueResponse,
  skipEditStateUpdate: boolean,
  setFrames: (frames: FrameInfo[]) => void,
  setLayoutConfig: (config: LayoutConfig | null) => void,
  setLayoutApproved: (approved: boolean) => void,
  editUpdaters: EditStateUpdaters
): void {
  setFrames(data.frames ?? [])
  setLayoutConfig(data.layoutConfig ?? null)
  setLayoutApproved(data.layoutApproved ?? false)

  if (data.layoutConfig && !skipEditStateUpdate) {
    updateEditStateFromConfig(data.layoutConfig, editUpdaters)
  }
}

export function useLayoutData({ videoId }: UseLayoutDataParams): UseLayoutDataReturn {
  const [frames, setFrames] = useState<FrameInfo[]>([])
  const [layoutConfig, setLayoutConfig] = useState<LayoutConfig | null>(null)
  const [layoutApproved, setLayoutApproved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('analysis')
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null)
  const [currentFrameBoxes, setCurrentFrameBoxes] = useState<FrameBoxesData | null>(null)
  const [loadingFrame, setLoadingFrame] = useState(false)
  const [analysisBoxes, setAnalysisBoxes] = useState<BoxData[] | null>(null)
  const [hasUnsyncedAnnotations, setHasUnsyncedAnnotations] = useState(false)
  const [annotationsSinceRecalc, setAnnotationsSinceRecalc] = useState(0)
  const [analysisThumbnailUrl, setAnalysisThumbnailUrl] = useState<string | null>(null)
  const [pulseStartTime, setPulseStartTime] = useState(Date.now())
  const [cropBoundsEdit, setCropBoundsEdit] = useState<CropBoundsEdit | null>(null)
  const [, setSelectionRectEdit] = useState<SelectionRectEdit | null>(null)
  const [, setLayoutParamsEdit] = useState<LayoutParamsEdit | null>(null)

  const frameBoxesCache = useRef<Map<number, FrameBoxesData>>(new Map())

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
    () => ({ setCropBoundsEdit, setSelectionRectEdit, setLayoutParamsEdit }),
    []
  )

  useEffect(() => {
    if (frames.length > 0 && selectedFrameIndex === null) {
      const firstFrame = frames[0]
      if (firstFrame) setSelectedFrameIndex(firstFrame.frameIndex)
    }
  }, [frames, selectedFrameIndex])

  useEffect(() => {
    if (selectedFrameIndex !== null) setPulseStartTime(Date.now())
  }, [selectedFrameIndex])

  const loadQueue = useCallback(
    async (showLoading = true, skipEditStateUpdate = false) => {
      if (!videoId) return
      if (showLoading) setError(null)

      try {
        const data = await fetchLayoutQueue(videoId)
        processQueueResponse(
          data,
          skipEditStateUpdate,
          setFrames,
          setLayoutConfig,
          setLayoutApproved,
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
    [videoId, editUpdaters]
  )

  const loadAnalysisBoxes = useCallback(async () => {
    if (!videoId) return
    try {
      const data = await fetchAnalysisBoxes(videoId)
      setAnalysisBoxes(data.boxes ?? [])
    } catch (loadError) {
      console.error('Error loading analysis boxes:', loadError)
    }
  }, [videoId])

  const recalculateCropBounds = useCallback(async () => {
    if (!videoId) return
    try {
      await recalculatePredictions(videoId)
      const result = await resetCropBounds(videoId)
      if (!result.success) {
        alert(result.message)
        setError(result.message ?? null)
        setAnnotationsSinceRecalc(0)
        return
      }
      await loadQueue(false, true)
      await loadAnalysisBoxes()
      setAnnotationsSinceRecalc(0)
    } catch (recalcError) {
      console.error('Error recalculating crop bounds:', recalcError)
    }
  }, [videoId, loadQueue, loadAnalysisBoxes])

  useEffect(() => {
    if (!videoId || frames.length === 0) return
    void prefetchFrameBoxes(videoId, frames, frameBoxesCache.current)
  }, [videoId, frames])

  useEffect(() => {
    if (!videoId) return
    void loadAnalysisBoxes()
    void loadQueue(true)
  }, [videoId, loadAnalysisBoxes, loadQueue])

  useEffect(() => {
    if (!error?.startsWith('Processing:')) return
    const pollInterval = setInterval(() => {
      setError(null)
      void loadQueue(true)
    }, 3000)
    return () => clearInterval(pollInterval)
  }, [error, loadQueue])

  useEffect(() => {
    if (!videoId || viewMode !== 'frame' || selectedFrameIndex === null) return
    const cached = frameBoxesCache.current.get(selectedFrameIndex)
    if (cached) {
      setCurrentFrameBoxes(cached)
      setLoadingFrame(false)
      return
    }

    const loadFrameBoxes = async () => {
      setLoadingFrame(true)
      try {
        const data = await fetchFrameBoxes(videoId, selectedFrameIndex)
        frameBoxesCache.current.set(selectedFrameIndex, data)
        setCurrentFrameBoxes(data)
      } catch (err) {
        console.error('Failed to load frame boxes:', err)
        setCurrentFrameBoxes(null)
      }
      setLoadingFrame(false)
    }
    void loadFrameBoxes()
  }, [videoId, viewMode, selectedFrameIndex])

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
      if (!videoId || !currentFrameBoxes) return
      try {
        const box = currentFrameBoxes.boxes.find(b => b.boxIndex === boxIndex)
        if (!box) return
        const isNewAnnotation = box.userLabel === null

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

        await saveBoxAnnotations(videoId, currentFrameBoxes.frameIndex, [{ boxIndex, label }])
        frameBoxesCache.current.delete(currentFrameBoxes.frameIndex)
        setHasUnsyncedAnnotations(true)

        if (isNewAnnotation) {
          const newCount = annotationsSinceRecalc + 1
          setAnnotationsSinceRecalc(newCount)
          if (newCount >= RECALC_THRESHOLD) void recalculateCropBounds()
        }
      } catch (err) {
        console.error('Failed to save box annotation:', err)
        setSelectedFrameIndex(prev => prev)
      }
    },
    [videoId, currentFrameBoxes, annotationsSinceRecalc, recalculateCropBounds]
  )

  const handleClearAll = useCallback(async () => {
    if (!videoId) return
    try {
      const result = await clearAllAnnotations(videoId)
      console.log(`[Clear All] Deleted ${result.deletedCount} annotations`)
      await recalculatePredictions(videoId)
      await resetCropBounds(videoId)
      await loadQueue(false, true)
      await loadAnalysisBoxes()
      frameBoxesCache.current.clear()

      if (viewMode === 'frame' && selectedFrameIndex !== null) {
        const data = await fetchFrameBoxes(videoId, selectedFrameIndex)
        setCurrentFrameBoxes(data)
        frameBoxesCache.current.set(selectedFrameIndex, data)
      }

      setAnnotationsSinceRecalc(0)
      alert(`Successfully cleared ${result.deletedCount} annotations and reset to seed model.`)
    } catch (err) {
      console.error('Error clearing annotations:', err)
      alert('Failed to clear annotations')
    }
  }, [videoId, viewMode, selectedFrameIndex, loadQueue, loadAnalysisBoxes])

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
    analysisThumbnailUrl,
    setAnalysisThumbnailUrl,
    cropBoundsEdit,
    setCropBoundsEdit,
    boxStats,
    pulseStartTime,
    frameBoxesCache,
    loadQueue,
    loadAnalysisBoxes,
    recalculateCropBounds,
    handleThumbnailClick,
    handleBoxClick,
    setCurrentFrameBoxes,
    setHasUnsyncedAnnotations,
    setAnnotationsSinceRecalc,
    setLayoutApproved,
    handleClearAll,
  }
}
