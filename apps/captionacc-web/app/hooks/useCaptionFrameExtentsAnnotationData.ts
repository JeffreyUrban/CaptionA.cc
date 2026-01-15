/**
 * Hook for managing annotation data and operations in the Caption Frame Extents Annotation workflow.
 * Handles CRUD operations, marking caption frame extents, and navigation between annotations.
 *
 * Uses CR-SQLite local database with WebSocket sync instead of REST API calls.
 */

import { useCallback, useRef, useEffect } from 'react'

import type { Annotation } from '~/types/caption-frame-extents'
import { useCaptionsDatabase } from './useCaptionsDatabase'
import type { CaptionAnnotationData, CaptionFrameExtentState } from '~/services/database-queries'

interface UseCaptionFrameExtentsAnnotationDataParams {
  videoId: string
  /** Tenant ID for database initialization */
  tenantId?: string
  jumpRequestedRef: React.RefObject<boolean> // Signal to frame loader when navigation is a jump
  jumpTargetRef: React.RefObject<number | null> // Pending jump destination
  updateProgress: () => Promise<void>
  /** Callback when annotation changes require reloading visible annotations */
  onAnnotationsChanged?: (startFrame: number, endFrame: number) => Promise<void>
}

interface UseCaptionFrameExtentsAnnotationDataReturn {
  // State refs (for RAF loop synchronization)
  activeAnnotationRef: React.RefObject<Annotation | null>
  nextAnnotationRef: React.RefObject<Annotation | null> // Next annotation for preloading
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

  // Database state
  isReady: boolean
  canEdit: boolean
}

/**
 * Convert database annotation to UI annotation format.
 */
function toUIAnnotation(dbAnnotation: CaptionAnnotationData): Annotation {
  return {
    id: dbAnnotation.id,
    start_frame_index: dbAnnotation.start_frame_index,
    end_frame_index: dbAnnotation.end_frame_index,
    state: dbAnnotation.caption_frame_extents_state,
    pending: dbAnnotation.caption_frame_extents_pending === 1,
    text: dbAnnotation.text,
    created_at: dbAnnotation.created_at,
    updated_at: dbAnnotation.caption_frame_extents_updated_at ?? undefined,
  }
}

/**
 * Hook for managing caption frame extents annotation data and operations.
 */
