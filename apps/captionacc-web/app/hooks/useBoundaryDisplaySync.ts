/**
 * Hook for synchronizing internal refs to display state via RAF loop.
 * This is the single source of renders for the boundary workflow.
 *
 * The RAF loop runs at 60fps and only triggers renders when data changes,
 * implementing a game-loop style separation between internal state and display.
 */

import { useState, useEffect, startTransition } from 'react'

import {
  INITIAL_DISPLAY_STATE,
  type Annotation,
  type BoundaryDisplayState,
  type Frame,
} from '~/types/boundaries'

// Target frame rate for display updates
const TARGET_FPS = 60
const FRAME_INTERVAL = 1000 / TARGET_FPS // ~16ms

/**
 * Refs that feed into the display sync loop.
 * All hooks expose their refs and this hook combines them into displayState.
 */
export interface BoundaryRefs {
  currentFrameIndexRef: React.RefObject<number>
  framesRef: React.RefObject<Map<number, Frame>>
  annotationsRef: React.RefObject<Annotation[]>
  activeAnnotationRef: React.RefObject<Annotation | null>
  markedStartRef: React.RefObject<number | null>
  markedEndRef: React.RefObject<number | null>
  hasPrevAnnotationRef: React.RefObject<boolean>
  hasNextAnnotationRef: React.RefObject<boolean>
  workflowProgressRef: React.RefObject<number>
  completedFramesRef: React.RefObject<number>
  cursorStyleRef: React.RefObject<'grab' | 'grabbing'>
}

interface UseBoundaryDisplaySyncParams {
  refs: BoundaryRefs
}

interface UseBoundaryDisplaySyncReturn {
  displayState: BoundaryDisplayState
}

/**
 * Hook that runs the RAF render loop to sync refs to display state.
 */
export function useBoundaryDisplaySync({
  refs,
}: UseBoundaryDisplaySyncParams): UseBoundaryDisplaySyncReturn {
  const [displayState, setDisplayState] = useState<BoundaryDisplayState>(INITIAL_DISPLAY_STATE)

  useEffect(() => {
    let rafId: number
    let lastUpdateTime = 0
    let lastFrameIndex = 0
    let lastFrameCount = 0
    let lastActiveAnnotationId: number | null = null

    const loop = (currentTime: number) => {
      const timeSinceUpdate = currentTime - lastUpdateTime

      // Check if data changed OR enough time passed for 60fps
      const frameIndex = refs.currentFrameIndexRef.current
      const frameCount = refs.framesRef.current.size
      const activeAnnotationId = refs.activeAnnotationRef.current?.id ?? null
      const dataChanged =
        frameIndex !== lastFrameIndex ||
        frameCount !== lastFrameCount ||
        activeAnnotationId !== lastActiveAnnotationId

      if (dataChanged && timeSinceUpdate >= FRAME_INTERVAL) {
        // Update display from ALL refs (non-urgent, batched by React 18)
        startTransition(() => {
          setDisplayState({
            currentFrameIndex: refs.currentFrameIndexRef.current,
            frames: new Map(refs.framesRef.current),
            annotations: [...refs.annotationsRef.current],
            activeAnnotation: refs.activeAnnotationRef.current,
            markedStart: refs.markedStartRef.current,
            markedEnd: refs.markedEndRef.current,
            hasPrevAnnotation: refs.hasPrevAnnotationRef.current,
            hasNextAnnotation: refs.hasNextAnnotationRef.current,
            workflowProgress: refs.workflowProgressRef.current,
            completedFrames: refs.completedFramesRef.current,
            cursorStyle: refs.cursorStyleRef.current,
          })
        })

        lastUpdateTime = currentTime
        lastFrameIndex = frameIndex
        lastFrameCount = frameCount
        lastActiveAnnotationId = activeAnnotationId
      }

      // Continue loop
      rafId = requestAnimationFrame(loop)
    }

    // Start loop
    rafId = requestAnimationFrame(loop)

    // Cleanup on unmount
    return () => cancelAnimationFrame(rafId)
  }, [refs])

  return { displayState }
}
