/**
 * Hook that combines all boundary workflow hooks and provides a unified state interface.
 * This reduces the main component to just rendering and event handlers.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'

import { useBoundaryAnnotationData } from './useBoundaryAnnotationData'
import { useBoundaryDisplaySync } from './useBoundaryDisplaySync'
import { useBoundaryDragScroll } from './useBoundaryDragScroll'
import { useBoundaryFrameLoader } from './useBoundaryFrameLoader'
import { useBoundaryKeyboardShortcuts } from './useBoundaryKeyboardShortcuts'
import { useVideoMetadata } from './useVideoMetadata'
import { useVideoTouched } from './useVideoTouched'
import { useWorkflowProgress } from './useWorkflowProgress'

import type { BoundaryDisplayState, FrameSpacing, Annotation } from '~/types/boundaries'
import {
  calculateFrameOpacity,
  calculateVisibleFramePositions,
  getAnnotationsForFrame,
} from '~/utils/boundary-helpers'

interface UseBoundaryWorkflowStateParams {
  videoId: string
}

interface UseBoundaryWorkflowStateReturn {
  // Loading state
  isLoadingMetadata: boolean

  // Display state (synced from refs at 60fps)
  displayState: BoundaryDisplayState

  // Computed values
  visibleFramePositions: number[]
  canSave: boolean
  totalFrames: number
  cropWidth: number
  cropHeight: number

  // UI state
  frameSpacing: FrameSpacing
  setFrameSpacing: (spacing: FrameSpacing) => void
  jumpToFrameInput: string
  setJumpToFrameInput: (value: string) => void
  showHelpModal: boolean
  setShowHelpModal: (show: boolean) => void

  // Callbacks
  getOpacity: (frameIndex: number) => number
  getAnnotationsForFrame: (frameIndex: number) => Annotation[]
  handleDragStart: (e: React.MouseEvent) => void

  // Actions
  markStart: () => void
  markEnd: () => void
  markStartAt: (framePosition: number) => void
  markEndAt: (framePosition: number) => void
  jumpToStart: () => void
  jumpToEnd: () => void
  clearMarks: () => void
  saveAnnotation: () => Promise<void>
  deleteAnnotation: () => Promise<void>
  navigateToAnnotation: (direction: 'prev' | 'next') => Promise<void>
  jumpToFrame: () => Promise<void>
  activateCurrentFrameAnnotation: () => Promise<void>
  navigateFrame: (delta: number) => void
}

export function useBoundaryWorkflowState({
  videoId,
}: UseBoundaryWorkflowStateParams): UseBoundaryWorkflowStateReturn {
  // Load video metadata and workflow progress
  const { metadata, loading: isLoadingMetadata } = useVideoMetadata(videoId)
  const {
    workflowProgress: workflowProgressHook,
    completedFrames: completedFramesHook,
    updateProgress,
  } = useWorkflowProgress(videoId)

  // Mark this video as being worked on
  useVideoTouched(videoId)

  // Extract metadata values
  const totalFrames = metadata?.totalFrames ?? 0
  const cropWidth = metadata?.cropWidth ?? 0
  const cropHeight = metadata?.cropHeight ?? 0

  // Refs for workflow progress (synced to display state)
  const workflowProgressRef = useRef(0)
  const completedFramesRef = useRef(0)
  const currentFrameIndexRef = useRef(0)

  // Sync hook values to refs
  useEffect(() => {
    workflowProgressRef.current = workflowProgressHook
    completedFramesRef.current = completedFramesHook
  }, [workflowProgressHook, completedFramesHook])

  // Core hooks
  const annotationData = useBoundaryAnnotationData({ videoId, updateProgress })

  const { framesRef } = useBoundaryFrameLoader({
    videoId,
    currentFrameIndex: currentFrameIndexRef.current,
    totalFrames,
    isReady: !isLoadingMetadata,
  })

  const { cursorStyleRef, handleDragStart } = useBoundaryDragScroll({
    currentFrameIndex: currentFrameIndexRef.current,
    totalFrames,
    onFrameChange: (newFrame: number) => {
      currentFrameIndexRef.current = newFrame
    },
  })

  // Display sync hook
  const { displayState } = useBoundaryDisplaySync({
    refs: {
      currentFrameIndexRef,
      framesRef,
      annotationsRef: annotationData.annotationsRef,
      activeAnnotationRef: annotationData.activeAnnotationRef,
      markedStartRef: annotationData.markedStartRef,
      markedEndRef: annotationData.markedEndRef,
      hasPrevAnnotationRef: annotationData.hasPrevAnnotationRef,
      hasNextAnnotationRef: annotationData.hasNextAnnotationRef,
      workflowProgressRef,
      completedFramesRef,
      cursorStyleRef,
    },
  })

  const { currentFrameIndex, annotations, markedStart, markedEnd } = displayState

  // UI state
  const [frameSpacing, setFrameSpacing] = useState<FrameSpacing>('linear')
  const [windowHeight, setWindowHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 1000
  )
  const [jumpToFrameInput, setJumpToFrameInput] = useState('')
  const [showHelpModal, setShowHelpModal] = useState(false)

  // Track window height
  useEffect(() => {
    if (typeof window === 'undefined') return
    setWindowHeight(window.innerHeight)
    const handleResize = () => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Computed values
  const visibleFramePositions = useMemo(
    () =>
      calculateVisibleFramePositions(
        currentFrameIndex,
        totalFrames,
        windowHeight,
        cropWidth,
        cropHeight
      ),
    [currentFrameIndex, totalFrames, windowHeight, cropWidth, cropHeight]
  )

  const getOpacity = useCallback(
    (frameIndex: number) => calculateFrameOpacity(frameIndex, currentFrameIndex),
    [currentFrameIndex]
  )

  const getAnnotationsForFrameCallback = useCallback(
    (frameIndex: number) => getAnnotationsForFrame(annotations, frameIndex),
    [annotations]
  )

  const canSave = markedStart !== null && markedEnd !== null && markedStart <= markedEnd

  // Navigation and marking functions
  const navigateFrame = useCallback(
    (delta: number) => {
      currentFrameIndexRef.current = Math.max(
        0,
        Math.min(currentFrameIndexRef.current + delta, totalFrames - 1)
      )
    },
    [totalFrames]
  )

  const markStart = useCallback(
    () => annotationData.markStart(currentFrameIndex, markedEnd),
    [annotationData, currentFrameIndex, markedEnd]
  )

  const markEnd = useCallback(
    () => annotationData.markEnd(currentFrameIndex, markedStart),
    [annotationData, currentFrameIndex, markedStart]
  )

  const markStartAt = useCallback(
    (framePosition: number) => annotationData.markStart(framePosition, markedEnd),
    [annotationData, markedEnd]
  )

  const markEndAt = useCallback(
    (framePosition: number) => annotationData.markEnd(framePosition, markedStart),
    [annotationData, markedStart]
  )

  const jumpToStart = useCallback(() => {
    if (markedStart !== null) currentFrameIndexRef.current = markedStart
  }, [markedStart])

  const jumpToEnd = useCallback(() => {
    if (markedEnd !== null) currentFrameIndexRef.current = markedEnd
  }, [markedEnd])

  // Annotation actions
  const saveAnnotation = useCallback(async () => {
    if (!canSave || markedStart === null || markedEnd === null) return
    await annotationData.saveAnnotation(
      markedStart,
      markedEnd,
      currentFrameIndexRef,
      visibleFramePositions
    )
  }, [canSave, markedStart, markedEnd, annotationData, visibleFramePositions])

  const deleteAnnotation = useCallback(
    async () => annotationData.deleteAnnotation(currentFrameIndexRef),
    [annotationData]
  )

  const navigateToAnnotation = useCallback(
    async (direction: 'prev' | 'next') =>
      annotationData.navigateToAnnotation(direction, currentFrameIndexRef),
    [annotationData]
  )

  const jumpToFrame = useCallback(async () => {
    const success = await annotationData.jumpToFrameAnnotation(
      parseInt(jumpToFrameInput),
      totalFrames,
      currentFrameIndexRef
    )
    if (success) setJumpToFrameInput('')
  }, [jumpToFrameInput, totalFrames, annotationData])

  const activateCurrentFrameAnnotation = useCallback(
    async () => annotationData.activateAnnotationAtFrame(currentFrameIndex),
    [annotationData, currentFrameIndex]
  )

  // Load annotations in visible range
  useEffect(() => {
    if (visibleFramePositions.length === 0) return
    const startFrame = Math.min(...visibleFramePositions)
    const endFrame = Math.max(...visibleFramePositions)
    void annotationData.loadAnnotationsForRange(startFrame, endFrame)
  }, [visibleFramePositions, annotationData])

  // Keyboard shortcuts
  useBoundaryKeyboardShortcuts({
    navigateFrame,
    jumpToStart,
    jumpToEnd,
    markStart,
    markEnd,
    saveAnnotation,
    clearMarks: annotationData.clearMarks,
  })

  // Mouse wheel handler
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.frame-stack-container')) {
        e.preventDefault()
        navigateFrame(e.deltaY > 0 ? 1 : -1)
      }
    }
    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [navigateFrame])

  return {
    isLoadingMetadata,
    displayState,
    visibleFramePositions,
    canSave,
    totalFrames,
    cropWidth,
    cropHeight,
    frameSpacing,
    setFrameSpacing,
    jumpToFrameInput,
    setJumpToFrameInput,
    showHelpModal,
    setShowHelpModal,
    getOpacity,
    getAnnotationsForFrame: getAnnotationsForFrameCallback,
    handleDragStart,
    markStart,
    markEnd,
    markStartAt,
    markEndAt,
    jumpToStart,
    jumpToEnd,
    clearMarks: annotationData.clearMarks,
    saveAnnotation,
    deleteAnnotation,
    navigateToAnnotation,
    jumpToFrame,
    activateCurrentFrameAnnotation,
    navigateFrame,
  }
}
