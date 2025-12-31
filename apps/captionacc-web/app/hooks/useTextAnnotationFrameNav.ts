import { useState, useEffect, useCallback } from 'react'

import type { Annotation } from '~/types/text-annotation'

interface UseTextAnnotationFrameNavParams {
  annotation: Annotation | null
}

interface UseTextAnnotationFrameNavReturn {
  // Frame state
  currentFrameIndex: number
  setCurrentFrameIndex: (index: number) => void

  // Drag state (exposed for cursor styling if needed)
  isDragging: boolean

  // Event handlers
  handleWheel: (e: React.WheelEvent) => void
  handleDragStart: (e: React.MouseEvent) => void
  navigateFrame: (delta: number) => void
}

/**
 * Custom hook for managing frame navigation within an annotation.
 * Handles mouse wheel scrolling and drag-to-scroll interactions.
 */
export function useTextAnnotationFrameNav({
  annotation,
}: UseTextAnnotationFrameNavParams): UseTextAnnotationFrameNavReturn {
  // Frame navigation state
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0)

  // Drag state for frame navigation
  const [isDragging, setIsDragging] = useState(false)
  const [dragStartY, setDragStartY] = useState(0)
  const [dragStartFrame, setDragStartFrame] = useState(0)

  // Update current frame when annotation changes
  useEffect(() => {
    if (annotation) {
      setCurrentFrameIndex(annotation.start_frame_index)
    }
  }, [annotation])

  // Frame navigation helper
  const navigateFrame = useCallback(
    (delta: number) => {
      if (!annotation) return

      const newIndex = currentFrameIndex + delta
      const minFrame = annotation.start_frame_index
      const maxFrame = annotation.end_frame_index

      if (newIndex >= minFrame && newIndex <= maxFrame) {
        setCurrentFrameIndex(newIndex)
      }
    },
    [currentFrameIndex, annotation]
  )

  // Mouse wheel handler for frame navigation
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 1 : -1
      navigateFrame(delta)
    },
    [navigateFrame]
  )

  // Drag start handler
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true)
      setDragStartY(e.clientY)
      setDragStartFrame(currentFrameIndex)
      e.preventDefault()
    },
    [currentFrameIndex]
  )

  // Global mouse handlers for drag
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!annotation) return

      const deltaY = dragStartY - e.clientY
      const framesDelta = Math.floor(deltaY / 10)

      const newIndex = dragStartFrame + framesDelta
      const minFrame = annotation.start_frame_index
      const maxFrame = annotation.end_frame_index

      if (newIndex >= minFrame && newIndex <= maxFrame) {
        setCurrentFrameIndex(newIndex)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragStartY, dragStartFrame, annotation])

  return {
    currentFrameIndex,
    setCurrentFrameIndex,
    isDragging,
    handleWheel,
    handleDragStart,
    navigateFrame,
  }
}
