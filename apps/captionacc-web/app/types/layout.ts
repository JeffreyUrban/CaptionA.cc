/**
 * Types for the Layout annotation workflow
 */

// Re-export shared types from review-labels
export type {
  FrameInfo,
  LayoutConfig,
  BoxData,
  FrameBoxesData,
  ViewMode,
  BoxColors,
} from './review-labels'
export { BOX_COLOR_MAP, DEFAULT_BOX_COLORS, getBoxColors } from './review-labels'

/**
 * Response from layout queue API
 */
export interface LayoutQueueResponse {
  frames?: import('./review-labels').FrameInfo[]
  layoutConfig?: import('./review-labels').LayoutConfig
  layoutApproved?: boolean
}

/**
 * Box statistics for progress display
 */
export interface BoxStats {
  totalBoxes: number
  captionBoxes: number
  noiseBoxes: number
}

/**
 * Crop bounds edit state
 */
export interface CropBoundsEdit {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Selection rectangle edit state
 */
export interface SelectionRectEdit {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Layout parameters edit state
 */
export interface LayoutParamsEdit {
  verticalPosition: number | null
  verticalStd: number | null
  boxHeight: number | null
  boxHeightStd: number | null
  anchorType: 'left' | 'center' | 'right' | null
  anchorPosition: number | null
}

/**
 * Edit state updaters for loadQueue callback
 */
export interface EditStateUpdaters {
  setCropBoundsEdit: (value: CropBoundsEdit | null) => void
  setSelectionRectEdit: (value: SelectionRectEdit | null) => void
  setLayoutParamsEdit: (value: LayoutParamsEdit | null) => void
}

/**
 * Selection rectangle in canvas coordinates
 */
export interface SelectionRectangle {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Canvas point (x, y coordinates)
 */
export interface CanvasPoint {
  x: number
  y: number
}

/**
 * Selection label type
 */
export type SelectionLabel = 'in' | 'out' | 'clear'

/**
 * Parameters for rendering a box on canvas
 */
export interface BoxRenderParams {
  box: import('./review-labels').BoxData
  boxIndex: number
  scale: number
  hoveredBoxIndex: number | null
  boxHighlightMode: boolean
  pulseValue: number
  pulseIntensity: number
}

/**
 * Parameters for rendering selection rectangle
 */
export interface SelectionRenderParams {
  selectionStart: CanvasPoint
  selectionCurrent: CanvasPoint
  selectionLabel: SelectionLabel
  viewMode: import('./review-labels').ViewMode
}

/**
 * Context for keyboard shortcut handlers
 */
export interface KeyboardShortcutContext {
  viewMode: import('./review-labels').ViewMode
  selectedFrameIndex: number | null
  frames: import('./review-labels').FrameInfo[]
  hoveredBoxIndex: number | null
  currentFrameBoxes: import('./review-labels').FrameBoxesData | null
  isSelecting: boolean
  handleThumbnailClick: (frameIndex: number | 'analysis') => void
  handleBoxClick: (boxIndex: number, label: 'in' | 'out') => Promise<void>
  cancelSelection: () => void
}

/**
 * Result from finding enclosed boxes
 */
export interface EnclosedBoxesResult {
  enclosedBoxes: number[]
  newlyAnnotatedCount: number
}

/**
 * Recalculation threshold constant
 */
export const RECALC_THRESHOLD = 50
