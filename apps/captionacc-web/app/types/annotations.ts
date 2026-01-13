/**
 * Shared type definitions for annotation API files.
 *
 * This module centralizes types that were previously duplicated across
 * multiple API route files, ensuring consistency and reducing maintenance burden.
 */

import type { BoxLabel, LabelSource, AnnotationSource, TextAnchor } from '~/types/enums'
import type { PixelBounds } from '~/utils/coordinate-utils'

// =============================================================================
// Database Record Types
// =============================================================================

/**
 * Annotation record from the captions table (database schema).
 *
 * Represents a single caption annotation with caption frame extents and text information.
 * The caption frame extents workflow determines start/end frames, while the text workflow
 * handles the actual caption text.
 */
export interface Annotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  caption_frame_extents_state: 'predicted' | 'confirmed' | 'gap'
  caption_frame_extents_pending: number
  caption_frame_extents_updated_at: string
  text: string | null
  text_pending: number
  text_status: string | null
  text_notes: string | null
  caption_ocr: string | null
  text_updated_at: string
  created_at: string
}

/**
 * Video layout configuration from the video_layout_config table.
 *
 * Contains frame dimensions, crop region, selection region, and layout
 * parameters used for OCR box classification. This is the comprehensive
 * version with all fields from the database schema.
 */
export interface VideoLayoutConfig {
  id?: number
  frame_width: number
  frame_height: number
  crop_left: number
  crop_top: number
  crop_right: number
  crop_bottom: number
  selection_left: number | null
  selection_top: number | null
  selection_right: number | null
  selection_bottom: number | null
  selection_mode: 'hard' | 'soft' | 'disabled'
  vertical_position: number | null
  vertical_std: number | null
  box_height: number | null
  box_height_std: number | null
  anchor_type: TextAnchor | null
  anchor_position: number | null
  top_edge_std: number | null
  bottom_edge_std: number | null
  horizontal_std_slope: number | null
  horizontal_std_intercept: number | null
  crop_region_version: number
  analysis_model_version: string | null
  updated_at: string
}

/**
 * Partial VideoLayoutConfig containing only the fields needed for crop region.
 * Used when only crop-related information is needed.
 */
export interface CropRegionConfig {
  crop_left: number
  crop_top: number
  crop_right: number
  crop_bottom: number
}

/**
 * Partial VideoLayoutConfig containing only frame dimensions.
 * Used when only size information is needed.
 */
export interface FrameDimensions {
  frame_width: number
  frame_height: number
}

// =============================================================================
// OCR Data Types
// =============================================================================

/**
 * Python OCR annotation format from paddleocr output.
 *
 * Format: [text, confidence, [x, y, width, height]]
 * - text: Detected text string
 * - confidence: Detection confidence (0-1)
 * - coords: [x, y, width, height] in fractional coordinates (0-1)
 *
 * IMPORTANT: The y coordinate is measured from the BOTTOM of the image,
 * not the top. This is a legacy format from the Python OCR pipeline.
 */
export type PythonOCRAnnotation = [string, number, [number, number, number, number]]

/**
 * OCR box record from the full_frame_ocr table.
 */
export interface OcrBoxRecord {
  frame_index: number
  box_index: number
  text: string
  confidence: number
  /** Fractional x coordinate (0-1), left edge */
  x: number
  /** Fractional y coordinate (0-1), measured from BOTTOM of image */
  y: number
  /** Fractional width (0-1) */
  width: number
  /** Fractional height (0-1) */
  height: number
  predicted_label: BoxLabel | null
  predicted_confidence: number | null
}

/**
 * Box label record from the full_frame_box_labels table.
 */
export interface BoxLabelRecord {
  annotation_source: AnnotationSource
  frame_index: number
  box_index: number
  box_text: string
  box_left: number
  box_top: number
  box_right: number
  box_bottom: number
  label: BoxLabel
  label_source: LabelSource
  predicted_label: BoxLabel | null
  predicted_confidence: number | null
  model_version: string | null
  labeled_at: string
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Box data for frontend display.
 *
 * Contains both original pixel coordinates and display bounds
 * (fractional coordinates in cropped space) for rendering.
 */
export interface BoxData {
  boxIndex: number
  text: string
  /**
   * Original pixel coordinates in full frame space.
   * These are the raw coordinates before any cropping.
   */
  originalBounds: PixelBounds
  /**
   * Display bounds as fractional coordinates (0-1) in cropped space.
   * Used for frontend rendering where the displayed image is cropped.
   */
  displayBounds: { left: number; top: number; right: number; bottom: number }
  predictedLabel: BoxLabel
  predictedConfidence: number
  userLabel: BoxLabel | null
  /**
   * Color code for visual differentiation.
   * Combines prediction confidence and user annotation status.
   * Values: 'annotated_in', 'annotated_out', 'predicted_in_high',
   *         'predicted_in_medium', 'predicted_in_low', 'predicted_out_high',
   *         'predicted_out_medium', 'predicted_out_low'
   */
  colorCode: string
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Model version information from box_classification_model table.
 */
export interface ModelInfo {
  model_version: string
  n_training_samples: number
}

/**
 * Annotation statistics from database queries.
 */
export interface AnnotationStats {
  total_annotations: number
  last_model_count: number
}

/**
 * Request body for saving box annotations.
 */
export interface SaveBoxAnnotationsRequest {
  annotations: Array<{ boxIndex: number; label: BoxLabel }>
}

/**
 * Request body for updating layout configuration.
 */
export interface UpdateLayoutConfigRequest {
  cropRegion?: { left: number; top: number; right: number; bottom: number }
  selectionRegion?: { left: number; top: number; right: number; bottom: number }
  selectionMode?: 'hard' | 'soft' | 'disabled'
  layoutParams?: {
    verticalPosition: number
    verticalStd: number
    boxHeight: number
    boxHeightStd: number
    anchorType: TextAnchor
    anchorPosition: number
  }
}
