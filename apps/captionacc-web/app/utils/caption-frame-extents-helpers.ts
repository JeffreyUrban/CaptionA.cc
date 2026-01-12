/**
 * Pure utility functions for the Caption Frame Extents Annotation workflow.
 * These functions have no side effects and can be easily tested.
 */

import type { Annotation, AnnotationState } from '~/caption-frame-extents'

// Opacity calculation constants
// Uses parabolic (quadratic) decay to keep frames bright in middle, fade only at ends
const MIN_OPACITY = 0.1
const FADE_THRESHOLD = 5 // frames stay at full opacity within this distance
const QUADRATIC_FACTOR = 0.04 // controls steepness of parabolic fade

/**
 * Get the effective state of an annotation, considering the pending flag.
 * When pending is true, returns 'pending' instead of the actual state.
 */
export function getEffectiveState(annotation: Annotation): 'pending' | AnnotationState {
  return annotation.pending ? 'pending' : annotation.state
}

/**
 * Get the Tailwind border color class for an annotation based on its effective state.
 */
export function getAnnotationBorderColor(annotation: Annotation): string {
  const effectiveState = getEffectiveState(annotation)
  switch (effectiveState) {
    case 'pending':
      return 'border-pink-500'
    case 'predicted':
      return 'border-indigo-500'
    case 'confirmed':
      return 'border-teal-500'
    case 'gap':
      return ''
    case 'issue':
      return 'border-purple-700'
  }
}

/**
 * Calculate opacity for a frame based on distance from current frame.
 * Uses parabolic decay: stays bright in the middle, fades quadratically at the ends.
 * opacity = 1 / (1 + k * distance^2) for distance > threshold
 */
export function calculateFrameOpacity(
  frameIndex: number,
  currentFrameIndex: number,
  fadeThreshold: number = FADE_THRESHOLD,
  minOpacity: number = MIN_OPACITY
): number {
  const distance = Math.abs(frameIndex - currentFrameIndex)

  // Keep frames at full opacity within threshold
  if (distance <= fadeThreshold) return 1.0

  // Apply parabolic (inverse quadratic) decay beyond threshold
  const effectiveDistance = distance - fadeThreshold
  const opacity = 1 / (1 + QUADRATIC_FACTOR * effectiveDistance * effectiveDistance)

  return Math.max(minOpacity, opacity)
}

/**
 * Calculate visible frame positions for the frame stack display.
 * Returns an array of frame indices centered on the current frame.
 */
export function calculateVisibleFramePositions(
  currentFrameIndex: number,
  totalFrames: number,
  windowHeight: number,
  cropWidth: number,
  cropHeight: number,
  containerWidthRatio: number = 2 / 3,
  containerPadding: number = 32
): number[] {
  // Calculate available height: total window height minus navbar (64px)
  const navbarHeight = 64
  const safeWindowHeight = Math.max(windowHeight, 400)
  const availableHeight = Math.max(safeWindowHeight - navbarHeight, 300)

  // Calculate actual frame height based on crop dimensions and container width
  const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1000
  const containerWidth = windowWidth * containerWidthRatio - containerPadding
  const frameHeight =
    cropWidth > 0 && cropHeight > 0 ? (containerWidth * cropHeight) / cropWidth : 90
  const frameHeightWithGap = frameHeight + 4

  // Calculate how many slots we need to fill the height
  const totalSlots = Math.max(Math.ceil(availableHeight / frameHeightWithGap), 3)

  // Generate sequential frame positions centered on current frame
  // Don't clamp positions - let them be negative or beyond totalFrames
  // Rendering component will skip out-of-bounds frames
  const positions: number[] = []
  for (let i = 0; i < totalSlots; i++) {
    const position = currentFrameIndex + i - Math.floor(totalSlots / 2)
    positions.push(position)
  }

  return positions
}

/**
 * Find annotations that contain a given frame index.
 */
export function getAnnotationsForFrame(
  annotations: Annotation[],
  frameIndex: number
): Annotation[] {
  return annotations.filter(
    ann => frameIndex >= ann.start_frame_index && frameIndex <= ann.end_frame_index
  )
}
