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

import type { BoundaryDisplayState, Annotation } from '~/types/boundaries'
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
  isInitialized: boolean
  isSaving: boolean

  // Display state (synced from refs at 60fps)
  displayState: BoundaryDisplayState

  // Computed values
  visibleFramePositions: number[]
  canSave: boolean
  totalFrames: number
  cropWidth: number
  cropHeight: number

  // UI state
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
  markAsIssue: () => Promise<void>
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

  // Track if we've initialized the starting frame position
  const [isInitialized, setIsInitialized] = useState(false)
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
  const jumpRequestedRef = useRef(false) // Signal to frame loader to load exact frames
  const jumpTargetRef = useRef<number | null>(null) // Pending jump destination (null = no pending jump)

  // Sync hook values to refs
  useEffect(() => {
    workflowProgressRef.current = workflowProgressHook
    completedFramesRef.current = completedFramesHook
  }, [workflowProgressHook, completedFramesHook])

  // Create framesRef in parent to break circular dependency
  const framesRef = useRef<Map<number, import('~/types/boundaries').Frame>>(new Map())

  // Core hooks
  const annotationData = useBoundaryAnnotationData({
    videoId,
    jumpRequestedRef,
    jumpTargetRef,
    updateProgress,
  })

  // Load initial annotation and navigate to it BEFORE starting frame loader
  // Only run once per videoId to avoid infinite loop
  useEffect(() => {
    const loadInitial = async () => {
      const startFrame = await annotationData.loadInitialAnnotation()
      if (startFrame !== null && startFrame !== undefined) {
        jumpTargetRef.current = startFrame // Set pending jump target
        jumpRequestedRef.current = true // Signal frame loader: load exact frames, then jump
      }
      setIsInitialized(true)
    }
    void loadInitial()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId])

  // Frame loader hook (only starts after initial position is set)
  useBoundaryFrameLoader({
    videoId,
    currentFrameIndexRef, // Pass ref itself, not .current value
    jumpRequestedRef, // Signal when user explicitly jumps
    jumpTargetRef, // Pending jump destination
    totalFrames,
    framesRef,
    isReady: !isLoadingMetadata && isInitialized,
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
  const [windowHeight, setWindowHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 1000
  )
  const [jumpToFrameInput, setJumpToFrameInput] = useState('')
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

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
    if (markedStart !== null) {
      jumpTargetRef.current = markedStart // Set pending jump target
      jumpRequestedRef.current = true // Signal frame loader: load exact frames, then jump
    }
  }, [markedStart])

  const jumpToEnd = useCallback(() => {
    if (markedEnd !== null) {
      jumpTargetRef.current = markedEnd // Set pending jump target
      jumpRequestedRef.current = true // Signal frame loader: load exact frames, then jump
    }
  }, [markedEnd])

  // Annotation actions
  const saveAnnotation = useCallback(async () => {
    if (!canSave || markedStart === null || markedEnd === null) return
    setIsSaving(true)
    try {
      await annotationData.saveAnnotation(
        markedStart,
        markedEnd,
        currentFrameIndexRef,
        visibleFramePositions
      )
    } finally {
      setIsSaving(false)
    }
  }, [canSave, markedStart, markedEnd, annotationData, visibleFramePositions])

  const markAsIssue = useCallback(async () => {
    if (!canSave || markedStart === null || markedEnd === null) return
    setIsSaving(true)
    try {
      await annotationData.markAsIssue(
        markedStart,
        markedEnd,
        currentFrameIndexRef,
        visibleFramePositions
      )
    } finally {
      setIsSaving(false)
    }
  }, [canSave, markedStart, markedEnd, annotationData, visibleFramePositions])

  const deleteAnnotation = useCallback(
    async () => annotationData.deleteAnnotation(currentFrameIndexRef),
    [annotationData]
  )

  const navigateToAnnotation = useCallback(
    async (direction: 'prev' | 'next') => {
      await annotationData.navigateToAnnotation(direction, currentFrameIndexRef)
      // Frame index already updated by navigateToAnnotation, no jump signal needed
    },
    [annotationData]
  )

  const jumpToFrame = useCallback(async () => {
    const success = await annotationData.jumpToFrameAnnotation(
      parseInt(jumpToFrameInput),
      totalFrames,
      currentFrameIndexRef
    )
    if (success) {
      // Frame index already updated by jumpToFrameAnnotation, no jump signal needed
      setJumpToFrameInput('')
    }
  }, [jumpToFrameInput, totalFrames, annotationData])

  const activateCurrentFrameAnnotation = useCallback(
    async () => annotationData.activateAnnotationAtFrame(currentFrameIndex),
    [annotationData, currentFrameIndex]
  )

  // Load annotations in visible range (with deduplication to prevent infinite loops)
  const lastAnnotationRangeRef = useRef<{ start: number; end: number } | null>(null)
  useEffect(() => {
    if (visibleFramePositions.length === 0) return
    const startFrame = Math.min(...visibleFramePositions)
    const endFrame = Math.max(...visibleFramePositions)

    // Only load if range actually changed (prevents infinite loop from array recreation)
    const lastRange = lastAnnotationRangeRef.current
    if (lastRange && lastRange.start === startFrame && lastRange.end === endFrame) {
      return
    }

    lastAnnotationRangeRef.current = { start: startFrame, end: endFrame }
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
    isInitialized,
    isSaving,
    displayState,
    visibleFramePositions,
    canSave,
    totalFrames,
    cropWidth,
    cropHeight,
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
    markAsIssue,
    deleteAnnotation,
    navigateToAnnotation,
    jumpToFrame,
    activateCurrentFrameAnnotation,
    navigateFrame,
  }
}
