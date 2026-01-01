/**
 * Hook for managing annotation data and operations in the Boundary Annotation workflow.
 * Handles CRUD operations, marking boundaries, and navigation between annotations.
 */

import { useCallback, useEffect, useRef } from 'react'

import type { Annotation } from '~/types/boundaries'

interface UseBoundaryAnnotationDataParams {
  videoId: string
  jumpRequestedRef: React.RefObject<boolean> // Signal to frame loader when navigation is a jump
  jumpTargetRef: React.RefObject<number | null> // Pending jump destination
  updateProgress: () => Promise<void>
  /** Callback when annotation changes require reloading visible annotations */
  onAnnotationsChanged?: (startFrame: number, endFrame: number) => Promise<void>
}

interface UseBoundaryAnnotationDataReturn {
  // State refs (for RAF loop synchronization)
  activeAnnotationRef: React.RefObject<Annotation | null>
  annotationsRef: React.RefObject<Annotation[]>
  markedStartRef: React.RefObject<number | null>
  markedEndRef: React.RefObject<number | null>
  hasPrevAnnotationRef: React.RefObject<boolean>
  hasNextAnnotationRef: React.RefObject<boolean>

  // Actions
  loadInitialAnnotation: () => Promise<void>
  loadAnnotationsForRange: (start: number, end: number) => Promise<void>
  saveAnnotation: (
    start: number,
    end: number,
    currentFrameIndexRef: React.RefObject<number>,
    visibleFramePositions: number[]
  ) => Promise<void>
  deleteAnnotation: (currentFrameIndexRef: React.RefObject<number>) => Promise<void>
  navigateToAnnotation: (
    direction: 'prev' | 'next',
    currentFrameIndexRef: React.RefObject<number>
  ) => Promise<void>
  jumpToFrameAnnotation: (
    frameNumber: number,
    totalFrames: number,
    currentFrameIndexRef: React.RefObject<number>
  ) => Promise<boolean>
  activateAnnotationAtFrame: (frameIndex: number) => Promise<void>

  // Marking
  markStart: (frameIndex: number, markedEnd: number | null) => void
  markEnd: (frameIndex: number, markedStart: number | null) => void
  clearMarks: () => void
}

/**
 * Hook for managing boundary annotation data and operations.
 */
