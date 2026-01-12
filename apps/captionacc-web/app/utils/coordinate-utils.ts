/**
 * Coordinate conversion utilities for OCR box manipulation.
 *
 * This module handles conversions between different coordinate systems:
 * - Fractional coordinates (0-1): Used by Python OCR output
 * - Pixel coordinates: Used for calculations and database storage
 * - Cropped display coordinates: Used for frontend rendering
 *
 * IMPORTANT Y-AXIS GOTCHA:
 * The Python OCR pipeline uses bottom-referenced Y coordinates where:
 * - y=0 is at the BOTTOM of the image
 * - y=1 is at the TOP of the image
 *
 * Standard screen/pixel coordinates use top-referenced Y where:
 * - y=0 is at the TOP of the image
 * - y increases downward
 *
 * All conversion functions in this module handle this flip automatically.
 */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Fractional box coordinates as returned by Python OCR.
 *
 * IMPORTANT: The y coordinate is measured from the BOTTOM of the image,
 * not the top. This is the raw format from paddleocr.
 *
 * @example
 * // A box at the bottom-left of the image:
 * { x: 0.1, y: 0.1, width: 0.3, height: 0.05 }
 * // y=0.1 means 10% from the BOTTOM
 */
export interface FractionalBox {
  /** Fractional x coordinate (0-1), left edge of box */
  x: number
  /** Fractional y coordinate (0-1), measured from BOTTOM of image */
  y: number
  /** Fractional width (0-1) */
  width: number
  /** Fractional height (0-1) */
  height: number
}

/**
 * Pixel bounds in standard screen coordinates (top-left origin).
 *
 * Used for calculations, database storage, and internal processing.
 * Y increases downward (standard screen/pixel coordinates).
 */
export interface PixelBounds {
  /** Left edge in pixels */
  left: number
  /** Top edge in pixels (y=0 at top of image) */
  top: number
  /** Right edge in pixels */
  right: number
  /** Bottom edge in pixels */
  bottom: number
}

/**
 * Frame size in pixels.
 */
export interface FrameSize {
  width: number
  height: number
}

/**
 * Crop region in pixels.
 */
