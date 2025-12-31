import type { BoxData, FrameBoxesData } from '~/types/review-labels'

/**
 * Represents a point in canvas coordinates
 */
export interface CanvasPoint {
  x: number
  y: number
}

/**
 * Represents a rectangle in canvas coordinates
 */
export interface CanvasRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Converts a mouse event to canvas-relative coordinates
 */
export function getCanvasCoordinates(
  e: React.MouseEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement
): CanvasPoint {
  const rect = canvas.getBoundingClientRect()
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  }
}

/**
 * Finds the box at a given canvas position.
 * Returns the box index (in display order) if found, or null if no box at position.
 * Searches from top to bottom (last drawn box is checked first).
 */
export function findBoxAtPosition(
  point: CanvasPoint,
  frameBoxes: FrameBoxesData,
  canvasWidth: number
): number | null {
  const scale = canvasWidth / frameBoxes.frameWidth

  for (let i = frameBoxes.boxes.length - 1; i >= 0; i--) {
    const box = frameBoxes.boxes[i]
    if (!box) continue

    if (isPointInBox(point, box, scale)) {
      return box.boxIndex
    }
  }

  return null
}

/**
 * Finds the display index (array position) of the box at a given canvas position.
 * Returns the array index if found, or null if no box at position.
 */
export function findBoxDisplayIndexAtPosition(
  point: CanvasPoint,
  frameBoxes: FrameBoxesData,
  canvasWidth: number
): number | null {
  const scale = canvasWidth / frameBoxes.frameWidth

  for (let i = frameBoxes.boxes.length - 1; i >= 0; i--) {
    const box = frameBoxes.boxes[i]
    if (!box) continue

    if (isPointInBox(point, box, scale)) {
      return i
    }
  }

  return null
}

/**
 * Checks if a point is inside a box's bounds
 */
function isPointInBox(point: CanvasPoint, box: BoxData, scale: number): boolean {
  const boxX = box.originalBounds.left * scale
  const boxY = box.originalBounds.top * scale
  const boxWidth = (box.originalBounds.right - box.originalBounds.left) * scale
  const boxHeight = (box.originalBounds.bottom - box.originalBounds.top) * scale

  return (
    point.x >= boxX && point.x <= boxX + boxWidth && point.y >= boxY && point.y <= boxY + boxHeight
  )
}

/**
 * Creates a normalized selection rectangle from two points.
 * Ensures left < right and top < bottom.
 */
export function createSelectionRect(start: CanvasPoint, end: CanvasPoint): CanvasRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  }
}

/**
 * Finds all boxes fully enclosed by a selection rectangle.
 * Returns an array of box indices.
 */
export function findBoxesInSelection(
  selectionRect: CanvasRect,
  frameBoxes: FrameBoxesData,
  canvasWidth: number
): number[] {
  const scale = canvasWidth / frameBoxes.frameWidth
  const enclosedBoxes: number[] = []

  for (const box of frameBoxes.boxes) {
    if (isBoxFullyEnclosed(box, selectionRect, scale)) {
      enclosedBoxes.push(box.boxIndex)
    }
  }

  return enclosedBoxes
}

/**
 * Checks if a box is fully enclosed by a selection rectangle
 */
function isBoxFullyEnclosed(box: BoxData, selectionRect: CanvasRect, scale: number): boolean {
  const boxX = box.originalBounds.left * scale
  const boxY = box.originalBounds.top * scale
  const boxRight = box.originalBounds.right * scale
  const boxBottom = box.originalBounds.bottom * scale

  return (
    boxX >= selectionRect.left &&
    boxY >= selectionRect.top &&
    boxRight <= selectionRect.right &&
    boxBottom <= selectionRect.bottom
  )
}

/**
 * Determines the label to apply based on mouse button
 */
export function getLabelFromMouseButton(button: number): 'in' | 'out' {
  return button === 0 ? 'in' : 'out'
}
