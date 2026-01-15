/**
 * Hook for drag-to-scroll behavior with momentum physics.
 * Handles mouse drag events to scroll through frames with smooth momentum animation.
 */

import { useCallback, useEffect, useRef } from 'react'

interface UseCaptionFrameExtentsDragScrollParams {
  currentFrameIndex: number
  totalFrames: number
  onFrameChange: (newFrame: number) => void
}

interface UseCaptionFrameExtentsDragScrollReturn {
  isDraggingRef: React.RefObject<boolean>
  cursorStyleRef: React.RefObject<'grab' | 'grabbing'>
  handleDragStart: (e: React.MouseEvent) => void
}

// Physics constants for momentum animation
const PIXELS_PER_FRAME = 30
const FRICTION = 0.95
const MIN_VELOCITY_THRESHOLD = 0.001
const MOMENTUM_TRIGGER_THRESHOLD = 0.01

/**
 * Hook for managing drag-to-scroll with momentum physics.
 */
export function useCaptionFrameExtentsDragScroll({
  currentFrameIndex,
  totalFrames,
  onFrameChange,
}: UseCaptionFrameExtentsDragScrollParams): UseCaptionFrameExtentsDragScrollReturn {
  // Drag state refs (synchronous access needed for smooth animation)
  const isDraggingRef = useRef(false)
  const dragStartYRef = useRef(0)
  const dragStartFrameRef = useRef(0)
  const lastYRef = useRef(0)
  const lastTimeRef = useRef(0)
  const velocityRef = useRef(0)
  const momentumFrameRef = useRef<number | null>(null)
  const cursorStyleRef = useRef<'grab' | 'grabbing'>('grab')

  // Cleanup momentum animation on unmount
  useEffect(() => {
    return () => {
      if (momentumFrameRef.current !== null) {
        cancelAnimationFrame(momentumFrameRef.current)
      }
    }
  }, [])

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault() // Prevent default drag behavior

      // Cancel momentum if running
      if (momentumFrameRef.current !== null) {
        cancelAnimationFrame(momentumFrameRef.current)
        momentumFrameRef.current = null
      }

      isDraggingRef.current = true
      dragStartYRef.current = e.clientY
      dragStartFrameRef.current = currentFrameIndex
      lastYRef.current = e.clientY
      lastTimeRef.current = Date.now()
      velocityRef.current = 0
      cursorStyleRef.current = 'grabbing'

      // Add global listeners for move and up
      const handleMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) return

        const now = Date.now()
        const deltaY = dragStartYRef.current - moveEvent.clientY
        const frameDelta = Math.round(deltaY / PIXELS_PER_FRAME)
        const newFrame = Math.max(
          0,
          Math.min(dragStartFrameRef.current + frameDelta, totalFrames - 1)
        )

        // Calculate velocity for momentum
        const timeDelta = now - lastTimeRef.current
        if (timeDelta > 0) {
          const yDelta = lastYRef.current - moveEvent.clientY
          // Convert to frames per animation frame (16ms)
          velocityRef.current = ((yDelta / timeDelta) * 16) / PIXELS_PER_FRAME
        }

        lastYRef.current = moveEvent.clientY
        lastTimeRef.current = now
        onFrameChange(newFrame)
      }

      const handleUp = () => {
        if (!isDraggingRef.current) return
        isDraggingRef.current = false
        cursorStyleRef.current = 'grab'

        // Remove listeners
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)

        // Apply momentum with fractional position tracking
        const initialVelocity = velocityRef.current
        if (Math.abs(initialVelocity) > MOMENTUM_TRIGGER_THRESHOLD) {
          let velocity = initialVelocity
          let position = currentFrameIndex // Track fractional position

          const animate = () => {
            velocity *= FRICTION

            // Stop when velocity becomes negligible
            if (Math.abs(velocity) < MIN_VELOCITY_THRESHOLD) {
              momentumFrameRef.current = null
              return
            }

            // Update fractional position
            position += velocity

            // Clamp to valid range
            position = Math.max(0, Math.min(position, totalFrames - 1))

            // Update displayed frame (rounded from fractional position)
            const newFrame = Math.round(position)
            onFrameChange(newFrame)

            momentumFrameRef.current = requestAnimationFrame(animate)
          }
          momentumFrameRef.current = requestAnimationFrame(animate)
        }
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [currentFrameIndex, totalFrames, onFrameChange]
  )

  return { isDraggingRef, cursorStyleRef, handleDragStart }
}