export interface CropRegion {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Fractional region (0-1) used for display in cropped space.
 * All values are relative to the cropped region, not the full frame.
 */
export interface FractionalCropRegionBounds {
  left: number
  top: number
  right: number
  bottom: number
}

// =============================================================================
// Coordinate Conversion Functions
// =============================================================================

/**
 * Convert OCR fractional coordinates to pixel bounds.
 *
 * Handles the y-axis flip: OCR uses bottom-referenced y, while pixels
 * use top-referenced y (standard screen coordinates).
 *
 * @param box - Fractional box from OCR (y measured from bottom)
 * @param frameSize - Frame dimensions in pixels
 * @returns Pixel bounds with top-referenced y coordinates
 *
 * @example
 * const ocrBox = { x: 0.1, y: 0.1, width: 0.3, height: 0.05 }
 * const frame = { width: 1920, height: 1080 }
 * const pixels = fractionalToPixelBounds(ocrBox, frame)
 * // Returns: { left: 192, top: 918, right: 768, bottom: 972 }
 * // Note: top=918 because y=0.1 means 10% from bottom, which is 90% from top
 */
export function fractionalToPixelBounds(box: FractionalBox, frameSize: FrameSize): PixelBounds {
  const { x, y, width, height } = box
  const { width: frameWidth, height: frameHeight } = frameSize

  // Convert x (left edge) - straightforward
  const left = Math.floor(x * frameWidth)
  const right = left + Math.floor(width * frameWidth)

  // Convert y - requires flip from bottom-referenced to top-referenced
  // OCR y=0 is bottom, screen y=0 is top
  // OCR y is the bottom edge of the box (measured from image bottom)
  // So (1-y) gives us the bottom edge measured from image top
  const bottom = Math.floor((1 - y) * frameHeight)
  const top = bottom - Math.floor(height * frameHeight)

  return { left, top, right, bottom }
}

/**
 * Convert pixel bounds to OCR fractional coordinates.
 *
 * Inverse of fractionalToPixelBounds. Handles the y-axis flip back
 * to bottom-referenced coordinates.
 *
 * @param bounds - Pixel bounds with top-referenced y
 * @param frameSize - Frame dimensions in pixels
 * @returns Fractional box with bottom-referenced y (OCR format)
 *
 * @example
 * const pixels = { left: 192, top: 918, right: 768, bottom: 972 }
 * const frame = { width: 1920, height: 1080 }
 * const ocr = pixelToFractionalCropRegionBounds(pixels, frame)
 * // Returns: { x: 0.1, y: 0.1, width: 0.3, height: 0.05 }
 */
export function pixelToFractionalCropRegionBounds(
  bounds: PixelBounds,
  frameSize: FrameSize
): FractionalBox {
  const { left, top, right, bottom } = bounds
  const { width: frameWidth, height: frameHeight } = frameSize

  const x = left / frameWidth
  const width = (right - left) / frameWidth
  const height = (bottom - top) / frameHeight

  // Convert y back to bottom-referenced
  // Screen bottom is (bottom / frameHeight) from top
  // OCR y is distance from bottom = 1 - (bottom / frameHeight)
  const y = 1 - bottom / frameHeight

  return { x, y, width, height }
}

/**
 * Convert full-frame pixel bounds to fractional coordinates in cropped display space.
 *
 * Used for frontend rendering where the displayed image shows only the cropped
 * region. The returned coordinates are fractional (0-1) relative to the crop region.
 *
 * Boxes that extend outside the crop region are clamped to the crop boundaries.
 *
 * @param boxBounds - Pixel bounds in full frame coordinates
 * @param cropRegion - Crop region bounds in pixels
 * @returns Fractional bounds (0-1) relative to the cropped region
 *
 * @example
 * const box = { left: 100, top: 800, right: 300, bottom: 850 }
 * const crop = { left: 50, top: 700, right: 450, bottom: 900 }
 * const display = pixelToCroppedDisplay(box, crop)
 * // Returns fractional coordinates within the crop region
 */
export function pixelToCroppedDisplay(
  boxBounds: PixelBounds,
  cropRegion: CropRegion
): FractionalCropRegionBounds {
  const cropWidth = cropRegion.right - cropRegion.left
  const cropHeight = cropRegion.bottom - cropRegion.top

  // Handle edge case of zero-dimension crop
  if (cropWidth <= 0 || cropHeight <= 0) {
    return { left: 0, top: 0, right: 1, bottom: 1 }
  }

  // Clamp box to crop region
  const clampedLeft = Math.max(boxBounds.left, cropRegion.left)
  const clampedTop = Math.max(boxBounds.top, cropRegion.top)
  const clampedRight = Math.min(boxBounds.right, cropRegion.right)
  const clampedBottom = Math.min(boxBounds.bottom, cropRegion.bottom)

  // Convert to fractional coordinates within crop region
  return {
    left: (clampedLeft - cropRegion.left) / cropWidth,
    top: (clampedTop - cropRegion.top) / cropHeight,
    right: (clampedRight - cropRegion.left) / cropWidth,
    bottom: (clampedBottom - cropRegion.top) / cropHeight,
  }
}

/**
 * Convert cropped display fractional coordinates to full-frame pixel bounds.
 *
 * Inverse of pixelToCroppedDisplay. Used when user interactions in the
 * cropped display need to be converted back to full-frame coordinates.
 *
 * @param displayBounds - Fractional bounds (0-1) in cropped space
 * @param cropRegion - Crop region bounds in pixels
 * @returns Pixel bounds in full frame coordinates
 */
export function croppedDisplayToPixel(
  displayBounds: FractionalCropRegionBounds,
  cropRegion: CropRegion
): PixelBounds {
  const cropWidth = cropRegion.right - cropRegion.left
  const cropHeight = cropRegion.bottom - cropRegion.top

  return {
    left: Math.floor(cropRegion.left + displayBounds.left * cropWidth),
    top: Math.floor(cropRegion.top + displayBounds.top * cropHeight),
    right: Math.floor(cropRegion.left + displayBounds.right * cropWidth),
    bottom: Math.floor(cropRegion.top + displayBounds.bottom * cropHeight),
  }
}

// =============================================================================
// Spatial Utility Functions
// =============================================================================

/**
 * Check if two bounds rectangles intersect.
 *
 * @param a - First bounds rectangle
 * @param b - Second bounds rectangle
 * @returns true if the rectangles overlap
 */
export function boundsIntersect(a: PixelBounds, b: PixelBounds): boolean {
  // No intersection if one is entirely to the left/right/above/below the other
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
}

/**
 * Check if a point is within bounds.
 *
 * @param x - Point x coordinate
 * @param y - Point y coordinate
 * @param bounds - Bounds rectangle to check
 * @returns true if point is inside the bounds (inclusive)
 */
export function pointInBounds(x: number, y: number, bounds: PixelBounds): boolean {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
}

/**
 * Check if one bounds rectangle is fully contained within another.
 *
 * @param inner - The potentially contained rectangle
 * @param outer - The potentially containing rectangle
 * @returns true if inner is fully within outer
 */
export function boundsContained(inner: PixelBounds, outer: PixelBounds): boolean {
  return (
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom
  )
}

/**
 * Calculate the intersection of two bounds rectangles.
 *
 * @param a - First bounds rectangle
 * @param b - Second bounds rectangle
 * @returns The intersection rectangle, or null if no intersection
 */
export function boundsIntersection(a: PixelBounds, b: PixelBounds): PixelBounds | null {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.right, b.right)
  const bottom = Math.min(a.bottom, b.bottom)