export function useBoundaryAnnotationData({
  videoId,
  jumpRequestedRef,
  jumpTargetRef,
  updateProgress,
}: UseBoundaryAnnotationDataParams): UseBoundaryAnnotationDataReturn {
  // State refs
  const activeAnnotationRef = useRef<Annotation | null>(null)
  const annotationsRef = useRef<Annotation[]>([])
  const markedStartRef = useRef<number | null>(null)
  const markedEndRef = useRef<number | null>(null)
  const hasPrevAnnotationRef = useRef(false)
  const hasNextAnnotationRef = useRef(false)

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

  // Load initial annotation on mount
  const loadInitialAnnotation = useCallback(async () => {
    if (!videoId) return

    try {
      const encodedVideoId = encodeURIComponent(videoId)

      // Load next annotation to work on
      const nextResponse = await fetch(`/api/annotations/${encodedVideoId}/next`)
      const nextData = await nextResponse.json()

      if (nextData.annotation) {
        activeAnnotationRef.current = nextData.annotation
        markedStartRef.current = nextData.annotation.start_frame_index
        markedEndRef.current = nextData.annotation.end_frame_index

        // Initial load: check if there's any other annotation
        const allAnnotationsResponse = await fetch(
          `/api/annotations/${encodedVideoId}?start=0&end=999999`
        )
        const allAnnotationsData = await allAnnotationsResponse.json()
        hasPrevAnnotationRef.current =
          allAnnotationsData.annotations && allAnnotationsData.annotations.length > 1
        hasNextAnnotationRef.current = false

        // Return the start frame for navigation
        return nextData.annotation.start_frame_index
      }
    } catch (error) {
      console.error('Failed to load initial annotation:', error)
    }
    return null
  }, [videoId])

  // Load annotations for visible range
  const loadAnnotationsForRange = useCallback(
    async (startFrame: number, endFrame: number) => {
      if (!videoId) return
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

  // Save annotation
  const saveAnnotation = useCallback(
    async (
      start: number,
      end: number,
      currentFrameIndexRef: React.RefObject<number>,
      visibleFramePositions: number[]
    ) => {
      const activeAnnotation = activeAnnotationRef.current
      if (!activeAnnotation || start === null || end === null) return

      try {
        const encodedVideoId = encodeURIComponent(videoId)

        // Save the annotation with overlap resolution
        const saveResponse = await fetch(`/api/annotations/${encodedVideoId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: activeAnnotation.id,
            start_frame_index: start,
            end_frame_index: end,
            state: activeAnnotation.state === 'gap' ? 'confirmed' : activeAnnotation.state,
            pending: false,
          }),
        })

        if (!saveResponse.ok) {
          throw new Error('Failed to save annotation')
        }

        // Update progress from database
        await updateProgress()

        // Reload annotations in current visible range
        const startFrame = Math.min(...visibleFramePositions)
        const endFrame = Math.max(...visibleFramePositions)
        await loadAnnotationsForRange(startFrame, endFrame)

        // Load next annotation
        const nextResponse = await fetch(`/api/annotations/${encodedVideoId}/next`)
        const nextData = await nextResponse.json()

        if (nextData.annotation) {
          activeAnnotationRef.current = nextData.annotation
          jumpTargetRef.current = nextData.annotation.start_frame_index // Set pending jump target
          jumpRequestedRef.current = true // Signal frame loader: Save & Next is a jump
          markedStartRef.current = nextData.annotation.start_frame_index
          markedEndRef.current = nextData.annotation.end_frame_index
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
    },
    [videoId, updateProgress, loadAnnotationsForRange]
  )

  // Delete annotation
  const deleteAnnotation = useCallback(
    async (currentFrameIndexRef: React.RefObject<number>) => {
      const activeAnnotation = activeAnnotationRef.current
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
          jumpTargetRef.current = nextData.annotation.start_frame_index // Set pending jump target
          jumpRequestedRef.current = true // Signal frame loader: Delete Caption is a jump
          markedStartRef.current = nextData.annotation.start_frame_index
          markedEndRef.current = nextData.annotation.end_frame_index
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
    },
    [videoId, updateProgress]
  )

  // Navigate to previous/next annotation by updated_at time
  const navigateToAnnotation = useCallback(
    async (direction: 'prev' | 'next', currentFrameIndexRef: React.RefObject<number>) => {
      const activeAnnotation = activeAnnotationRef.current
      if (!activeAnnotation) return

      try {
        const encodedVideoId = encodeURIComponent(videoId)
        const response = await fetch(
          `/api/annotations/${encodedVideoId}/navigate?direction=${direction}&currentId=${activeAnnotation.id}`
        )
        const data = await response.json()

        if (data.annotation) {
          activeAnnotationRef.current = data.annotation
          jumpTargetRef.current = data.annotation.start_frame_index // Set pending jump target
          markedStartRef.current = data.annotation.start_frame_index
          markedEndRef.current = data.annotation.end_frame_index

          // After navigating, check both directions
          void checkNavigationAvailability(data.annotation.id)
        }
      } catch (error) {
        console.error(`Failed to navigate to ${direction} annotation:`, error)
      }
    },
    [videoId, checkNavigationAvailability]
  )

  // Jump to frame and load annotation containing it
  const jumpToFrameAnnotation = useCallback(
    async (
      frameNumber: number,
      totalFrames: number,
      currentFrameIndexRef: React.RefObject<number>
    ): Promise<boolean> => {
      if (isNaN(frameNumber) || frameNumber < 0 || frameNumber >= totalFrames) {
        alert(`Invalid frame number. Must be between 0 and ${totalFrames - 1}`)
        return false
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
          jumpTargetRef.current = frameNumber // Set pending jump target
          markedStartRef.current = annotation.start_frame_index
          markedEndRef.current = annotation.end_frame_index

          // After jumping, check navigation availability
          void checkNavigationAvailability(annotation.id)
          return true
        } else {
          alert(`No annotation found containing frame ${frameNumber}`)
          return false
        }
      } catch (error) {
        console.error('Failed to jump to frame:', error)
        alert('Failed to jump to frame')
        return false
      }
    },
    [videoId, checkNavigationAvailability]
  )

  // Activate annotation at current frame
  const activateAnnotationAtFrame = useCallback(
    async (frameIndex: number) => {
      try {
        const encodedVideoId = encodeURIComponent(videoId)
        const response = await fetch(
          `/api/annotations/${encodedVideoId}?start=${frameIndex}&end=${frameIndex}`
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
    },
    [videoId, checkNavigationAvailability]
  )

  // Marking functions
  const markStart = useCallback((frameIndex: number, markedEnd: number | null) => {
    markedStartRef.current = frameIndex
    // If marking start after current end, clear end to prevent invalid order
    if (markedEnd !== null && frameIndex > markedEnd) {
      markedEndRef.current = null
    }
  }, [])

  const markEnd = useCallback((frameIndex: number, markedStart: number | null) => {
    markedEndRef.current = frameIndex
    // If marking end before current start, clear start to prevent invalid order
    if (markedStart !== null && frameIndex < markedStart) {
      markedStartRef.current = null
    }
  }, [])

  const clearMarks = useCallback(() => {
    // Reset marks to original annotation boundaries (cancel any changes)
    const activeAnnotation = activeAnnotationRef.current
    if (activeAnnotation) {
      markedStartRef.current = activeAnnotation.start_frame_index
      markedEndRef.current = activeAnnotation.end_frame_index
    }
  }, [])

  return {
    // State refs
    activeAnnotationRef,
    annotationsRef,
    markedStartRef,
    markedEndRef,
    hasPrevAnnotationRef,
    hasNextAnnotationRef,

    // Actions
    loadInitialAnnotation,
    loadAnnotationsForRange,
    saveAnnotation,
    deleteAnnotation,
    navigateToAnnotation,
    jumpToFrameAnnotation,
    activateAnnotationAtFrame,

    // Marking
    markStart,
    markEnd,
    clearMarks,
  }
}
