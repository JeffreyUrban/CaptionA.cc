/**
 * Smart retrain triggers for adaptive model updates.
 *
 * Determines when to trigger full model retraining based on:
 * - Annotation count (enough new samples)
 * - Time since last retrain (prevent thrashing, ensure freshness)
 * - Annotation rate (adapt to user pace)
 */

import { RETRAIN_TRIGGER_CONFIG } from './streaming-prediction-config'

/**
 * Retrain state tracking.
 */
export interface RetrainState {
  /** When model was last retrained */
  lastRetrainTime: Date
  /** Number of annotations when last retrained */
  lastRetrainAnnotationCount: number
  /** Current total annotation count */
  currentAnnotationCount: number
}

/**
 * Result of retrain trigger check.
 */
export interface RetrainTriggerResult {
  /** Whether to trigger retrain */
  shouldRetrain: boolean
  /** Reason for decision */
  reason: string
  /** Annotations since last retrain */
  newAnnotations: number
  /** Seconds since last retrain */
  secondsSinceRetrain: number
  /** Current annotation rate (per minute) */
  annotationRatePerMinute: number
}

/**
 * Determine if full model retrain should be triggered.
 *
 * Multiple trigger conditions to adapt to different annotation patterns:
 * 1. Standard trigger: Enough new annotations (100) AND enough time passed (3 min)
 * 2. High-rate trigger: Fast annotation (20/min) with minimum samples (30)
 * 3. Time-based trigger: Too long since last retrain (30 min) with new annotations
 *
 * Always requires minimum total annotations (20) before first retrain.
 *
 * @param state - Current retrain state
 * @returns Trigger decision with reason
 */
export function shouldTriggerFullRetrain(state: RetrainState): RetrainTriggerResult {
  const now = new Date()
  const secondsSinceRetrain = (now.getTime() - state.lastRetrainTime.getTime()) / 1000
  const newAnnotations = state.currentAnnotationCount - state.lastRetrainAnnotationCount

  // Calculate annotation rate (per minute)
  const minutesSinceRetrain = secondsSinceRetrain / 60
  const annotationRatePerMinute =
    minutesSinceRetrain > 0 ? newAnnotations / minutesSinceRetrain : 0

  // Check 1: Not enough total annotations yet
  if (state.currentAnnotationCount < RETRAIN_TRIGGER_CONFIG.MIN_ANNOTATIONS_FOR_RETRAIN) {
    return {
      shouldRetrain: false,
      reason: 'insufficient_total_annotations',
      newAnnotations,
      secondsSinceRetrain,
      annotationRatePerMinute,
    }
  }

  // Check 2: No new annotations since last retrain
  if (newAnnotations === 0) {
    return {
      shouldRetrain: false,
      reason: 'no_new_annotations',
      newAnnotations,
      secondsSinceRetrain,
      annotationRatePerMinute,
    }
  }

  // Check 3: Too soon since last retrain (prevent thrashing)
  if (secondsSinceRetrain < RETRAIN_TRIGGER_CONFIG.MIN_RETRAIN_INTERVAL_SECONDS) {
    return {
      shouldRetrain: false,
      reason: 'min_interval_not_reached',
      newAnnotations,
      secondsSinceRetrain,
      annotationRatePerMinute,
    }
  }

  // Trigger 1: Standard - enough new annotations
  if (newAnnotations >= RETRAIN_TRIGGER_CONFIG.ANNOTATION_COUNT_THRESHOLD) {
    return {
      shouldRetrain: true,
      reason: 'annotation_count_threshold',
      newAnnotations,
      secondsSinceRetrain,
      annotationRatePerMinute,
    }
  }

  // Trigger 2: High-rate - user annotating quickly
  if (
    annotationRatePerMinute >= RETRAIN_TRIGGER_CONFIG.HIGH_ANNOTATION_RATE_PER_MINUTE &&
    newAnnotations >= RETRAIN_TRIGGER_CONFIG.HIGH_RATE_MIN_ANNOTATIONS
  ) {
    return {
      shouldRetrain: true,
      reason: 'high_annotation_rate',
      newAnnotations,
      secondsSinceRetrain,
      annotationRatePerMinute,
    }
  }

  // Trigger 3: Time-based - too long since last retrain
  if (secondsSinceRetrain >= RETRAIN_TRIGGER_CONFIG.MAX_RETRAIN_INTERVAL_SECONDS) {
    return {
      shouldRetrain: true,
      reason: 'max_interval_exceeded',
      newAnnotations,
      secondsSinceRetrain,
      annotationRatePerMinute,
    }
  }

  // No trigger conditions met
  return {
    shouldRetrain: false,
    reason: 'no_trigger_conditions_met',
    newAnnotations,
    secondsSinceRetrain,
    annotationRatePerMinute,
  }
}

/**
 * Get retrain state from database model.
 *
 * @param db - Database connection
 * @returns Current retrain state
 */
export function getRetrainState(
  db: any // Database.Database type
): RetrainState {
  // Get model info
  const modelInfo = db
    .prepare('SELECT trained_at, n_training_samples FROM box_classification_model WHERE id = 1')
    .get() as { trained_at: string; n_training_samples: number } | undefined

  // Get current annotation count
  const annotationCount = db
    .prepare("SELECT COUNT(*) as count FROM full_frame_box_labels WHERE label_source = 'user'")
    .get() as { count: number }

  // Parse last retrain time
  const lastRetrainTime = modelInfo?.trained_at ? new Date(modelInfo.trained_at) : new Date(0)

  return {
    lastRetrainTime,
    lastRetrainAnnotationCount: modelInfo?.n_training_samples ?? 0,
    currentAnnotationCount: annotationCount.count,
  }
}

/**
 * Format retrain trigger result for logging.
 *
 * @param result - Trigger check result
 * @returns Formatted log message
 */
export function formatRetrainTriggerLog(result: RetrainTriggerResult): string {
  const { shouldRetrain, reason, newAnnotations, secondsSinceRetrain, annotationRatePerMinute } =
    result

  if (!shouldRetrain) {
    return (
      `[retrain] Not triggered: ${reason} ` +
      `(new=${newAnnotations}, elapsed=${Math.round(secondsSinceRetrain)}s, ` +
      `rate=${annotationRatePerMinute.toFixed(1)}/min)`
    )
  }

  return (
    `[retrain] TRIGGERED: ${reason} ` +
    `(new=${newAnnotations}, elapsed=${Math.round(secondsSinceRetrain)}s, ` +
    `rate=${annotationRatePerMinute.toFixed(1)}/min)`
  )
}