  if (right <= left || bottom <= top) {
    return null
  }

  return { left, top, right, bottom }
}

/**
 * Calculate the area of a bounds rectangle.
 *
 * @param bounds - The bounds rectangle
 * @returns Area in square pixels
 */
export function boundsArea(bounds: PixelBounds): number {
  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top
  return Math.max(0, width) * Math.max(0, height)
}

/**
 * Calculate the center point of a bounds rectangle.
 *
 * @param bounds - The bounds rectangle
 * @returns Center point coordinates
 */
export function boundsCenter(bounds: PixelBounds): { x: number; y: number } {
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
  }
}

/**
 * Expand bounds by a given margin.
 *
 * @param bounds - The bounds rectangle
 * @param margin - Margin to add on all sides (can be negative to shrink)
 * @returns New bounds with margin applied
 */
export function expandBounds(bounds: PixelBounds, margin: number): PixelBounds {
  return {
    left: bounds.left - margin,
    top: bounds.top - margin,
    right: bounds.right + margin,
    bottom: bounds.bottom + margin,
  }
}

/**
 * Clamp bounds to stay within a container.
 *
 * @param bounds - The bounds to clamp
 * @param container - The containing bounds
 * @returns Bounds clamped to fit within container
 */
export function clampBounds(bounds: PixelBounds, container: PixelBounds): PixelBounds {
  return {
    left: Math.max(bounds.left, container.left),
    top: Math.max(bounds.top, container.top),
    right: Math.min(bounds.right, container.right),
    bottom: Math.min(bounds.bottom, container.bottom),
  }
}

// =============================================================================
// Batch Conversion Helpers
// =============================================================================

/**
 * Convert an array of OCR boxes to pixel bounds.
 *
 * Convenience function for processing multiple boxes at once.
 *
 * @param boxes - Array of fractional boxes from OCR
 * @param frameSize - Frame dimensions in pixels
 * @returns Array of pixel bounds
 */
export function batchFractionalToPixel(
  boxes: FractionalBox[],
  frameSize: FrameSize
): PixelBounds[] {
  return boxes.map(box => fractionalToPixelBounds(box, frameSize))
}

/**
 * Convert OcrBoxRecord array fields to FractionalBox format.
 *
 * Extracts the coordinate fields from database records into the
 * format expected by conversion functions.
 *
 * @param record - Database record with x, y, width, height fields
 * @returns FractionalBox for coordinate conversion
 */
export function ocrRecordToFractionalBox(record: {
  x: number
  y: number
  width: number
  height: number
}): FractionalBox {
  return {
    x: record.x,
    y: record.y,
    width: record.width,
    height: record.height,
  }
}
