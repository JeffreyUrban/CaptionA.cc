/**
 * Hook for managing annotation data and operations in the Boundary Annotation workflow.
 * Handles CRUD operations, marking boundaries, and navigation between annotations.
 */

import { useCallback, useRef } from 'react'

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
  loadInitialAnnotation: () => Promise<number | null>
  loadAnnotationsForRange: (start: number, end: number) => Promise<void>
  saveAnnotation: (
    start: number,
    end: number,
    currentFrameIndexRef: React.RefObject<number>,
    visibleFramePositions: number[]
  ) => Promise<void>
  markAsIssue: (
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

  // Navigation history stack (LIFO - current annotation is always at top)
  const navigationStackRef = useRef<number[]>([]) // Stack of annotation IDs

  // Annotation cache for efficient batch loading
  const annotationCacheRef = useRef<Annotation[]>([])
  const highestQueriedFrameRef = useRef<number>(0) // Track where we've queried up to
  const isLoadingInitialRef = useRef<boolean>(false) // Prevent concurrent initial loads

  // Refill annotation cache with next batch of workable annotations
  const refillCache = useCallback(async () => {
    const encodedVideoId = encodeURIComponent(videoId)
    const startFrame = highestQueriedFrameRef.current + 1

    try {
      const response = await fetch(
        `/api/annotations/${encodedVideoId}?start=${startFrame}&end=999999&workable=true&limit=20`
      )
      const data = await response.json()

      if (data.annotations && data.annotations.length > 0) {
        // Filter out any already in stack and add to cache
        const newAnnotations = data.annotations.filter(
          (a: Annotation) => !navigationStackRef.current.includes(a.id)
        )

        annotationCacheRef.current.push(...newAnnotations)

        // Update highest queried frame
        const lastAnnotation = data.annotations[data.annotations.length - 1]
        highestQueriedFrameRef.current = lastAnnotation.end_frame_index
      }
    } catch (error) {
      console.error('Failed to refill cache:', error)
    }
  }, [videoId])

  // Helper to check navigation availability (cache-based)
  const checkNavigationAvailability = useCallback(() => {
    // Prev: only available if stack has more than current annotation
    hasPrevAnnotationRef.current = navigationStackRef.current.length > 1

    // Next: available if cache has annotations
    hasNextAnnotationRef.current = annotationCacheRef.current.length > 0
  }, [])

  // Load initial annotation on mount
  const loadInitialAnnotation = useCallback(async () => {
    if (!videoId) return null

    // Skip if already loading or loaded (prevent React Strict Mode double-mount)
    if (isLoadingInitialRef.current) {
      // Wait for the other call to finish and return its result
      while (isLoadingInitialRef.current) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      return activeAnnotationRef.current?.start_frame_index ?? null
    }

    if (activeAnnotationRef.current !== null && navigationStackRef.current.length > 0) {
      return activeAnnotationRef.current.start_frame_index
    }

    // Set loading flag synchronously before async work
    isLoadingInitialRef.current = true

    try {
      // Reset cache and load first batch
      annotationCacheRef.current = []
      highestQueriedFrameRef.current = 0
      await refillCache()

      // Take first annotation from cache
      const firstAnnotation = annotationCacheRef.current.shift()

      if (firstAnnotation) {
        activeAnnotationRef.current = firstAnnotation
        markedStartRef.current = firstAnnotation.start_frame_index
        markedEndRef.current = firstAnnotation.end_frame_index

        // Initialize stack with first annotation
        navigationStackRef.current = [firstAnnotation.id]

        // Update button states
        checkNavigationAvailability()

        // Return the start frame for navigation
        return firstAnnotation.start_frame_index
      }
    } catch (error) {
      console.error('Failed to load initial annotation:', error)
    } finally {
      isLoadingInitialRef.current = false
    }
    return null
  }, [videoId, refillCache, checkNavigationAvailability])

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

        console.log('[saveAnnotation] Saving current annotation:', {
          id: activeAnnotation.id,
          old_start: activeAnnotation.start_frame_index,
          old_end: activeAnnotation.end_frame_index,
          new_start: start,
          new_end: end,
        })

        // Save the annotation with overlap resolution
        const saveResponse = await fetch(`/api/annotations/${encodedVideoId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: activeAnnotation.id,
            start_frame_index: start,
            end_frame_index: end,
            boundary_state: activeAnnotation.state === 'gap' ? 'confirmed' : activeAnnotation.state,
          }),
        })

        if (!saveResponse.ok) {
          throw new Error('Failed to save annotation')
        }

        const saveData = await saveResponse.json()
        const createdGaps = saveData.createdGaps ?? []

        // Update progress from database
        await updateProgress()

        // Signal workflow activity for opportunistic image regeneration
        window.dispatchEvent(new CustomEvent('annotation-saved'))

        // Select next annotation: prioritize newly created gaps over cache
        let selectedAnnotation: Annotation | null = null

        // Check if any created gaps are not in the navigation stack (unvisited)
        if (createdGaps.length > 0) {
          const unvisitedGaps = createdGaps.filter(
            (gap: Annotation) => !navigationStackRef.current.includes(gap.id)
          )

          if (unvisitedGaps.length > 0) {
            // Sort by start_frame_index and select the first one
            unvisitedGaps.sort(
              (a: Annotation, b: Annotation) => a.start_frame_index - b.start_frame_index
            )
            const firstGap = unvisitedGaps[0]
            if (firstGap) {
              selectedAnnotation = firstGap
              console.log('[saveAnnotation] Prioritizing newly created gap:', {
                id: firstGap.id,
                start_frame_index: firstGap.start_frame_index,
                end_frame_index: firstGap.end_frame_index,
              })
            }
          }
        }

        // Fall back to cache if no created gaps
        if (!selectedAnnotation) {
          // Get next annotation from cache (refill if empty)
          if (annotationCacheRef.current.length === 0) {
            await refillCache()
          }
          selectedAnnotation = annotationCacheRef.current.shift() ?? null
        }

        if (selectedAnnotation) {
          console.log('[saveAnnotation] Loaded next annotation:', {
            id: selectedAnnotation.id,
            start_frame_index: selectedAnnotation.start_frame_index,
            end_frame_index: selectedAnnotation.end_frame_index,
            boundary_state: selectedAnnotation.state,
          })

          activeAnnotationRef.current = selectedAnnotation
          jumpTargetRef.current = selectedAnnotation.start_frame_index // Set pending jump target
          jumpRequestedRef.current = true // Signal frame loader: Save & Next is a jump
          markedStartRef.current = selectedAnnotation.start_frame_index
          markedEndRef.current = selectedAnnotation.end_frame_index

          // Push new annotation to stack
          navigationStackRef.current.push(selectedAnnotation.id)

          // Check navigation availability for the new annotation
          checkNavigationAvailability()
        } else {
          console.log('[saveAnnotation] No more annotations not in stack - workflow complete')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jumpRequestedRef and jumpTargetRef are refs and don't need to be in dependencies
    [videoId, updateProgress, refillCache, checkNavigationAvailability]
  )

  // Mark annotation as issue (unclean boundaries)
  const markAsIssue = useCallback(
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

        console.log('[markAsIssue] Marking current annotation as issue:', {
          id: activeAnnotation.id,
          old_start: activeAnnotation.start_frame_index,
          old_end: activeAnnotation.end_frame_index,
          new_start: start,
          new_end: end,
        })

        // Save the annotation with 'issue' state
        const saveResponse = await fetch(`/api/annotations/${encodedVideoId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: activeAnnotation.id,
            start_frame_index: start,
            end_frame_index: end,
            boundary_state: 'issue',
          }),
        })

        if (!saveResponse.ok) {
          throw new Error('Failed to mark annotation as issue')
        }

        const saveData = await saveResponse.json()
        const createdGaps = saveData.createdGaps ?? []

        // Update progress from database
        await updateProgress()

        // Signal workflow activity for opportunistic image regeneration
        window.dispatchEvent(new CustomEvent('annotation-saved'))

        // Select next annotation: prioritize newly created gaps over cache
        let selectedAnnotation: Annotation | null = null

        // Check if any created gaps are not in the navigation stack (unvisited)
        if (createdGaps.length > 0) {
          const unvisitedGaps = createdGaps.filter(
            (gap: Annotation) => !navigationStackRef.current.includes(gap.id)
          )

          if (unvisitedGaps.length > 0) {
            // Sort by start_frame_index and select the first one
            unvisitedGaps.sort(
              (a: Annotation, b: Annotation) => a.start_frame_index - b.start_frame_index
            )
            const firstGap = unvisitedGaps[0]
            if (firstGap) {
              selectedAnnotation = firstGap
              console.log('[markAsIssue] Prioritizing newly created gap:', {
                id: firstGap.id,
                start_frame_index: firstGap.start_frame_index,
                end_frame_index: firstGap.end_frame_index,
              })
            }
          }
        }

        // Fall back to cache if no created gaps
        if (!selectedAnnotation) {
          // Get next annotation from cache (refill if empty)
          if (annotationCacheRef.current.length === 0) {
            await refillCache()
          }
          selectedAnnotation = annotationCacheRef.current.shift() ?? null
        }

        if (selectedAnnotation) {
          console.log('[markAsIssue] Loaded next annotation:', {
            id: selectedAnnotation.id,
            start_frame_index: selectedAnnotation.start_frame_index,
            end_frame_index: selectedAnnotation.end_frame_index,
            boundary_state: selectedAnnotation.state,
          })

          activeAnnotationRef.current = selectedAnnotation
          jumpTargetRef.current = selectedAnnotation.start_frame_index // Set pending jump target
          jumpRequestedRef.current = true // Signal frame loader: Mark as Issue auto-advances
          markedStartRef.current = selectedAnnotation.start_frame_index
          markedEndRef.current = selectedAnnotation.end_frame_index

          // Push new annotation to stack
          navigationStackRef.current.push(selectedAnnotation.id)

          // Check navigation availability for the new annotation
          checkNavigationAvailability()
        } else {
          console.log('[markAsIssue] No more annotations not in stack - workflow complete')
          // No more annotations - workflow complete
          activeAnnotationRef.current = null
          markedStartRef.current = null
          markedEndRef.current = null
          hasPrevAnnotationRef.current = false
          hasNextAnnotationRef.current = false
        }
      } catch (error) {
        console.error('Failed to mark annotation as issue:', error)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jumpRequestedRef and jumpTargetRef are refs and don't need to be in dependencies
    [videoId, updateProgress, refillCache, checkNavigationAvailability]
  )

  // Delete annotation
  const deleteAnnotation = useCallback(
    async (_currentFrameIndexRef: React.RefObject<number>) => {
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

        // Get next annotation from cache (refill if empty)
        if (annotationCacheRef.current.length === 0) {
          await refillCache()
        }

        const selectedAnnotation = annotationCacheRef.current.shift() ?? null

        if (selectedAnnotation) {
          activeAnnotationRef.current = selectedAnnotation
          jumpTargetRef.current = selectedAnnotation.start_frame_index // Set pending jump target
          jumpRequestedRef.current = true // Signal frame loader: Delete Caption is a jump
          markedStartRef.current = selectedAnnotation.start_frame_index
          markedEndRef.current = selectedAnnotation.end_frame_index

          // Push new annotation to stack
          navigationStackRef.current.push(selectedAnnotation.id)

          // Check navigation availability for the new annotation
          checkNavigationAvailability()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jumpRequestedRef and jumpTargetRef are refs and don't need to be in dependencies
    [videoId, updateProgress, refillCache, checkNavigationAvailability]
  )

  // Navigate to previous/next annotation with stack-based navigation
  const navigateToAnnotation = useCallback(
    async (direction: 'prev' | 'next', _currentFrameIndexRef: React.RefObject<number>) => {
      const activeAnnotation = activeAnnotationRef.current

      console.log(
        `[navigateToAnnotation] Called. direction=${direction}, stack=`,
        navigationStackRef.current
      )

      // Signal workflow activity for opportunistic image regeneration
      window.dispatchEvent(new CustomEvent('annotation-navigated'))

      if (!activeAnnotation) return

      if (direction === 'prev') {
        // Prev: pop from stack and go to new top (session-based only)
        if (navigationStackRef.current.length > 1) {
          // Pop current annotation from stack
          navigationStackRef.current.pop()
          const prevAnnotationId = navigationStackRef.current[navigationStackRef.current.length - 1]

          console.log(
            `[navigateToAnnotation] Popped from stack, going to ${prevAnnotationId}, new stack:`,
            navigationStackRef.current
          )

          try {
            const encodedVideoId = encodeURIComponent(videoId)
            const response = await fetch(`/api/annotations/${encodedVideoId}?start=0&end=999999`)
            const data = await response.json()
            const annotation = data.annotations?.find((a: Annotation) => a.id === prevAnnotationId)

            if (annotation) {
              activeAnnotationRef.current = annotation
              jumpTargetRef.current = annotation.start_frame_index
              jumpRequestedRef.current = true // Signal frame loader to jump to new position
              markedStartRef.current = annotation.start_frame_index
              markedEndRef.current = annotation.end_frame_index

              // Check navigation availability
              checkNavigationAvailability()
            }
          } catch (error) {
            console.error('Failed to load annotation from stack:', error)
          }
        } else {
          // Stack only has one element - Prev should be disabled
          console.log('[navigateToAnnotation] Prev called but stack only has one element')
        }
      } else {
        // Next: get from cache (refill if empty)
        if (annotationCacheRef.current.length === 0) {
          await refillCache()
        }

        const nextAnnotation = annotationCacheRef.current.shift()

        if (nextAnnotation) {
          // Push to stack
          navigationStackRef.current.push(nextAnnotation.id)

          console.log('[navigateToAnnotation] Navigated to next:', {
            stack: navigationStackRef.current,
            annotation: nextAnnotation.id,
            cacheRemaining: annotationCacheRef.current.length,
          })

          activeAnnotationRef.current = nextAnnotation
          jumpTargetRef.current = nextAnnotation.start_frame_index
          jumpRequestedRef.current = true // Signal frame loader to jump to new position
          markedStartRef.current = nextAnnotation.start_frame_index
          markedEndRef.current = nextAnnotation.end_frame_index

          checkNavigationAvailability()
        } else {
          console.log('[navigateToAnnotation] No more annotations available')
          hasNextAnnotationRef.current = false
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jumpTargetRef is a ref and doesn't need to be in dependencies
    [videoId, refillCache, checkNavigationAvailability]
  )

  // Jump to frame and load annotation containing it
  const jumpToFrameAnnotation = useCallback(
    async (
      frameNumber: number,
      totalFrames: number,
      _currentFrameIndexRef: React.RefObject<number>
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
          checkNavigationAvailability()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jumpTargetRef is a ref and doesn't need to be in dependencies
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
          checkNavigationAvailability()
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
    markAsIssue,
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
