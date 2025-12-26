/**
 * Bayesian prediction for OCR box classification.
 *
 * Predicts whether a box is a caption ("in") or noise ("out") based on:
 * - Position within crop bounds
 * - Vertical alignment with expected caption position
 * - Box height alignment with expected caption height
 */

interface VideoLayoutConfig {
  crop_left: number
  crop_top: number
  crop_right: number
  crop_bottom: number
  vertical_position: number | null
  vertical_std: number | null
  box_height: number | null
  box_height_std: number | null
}

interface BoxBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Predict label and confidence for an OCR box.
 *
 * Returns:
 * - label: 'in' (caption) or 'out' (noise)
 * - confidence: 0.5 (uncertain) to 0.95 (very confident)
 */
export function predictBoxLabel(
  boxBounds: BoxBounds,
  layoutConfig: VideoLayoutConfig
): { label: 'in' | 'out'; confidence: number } {
  const { crop_left, crop_top, crop_right, crop_bottom } = layoutConfig

  // Check if box is inside crop bounds
  const insideCrop = (
    boxBounds.left >= crop_left &&
    boxBounds.top >= crop_top &&
    boxBounds.right <= crop_right &&
    boxBounds.bottom <= crop_bottom
  )

  if (!insideCrop) {
    // Outside crop bounds → definitely "out"
    return { label: 'out', confidence: 0.95 }
  }

  // Inside crop bounds - check alignment with layout params
  if (layoutConfig.vertical_position !== null && layoutConfig.box_height !== null) {
    const boxCenterY = (boxBounds.top + boxBounds.bottom) / 2
    const boxHeight = boxBounds.bottom - boxBounds.top

    const verticalDistance = Math.abs(boxCenterY - layoutConfig.vertical_position)
    const heightDifference = Math.abs(boxHeight - layoutConfig.box_height)

    const verticalStd = layoutConfig.vertical_std || 15
    const heightStd = layoutConfig.box_height_std || 5

    // Z-scores
    const verticalZScore = verticalDistance / verticalStd
    const heightZScore = heightDifference / heightStd

    // Good alignment if within ~2 std deviations
    if (verticalZScore < 2 && heightZScore < 2) {
      return { label: 'in', confidence: 0.7 + (1 - Math.min(verticalZScore, 2) / 2) * 0.2 }
    } else if (verticalZScore > 4 || heightZScore > 4) {
      return { label: 'out', confidence: 0.7 }
    } else {
      // Uncertain
      return { label: 'in', confidence: 0.5 }
    }
  }

  // Default: inside crop → probably caption
  return { label: 'in', confidence: 0.6 }
}
