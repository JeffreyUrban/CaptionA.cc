/**
 * Statistical distribution calculations for layout constraint expansion
 *
 * Calculates distribution parameters from predicted caption boxes:
 * - top_edge_std: Standard deviation of top edges
 * - bottom_edge_std: Standard deviation of bottom edges
 * - horizontal_std_slope: Linear model slope for horizontal stddev vs distance from anchor
 * - horizontal_std_intercept: Linear model intercept
 */

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface DistributionParams {
  top_edge_std: number
  bottom_edge_std: number
  horizontal_std_slope: number
  horizontal_std_intercept: number
}

export interface LayoutConfig {
  anchor_type: 'left' | 'center' | 'right'
  anchor_position: number
  vertical_position: number
  box_height: number
}

/**
 * Calculate mean and standard deviation
 */
function calculateStats(values: number[]): { mean: number; std: number } {
  if (values.length === 0) {
    return { mean: 0, std: 0 }
  }

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length

  if (values.length === 1) {
    return { mean, std: 0 }
  }

  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) /
    (values.length - 1)

  return { mean, std: Math.sqrt(variance) }
}

/**
 * Calculate simple linear regression (least squares)
 * Returns slope and intercept for y = slope * x + intercept
 */
function linearRegression(
  x: number[],
  y: number[]
): { slope: number; intercept: number } {
  if (x.length !== y.length || x.length === 0) {
    return { slope: 0, intercept: 0 }
  }

  if (x.length === 1) {
    const yFirst = y[0]
    return { slope: 0, intercept: yFirst ?? 0 }
  }

  const n = x.length
  const sumX = x.reduce((sum, v) => sum + v, 0)
  const sumY = y.reduce((sum, v) => sum + v, 0)
  const sumXY = x.reduce((sum, xi, i) => {
    const yi = y[i]
    return sum + (yi !== undefined ? xi * yi : 0)
  }, 0)
  const sumX2 = x.reduce((sum, v) => sum + v * v, 0)

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n

  return { slope, intercept }
}

/**
 * Calculate horizontal deviation for a box based on anchor type
 * For left/right anchor: distance from anchor
 * For center anchor: distance from center
 */
function calculateHorizontalDeviation(
  box: Box,
  anchorType: 'left' | 'center' | 'right',
  anchorPosition: number
): number {
  const boxCenter = (box.left + box.right) / 2

  switch (anchorType) {
    case 'left':
      return Math.abs(box.left - anchorPosition)
    case 'right':
      return Math.abs(box.right - anchorPosition)
    case 'center':
      return Math.abs(boxCenter - anchorPosition)
  }
}

/**
 * Calculate distribution parameters from predicted caption boxes
 *
 * @param boxes - Array of caption boxes (in absolute pixel coordinates)
 * @param layoutConfig - Current layout configuration
 * @returns Distribution parameters for constraint expansion
 */
export function calculateDistributionParams(
  boxes: Box[],
  layoutConfig: LayoutConfig
): DistributionParams {
  if (boxes.length === 0) {
    // No boxes - return default parameters
    return {
      top_edge_std: 10,
      bottom_edge_std: 10,
      horizontal_std_slope: 0.05,
      horizontal_std_intercept: 5,
    }
  }

  // 1. Calculate top edge standard deviation
  const topEdges = boxes.map((box) => box.top)
  const topStats = calculateStats(topEdges)

  // 2. Calculate bottom edge standard deviation
  const bottomEdges = boxes.map((box) => box.bottom)
  const bottomStats = calculateStats(bottomEdges)

  // 3. Calculate horizontal stddev linear model
  // For each box, calculate:
  //   - Distance from anchor (x variable)
  //   - Horizontal deviation (y variable)
  const distances: number[] = []
  const deviations: number[] = []

  for (const box of boxes) {
    const boxCenter = (box.left + box.right) / 2
    const distanceFromAnchor = Math.abs(boxCenter - layoutConfig.anchor_position)

    const deviation = calculateHorizontalDeviation(
      box,
      layoutConfig.anchor_type,
      layoutConfig.anchor_position
    )

    distances.push(distanceFromAnchor)
    deviations.push(deviation)
  }

  // Fit linear regression: horizontal_std = slope * distance + intercept
  const regression = linearRegression(distances, deviations)

  return {
    top_edge_std: topStats.std,
    bottom_edge_std: bottomStats.std,
    horizontal_std_slope: regression.slope,
    horizontal_std_intercept: regression.intercept,
  }
}

/**
 * Constants for constraint expansion
 */
export const STDDEV_MULTIPLE = 2.0 // ~95% coverage for normal distribution
export const CHAR_BUFFER_MULTIPLE = 2.5 // 2-3 extra characters

/**
 * Calculate constraint expansion for a specific edge
 *
 * @param edge - Which edge to expand
 * @param distanceFromAnchor - Distance of the violating box from anchor
 * @param anchorType - Type of anchor (left/center/right)
 * @param charWidth - Average character width in pixels
 * @param horizontalStdSlope - Slope of horizontal stddev linear model
 * @param horizontalStdIntercept - Intercept of horizontal stddev linear model
 * @param topEdgeStd - Standard deviation of top edges (for vertical expansion)
 * @param bottomEdgeStd - Standard deviation of bottom edges (for vertical expansion)
 * @returns Expansion amount in pixels
 */
export function calculateExpansion(
  edge: 'left' | 'right' | 'top' | 'bottom',
  distanceFromAnchor: number,
  anchorType: 'left' | 'center' | 'right',
  charWidth: number,
  horizontalStdSlope: number,
  horizontalStdIntercept: number,
  topEdgeStd?: number,
  bottomEdgeStd?: number
): number {
  // Vertical expansion (top/bottom)
  if (edge === 'top') {
    return STDDEV_MULTIPLE * (topEdgeStd || 10)
  }

  if (edge === 'bottom') {
    return STDDEV_MULTIPLE * (bottomEdgeStd || 10)
  }

  // Horizontal expansion (left/right)
  // Statistical padding based on distance from anchor
  const predictedStd =
    horizontalStdSlope * distanceFromAnchor + horizontalStdIntercept
  const statisticalPadding = STDDEV_MULTIPLE * predictedStd

  // Character buffer (only on far ends away from anchor)
  let charBuffer = 0

  if (
    (anchorType === 'left' && edge === 'right') ||
    (anchorType === 'right' && edge === 'left')
  ) {
    // Far end from anchor - full character buffer
    charBuffer = CHAR_BUFFER_MULTIPLE * charWidth
  } else if (anchorType === 'center') {
    // Center anchor - half buffer on both sides
    charBuffer = 0.5 * CHAR_BUFFER_MULTIPLE * charWidth
  }
  // else: near anchor - no character buffer

  return statisticalPadding + charBuffer
}