export function useCaptionFrameExtentsAnnotationData({
  videoId,
  tenantId,
  jumpRequestedRef,
  jumpTargetRef,
  updateProgress,
}: UseCaptionFrameExtentsAnnotationDataParams): UseCaptionFrameExtentsAnnotationDataReturn {
  // State refs
  const activeAnnotationRef = useRef<Annotation | null>(null)
  const nextAnnotationRef = useRef<Annotation | null>(null)
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

  // Use the captions database hook
  const captionsDb = useCaptionsDatabase({
    videoId,
    tenantId,
    autoAcquireLock: true,
  })

  // Refill annotation cache with next batch of workable annotations
  const refillCache = useCallback(async () => {
    if (!captionsDb.isReady) return

    const startFrame = highestQueriedFrameRef.current + 1

    try {
      const result = await captionsDb.getFrameExtentsQueue({
        startFrame,
        workable: true,
        limit: 20,
      })

      if (result.annotations && result.annotations.length > 0) {
        // Convert to UI format and filter out any already in stack
        const newAnnotations = result.annotations
          .map(toUIAnnotation)
          .filter(a => !navigationStackRef.current.includes(a.id))

        annotationCacheRef.current.push(...newAnnotations)

        // Update highest queried frame
        const lastAnnotation = result.annotations[result.annotations.length - 1]
        if (lastAnnotation) {
          highestQueriedFrameRef.current = lastAnnotation.end_frame_index
        }
      }
    } catch (error) {
      console.error('Failed to refill cache:', error)
    }
  }, [captionsDb])

  // Helper to check navigation availability (cache-based)
  const checkNavigationAvailability = useCallback(() => {
    // Prev: only available if stack has more than current annotation
    hasPrevAnnotationRef.current = navigationStackRef.current.length > 1

    // Next: available if cache has annotations
    hasNextAnnotationRef.current = annotationCacheRef.current.length > 0

    // Update next annotation ref for preloading
    nextAnnotationRef.current = annotationCacheRef.current[0] ?? null
  }, [])

  // Load initial annotation on mount
  const loadInitialAnnotation = useCallback(async () => {
    if (!videoId || !captionsDb.isReady) return null

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
  }, [videoId, captionsDb.isReady, refillCache, checkNavigationAvailability])

  // Load annotations for visible range
  const loadAnnotationsForRange = useCallback(
    async (startFrame: number, endFrame: number) => {
      if (!videoId || !captionsDb.isReady) return

      try {
        const annotations = await captionsDb.getAnnotationsForRange(startFrame, endFrame)
        annotationsRef.current = annotations.map(toUIAnnotation)
      } catch (error) {
        console.error('Failed to load annotations:', error)
      }
    },
    [videoId, captionsDb]
  )

  // Save annotation
  const saveAnnotation = useCallback(
    async (
      start: number,
      end: number,
      _currentFrameIndexRef: React.RefObject<number>,
      _visibleFramePositions: number[]
    ) => {
      const activeAnnotation = activeAnnotationRef.current
      if (!activeAnnotation || start === null || end === null || !captionsDb.isReady) return

      try {
        console.log('[saveAnnotation] Saving current annotation:', {
          id: activeAnnotation.id,
          old_start: activeAnnotation.start_frame_index,
          old_end: activeAnnotation.end_frame_index,
          new_start: start,
          new_end: end,
        })

        // Determine the new state
        const newState: CaptionFrameExtentState =
          activeAnnotation.state === 'gap' ? 'confirmed' : activeAnnotation.state

        // Save the annotation with overlap resolution
        const result = await captionsDb.updateFrameExtents(
          activeAnnotation.id,
          start,
          end,
          newState
        )

        const createdGaps = result.createdGaps.map(toUIAnnotation)

        // Update progress from database
        await updateProgress()

        // Signal workflow activity for opportunistic image regeneration
        window.dispatchEvent(new CustomEvent('annotation-saved'))

        // Select next annotation: prioritize newly created gaps over cache
        let selectedAnnotation: Annotation | null = null

        // Check if any created gaps are not in the navigation stack (unvisited)
        if (createdGaps.length > 0) {
          const unvisitedGaps = createdGaps.filter(
            gap => !navigationStackRef.current.includes(gap.id)
          )

          if (unvisitedGaps.length > 0) {
            // Sort by start_frame_index and select the first one
            unvisitedGaps.sort((a, b) => a.start_frame_index - b.start_frame_index)
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
            caption_frame_extents_state: selectedAnnotation.state,
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
    [
      captionsDb,
      updateProgress,
      refillCache,
      checkNavigationAvailability,
      jumpRequestedRef,
      jumpTargetRef,
    ]
  )

  // Mark annotation as issue (unclean start or end of caption)
  const markAsIssue = useCallback(
    async (
      start: number,
      end: number,
      _currentFrameIndexRef: React.RefObject<number>,
      _visibleFramePositions: number[]
    ) => {
      const activeAnnotation = activeAnnotationRef.current
      if (!activeAnnotation || start === null || end === null || !captionsDb.isReady) return

      try {
        console.log('[markAsIssue] Marking current annotation as issue:', {
          id: activeAnnotation.id,
          old_start: activeAnnotation.start_frame_index,
          old_end: activeAnnotation.end_frame_index,
          new_start: start,
          new_end: end,
        })

        // Save the annotation with 'issue' state
        const result = await captionsDb.updateFrameExtents(activeAnnotation.id, start, end, 'issue')

        const createdGaps = result.createdGaps.map(toUIAnnotation)

        // Update progress from database
        await updateProgress()

        // Signal workflow activity for opportunistic image regeneration
        window.dispatchEvent(new CustomEvent('annotation-saved'))

        // Select next annotation: prioritize newly created gaps over cache
        let selectedAnnotation: Annotation | null = null

        // Check if any created gaps are not in the navigation stack (unvisited)
        if (createdGaps.length > 0) {
          const unvisitedGaps = createdGaps.filter(
            gap => !navigationStackRef.current.includes(gap.id)
          )

          if (unvisitedGaps.length > 0) {
            // Sort by start_frame_index and select the first one
            unvisitedGaps.sort((a, b) => a.start_frame_index - b.start_frame_index)
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
            caption_frame_extents_state: selectedAnnotation.state,
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
    [
      captionsDb,
      updateProgress,
      refillCache,
      checkNavigationAvailability,
      jumpRequestedRef,
      jumpTargetRef,
    ]
  )

  // Delete annotation
  const deleteAnnotation = useCallback(
    async (_currentFrameIndexRef: React.RefObject<number>) => {
      const activeAnnotation = activeAnnotationRef.current
      if (!activeAnnotation || !captionsDb.isReady) return

      try {
        await captionsDb.deleteAnnotation(activeAnnotation.id)

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
    [
      captionsDb,
      updateProgress,
      refillCache,
      checkNavigationAvailability,
      jumpRequestedRef,
      jumpTargetRef,
    ]
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

      if (!activeAnnotation || !captionsDb.isReady) return

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
            const annotation = await captionsDb.getAnnotation(prevAnnotationId!)
            if (annotation) {
              const uiAnnotation = toUIAnnotation(annotation)
              activeAnnotationRef.current = uiAnnotation
              jumpTargetRef.current = uiAnnotation.start_frame_index
              jumpRequestedRef.current = true // Signal frame loader to jump to new position
              markedStartRef.current = uiAnnotation.start_frame_index
              markedEndRef.current = uiAnnotation.end_frame_index

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
    [captionsDb, refillCache, checkNavigationAvailability, jumpRequestedRef, jumpTargetRef]
  )

  // Jump to frame and load annotation containing it
  const jumpToFrameAnnotation = useCallback(
    async (
      frameNumber: number,
      totalFrames: number,
      _currentFrameIndexRef: React.RefObject<number>
    ): Promise<boolean> => {
      if (!captionsDb.isReady) return false

      if (isNaN(frameNumber) || frameNumber < 0 || frameNumber >= totalFrames) {
        alert(`Invalid frame number. Must be between 0 and ${totalFrames - 1}`)
        return false
      }

      try {
        // Query for annotations containing this frame
        const annotations = await captionsDb.getAnnotationsForRange(frameNumber, frameNumber)

        if (annotations.length > 0) {
          const annotation = toUIAnnotation(annotations[0]!)
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
    [captionsDb, checkNavigationAvailability, jumpTargetRef]
  )

  // Activate annotation at current frame
  const activateAnnotationAtFrame = useCallback(
    async (frameIndex: number) => {
      if (!captionsDb.isReady) return

      try {
        const annotations = await captionsDb.getAnnotationsForRange(frameIndex, frameIndex)

        if (annotations.length > 0) {
          const annotation = toUIAnnotation(annotations[0]!)
          activeAnnotationRef.current = annotation
          markedStartRef.current = annotation.start_frame_index
          markedEndRef.current = annotation.end_frame_index
          checkNavigationAvailability()
        }
      } catch (error) {
        console.error('Failed to activate current frame annotation:', error)
      }
    },
    [captionsDb, checkNavigationAvailability]
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
    // Reset marks to original annotation caption frame extents (cancel any changes)
    const activeAnnotation = activeAnnotationRef.current
    if (activeAnnotation) {
      markedStartRef.current = activeAnnotation.start_frame_index
      markedEndRef.current = activeAnnotation.end_frame_index
    }
  }, [])

  return {
    // State refs
    activeAnnotationRef,
    nextAnnotationRef,
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

    // Database state
    isReady: captionsDb.isReady,
    canEdit: captionsDb.canEdit,
  }
}
