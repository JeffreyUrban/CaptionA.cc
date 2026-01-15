/**
 * Types for the Review Labels annotation workflow
 */

import type { BoxLabel, TextAnchor } from '~/types/enums'

export interface FrameInfo {
  frameIndex: number
  totalBoxCount: number
  captionBoxCount: number
  minConfidence: number
  hasAnnotations: boolean
  imageUrl: string
}

export interface PotentialMislabel {
  frameIndex: number
  boxIndex: number
  boxText: string
  userLabel: BoxLabel
  predictedLabel: BoxLabel | null
  predictedConfidence: number | null
  boxTop: number
  topDeviation: number
  issueType: string
}

export interface LayoutConfig {
  frameWidth: number
  frameHeight: number
  cropLeft: number
  cropTop: number
  cropRight: number
  cropBottom: number
  selectionLeft: number | null
  selectionTop: number | null
  selectionRight: number | null
  selectionBottom: number | null
  verticalPosition: number | null
  verticalStd: number | null
  boxHeight: number | null
  boxHeightStd: number | null
  anchorType: TextAnchor | null
  anchorPosition: number | null
  topEdgeStd: number | null
  bottomEdgeStd: number | null
  horizontalStdSlope: number | null
  horizontalStdIntercept: number | null
  cropBoundsVersion: number
}

export interface BoxData {
  boxIndex: number
  text: string
  originalBounds: { left: number; top: number; right: number; bottom: number }
  displayBounds: { left: number; top: number; right: number; bottom: number }
  predictedLabel: BoxLabel
  predictedConfidence: number
  userLabel: BoxLabel | null
  colorCode: string
}

export interface FrameBoxesData {
  frameIndex: number
  imageUrl: string
  cropBounds: { left: number; top: number; right: number; bottom: number }
  frameWidth: number
  frameHeight: number
  boxes: BoxData[]
}

export type ViewMode = 'analysis' | 'frame'

/**
 * Color configuration for box display
 */
export interface BoxColors {
  border: string
  background: string
}

/**
 * Color code mapping for different box states
 */
export const BOX_COLOR_MAP: Record<string, BoxColors> = {
  annotated_in: { border: '#14b8a6', background: 'rgba(20,184,166,0.25)' },
  annotated_out: { border: '#dc2626', background: 'rgba(220,38,38,0.25)' },
  predicted_in_high: { border: '#3b82f6', background: 'rgba(59,130,246,0.15)' },
  predicted_in_medium: { border: '#60a5fa', background: 'rgba(96,165,250,0.1)' },
  predicted_in_low: { border: '#93c5fd', background: 'rgba(147,197,253,0.08)' },
  predicted_out_high: { border: '#f97316', background: 'rgba(249,115,22,0.15)' },
  predicted_out_medium: { border: '#fb923c', background: 'rgba(251,146,60,0.1)' },
  predicted_out_low: { border: '#fdba74', background: 'rgba(253,186,116,0.08)' },
}

export const DEFAULT_BOX_COLORS: BoxColors = {
  border: '#9ca3af',
  background: 'rgba(156,163,175,0.1)',
}

/**
 * Get box colors based on color code
 */
export function getBoxColors(colorCode: string): BoxColors {
  return BOX_COLOR_MAP[colorCode] ?? DEFAULT_BOX_COLORS
}
