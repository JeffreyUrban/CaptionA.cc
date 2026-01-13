/**
 * Centralized enum definitions for the application.
 * Single source of truth for all enumerated values used in database schemas,
 * TypeScript types, and validation.
 */

// =============================================================================
// Annotation States
// =============================================================================

/**
 * Caption frame extents annotation states
 * Used in: captions.caption_frame_extents_state
 */
export const ANNOTATION_STATES = ['predicted', 'confirmed', 'gap', 'issue'] as const
export type AnnotationState = (typeof ANNOTATION_STATES)[number]

/**
 * Text annotation status values
 * Used in: captions.text_status
 */
export const TEXT_STATUS_VALUES = [
  'valid_caption',
  'ocr_error',
  'partial_caption',
  'text_unclear',
  'other_issue',
  'confirmed',
] as const
export type TextStatus = (typeof TEXT_STATUS_VALUES)[number]

// =============================================================================
// Layout & Alignment
// =============================================================================

/**
 * Text anchor/alignment options
 * Used in: video_layout_config.anchor_type, video_preferences.text_anchor
 */
export const TEXT_ANCHOR_VALUES = ['left', 'center', 'right'] as const
export type TextAnchor = (typeof TEXT_ANCHOR_VALUES)[number]

// =============================================================================
// OCR Box Classification
// =============================================================================

/**
 * OCR box labels (caption vs noise)
 * Used in: full_frame_ocr.predicted_label, full_frame_box_labels.label
 */
export const BOX_LABEL_VALUES = ['in', 'out'] as const
export type BoxLabel = (typeof BOX_LABEL_VALUES)[number]

/**
 * Label source (human vs model)
 * Used in: full_frame_box_labels.label_source
 */
export const LABEL_SOURCE_VALUES = ['user', 'model'] as const
export type LabelSource = (typeof LABEL_SOURCE_VALUES)[number]

/**
 * Annotation source (where annotation came from)
 * Used in: full_frame_box_labels.annotation_source
 */
export const ANNOTATION_SOURCE_VALUES = ['full_frame', 'cropped_frame'] as const
export type AnnotationSource = (typeof ANNOTATION_SOURCE_VALUES)[number]

// =============================================================================
// Video Processing
// =============================================================================

/**
 * Upload method tracking
 * Used in: video_metadata.upload_method
 */
export const UPLOAD_METHOD_VALUES = ['web_upload', 'api_upload', 'manual'] as const
export type UploadMethod = (typeof UPLOAD_METHOD_VALUES)[number]

/**
 * Video processing status
 * Used in: processing_status.status
 */
export const PROCESSING_STATUS_VALUES = [
  'uploading',
  'upload_complete',
  'extracting_frames',
  'analyzing_layout',
  'processing_complete',
  'error',
] as const
export type ProcessingStatus = (typeof PROCESSING_STATUS_VALUES)[number]

// =============================================================================
// SQL CHECK Constraint Generators
// =============================================================================

/**
 * Generate SQL CHECK constraint for a given enum array
 */
function generateCheckConstraint(columnName: string, values: readonly string[]): string {
  const valueList = values.map(v => `'${v}'`).join(', ')
  return `CHECK(${columnName} IN (${valueList}))`
}

/**
 * Pre-generated CHECK constraints for common use cases
 */
export const SQL_CONSTRAINTS = {
  annotationState: generateCheckConstraint('caption_frame_extents_state', ANNOTATION_STATES),
  textStatus: generateCheckConstraint('text_status', TEXT_STATUS_VALUES),
  textAnchor: generateCheckConstraint('text_anchor', TEXT_ANCHOR_VALUES),
  anchorType: generateCheckConstraint('anchor_type', TEXT_ANCHOR_VALUES),
  boxLabel: generateCheckConstraint('label', BOX_LABEL_VALUES),
  predictedLabel: generateCheckConstraint('predicted_label', BOX_LABEL_VALUES),
  labelSource: generateCheckConstraint('label_source', LABEL_SOURCE_VALUES),
  annotationSource: generateCheckConstraint('annotation_source', ANNOTATION_SOURCE_VALUES),
  uploadMethod: generateCheckConstraint('upload_method', UPLOAD_METHOD_VALUES),
  processingStatus: generateCheckConstraint('status', PROCESSING_STATUS_VALUES),
} as const

/**
 * Runtime validation helpers
 */
export const isAnnotationState = (value: unknown): value is AnnotationState =>
  typeof value === 'string' && ANNOTATION_STATES.includes(value as AnnotationState)

export const isTextStatus = (value: unknown): value is TextStatus =>
  typeof value === 'string' && TEXT_STATUS_VALUES.includes(value as TextStatus)

export const isTextAnchor = (value: unknown): value is TextAnchor =>
  typeof value === 'string' && TEXT_ANCHOR_VALUES.includes(value as TextAnchor)

export const isBoxLabel = (value: unknown): value is BoxLabel =>
  typeof value === 'string' && BOX_LABEL_VALUES.includes(value as BoxLabel)

export const isLabelSource = (value: unknown): value is LabelSource =>
  typeof value === 'string' && LABEL_SOURCE_VALUES.includes(value as LabelSource)

export const isAnnotationSource = (value: unknown): value is AnnotationSource =>
  typeof value === 'string' && ANNOTATION_SOURCE_VALUES.includes(value as AnnotationSource)

export const isUploadMethod = (value: unknown): value is UploadMethod =>
  typeof value === 'string' && UPLOAD_METHOD_VALUES.includes(value as UploadMethod)

export const isProcessingStatus = (value: unknown): value is ProcessingStatus =>
  typeof value === 'string' && PROCESSING_STATUS_VALUES.includes(value as ProcessingStatus)
