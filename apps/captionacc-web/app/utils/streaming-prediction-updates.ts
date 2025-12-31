/**
 * Streaming prediction updates with intelligent scope detection.
 *
 * Provides continuous, non-blocking prediction updates after each annotation
 * instead of batch recalculation every 20 annotations.
 */

import {
  ADAPTIVE_RECALC_CONFIG,
  PREDICTION_CHANGE_CONFIG,
  type FeatureImportanceMetrics,
} from './streaming-prediction-config'
import { computeMahalanobisDistance, type GaussianParams } from './feature-importance'

/**
 * Box with current prediction and features.
 */
export interface BoxWithPrediction {
  frameIndex: number
  boxIndex: number
  features: number[] // 26-feature vector
  currentPrediction: {
    label: 'in' | 'out'
    confidence: number
  }
}

/**
 * Annotation event that triggers recalculation.
 */
export interface Annotation {
  frameIndex: number
  boxIndex: number
  label: 'in' | 'out'
  features: number[] // 26-feature vector
}

/**
 * Model parameters for change estimation.
 */
export interface ModelParams {
  prior_in: number
  prior_out: number
  in_features: GaussianParams[] // 26 features
  out_features: GaussianParams[] // 26 features
}

/**
 * Result of adaptive recalculation.
 */
export interface AdaptiveRecalcResult {
  /** Total boxes processed */
  totalProcessed: number
  /** Number of predictions that actually changed */
  totalReversals: number
  /** Final reversal rate when stopped */
  finalReversalRate: number
  /** Whether stopped early (vs exhausted candidates) */
  stoppedEarly: boolean
  /** Reason for stopping */
  reason: 'reversal_rate' | 'max_boxes' | 'exhausted_candidates'
}

/**
 * Estimate probability that a box's prediction will change after model update.
 *
 * Combines three factors:
 * 1. Current prediction uncertainty (low confidence → high change probability)
 * 2. Feature similarity to new annotation (weighted by Mahalanobis distance)
 * 3. Distance to decision boundary (near boundary → high change probability)
 *
 * @param box - Box with current prediction and features
 * @param newAnnotation - Newly annotated box
 * @param covarianceInverse - Inverse pooled covariance matrix (676 values)
 * @returns Probability in [0, 1] that prediction will flip
 */
export function estimatePredictionChangeProb(
  box: BoxWithPrediction,
  newAnnotation: Annotation,
  covarianceInverse: number[]
): number {
  // Factor 1: Uncertainty (inverse of confidence)
  // Low confidence predictions more likely to flip
  const uncertaintyFactor = 1.0 - box.currentPrediction.confidence

  // Factor 2: Weighted feature similarity using Mahalanobis distance
  const mahalanobisDistance = computeMahalanobisDistance(
    box.features,
    newAnnotation.features,
    covarianceInverse
  )

  // Convert distance to similarity [0-1] using exponential decay
  // similarity = exp(-distance²/(2σ²)) where σ = MAX_MAHALANOBIS_DISTANCE
  const sigma = PREDICTION_CHANGE_CONFIG.MAX_MAHALANOBIS_DISTANCE
  const similarityFactor = Math.exp(-(mahalanobisDistance ** 2) / (2 * sigma ** 2))

  // Factor 3: Decision boundary proximity
  // Boxes with confidence near 0.5 are on the decision boundary
  // proximity = 1 - |confidence - 0.5| * 2, ranges from 0 (far from boundary) to 1 (on boundary)
  const boundaryProximity = 1.0 - Math.abs(box.currentPrediction.confidence - 0.5) * 2

  // Weighted combination
  const changeProb =
    uncertaintyFactor * PREDICTION_CHANGE_CONFIG.UNCERTAINTY_WEIGHT +
    similarityFactor * PREDICTION_CHANGE_CONFIG.SIMILARITY_WEIGHT +
    boundaryProximity * PREDICTION_CHANGE_CONFIG.BOUNDARY_SENSITIVITY_WEIGHT

  // Clamp to [0, 1]
  return Math.min(1.0, Math.max(0.0, changeProb))
}

/**
 * Identify boxes that should be recalculated after annotation.
 *
 * Returns boxes sorted by change probability (highest first).
 *
 * @param newAnnotation - Newly annotated box
 * @param allBoxes - All boxes in video
 * @param covarianceInverse - Inverse pooled covariance matrix
 * @returns Boxes with change probability >= MIN_CHANGE_PROBABILITY, sorted descending
 */
export function identifyAffectedBoxes(
  newAnnotation: Annotation,
  allBoxes: BoxWithPrediction[],
  covarianceInverse: number[]
): Array<BoxWithPrediction & { changeProb: number }> {
  // Compute change probability for all boxes
  const boxesWithProb = allBoxes.map(box => ({
    ...box,
    changeProb: estimatePredictionChangeProb(box, newAnnotation, covarianceInverse),
  }))

  // Filter to candidates worth recalculating
  const candidates = boxesWithProb.filter(
    b => b.changeProb >= ADAPTIVE_RECALC_CONFIG.MIN_CHANGE_PROBABILITY
  )

  // Sort by change probability (highest first)
  candidates.sort((a, b) => b.changeProb - a.changeProb)

  return candidates
}

/**
 * Adaptive recalculation coordinator.
 *
 * Processes boxes in order of change probability, stopping when reversal rate
 * drops below threshold (indicating remaining boxes unlikely to change).
 *
 * This is a planning function - actual prediction and database updates
 * happen in the caller.
 *
 * @param candidates - Boxes sorted by change probability
 * @param predictAndUpdate - Async function to recalculate prediction and update DB
 * @returns Recalculation statistics
 */
export async function adaptiveRecalculation(
  candidates: Array<BoxWithPrediction & { changeProb: number }>,
  predictAndUpdate: (
    batch: Array<BoxWithPrediction & { changeProb: number }>
  ) => Promise<
    Array<{
      box: BoxWithPrediction & { changeProb: number }
      oldLabel: 'in' | 'out'
      newLabel: 'in' | 'out'
      didReverse: boolean
    }>
  >
): Promise<AdaptiveRecalcResult> {
  const reversalWindow: boolean[] = []
  let totalProcessed = 0
  let totalReversals = 0

  // Process in batches
  for (
    let i = 0;
    i < candidates.length && i < ADAPTIVE_RECALC_CONFIG.MAX_BOXES_PER_UPDATE;
    i += ADAPTIVE_RECALC_CONFIG.BATCH_SIZE
  ) {
    const batch = candidates.slice(i, i + ADAPTIVE_RECALC_CONFIG.BATCH_SIZE)

    // Recalculate predictions for batch
    const results = await predictAndUpdate(batch)

    // Track reversals
    for (const result of results) {
      reversalWindow.push(result.didReverse)
      if (result.didReverse) totalReversals++

      // Keep window size bounded
      if (reversalWindow.length > ADAPTIVE_RECALC_CONFIG.REVERSAL_WINDOW_SIZE) {
        const removed = reversalWindow.shift()
        if (removed) totalReversals--
      }
    }

    totalProcessed += batch.length

    // Check if we can stop early
    if (
      reversalWindow.length >= ADAPTIVE_RECALC_CONFIG.MIN_BOXES_BEFORE_CHECK &&
      reversalWindow.length >= ADAPTIVE_RECALC_CONFIG.REVERSAL_WINDOW_SIZE
    ) {
      const rollingReversalRate = totalReversals / reversalWindow.length

      if (rollingReversalRate < ADAPTIVE_RECALC_CONFIG.TARGET_REVERSAL_RATE) {
        const finalRate = totalReversals / reversalWindow.length
        console.log(
          `[adaptiveRecalc] Stopping early: reversal rate ${rollingReversalRate.toFixed(3)} ` +
            `below target ${ADAPTIVE_RECALC_CONFIG.TARGET_REVERSAL_RATE}`
        )

        return {
          totalProcessed,
          totalReversals,
          finalReversalRate: finalRate,
          stoppedEarly: true,
          reason: 'reversal_rate',
        }
      }
    }

    // Yield to event loop for UI responsiveness
    await sleep(0)
  }

  // Determine why we stopped
  const hitMaxBoxes = totalProcessed >= ADAPTIVE_RECALC_CONFIG.MAX_BOXES_PER_UPDATE
  const exhaustedCandidates = totalProcessed >= candidates.length

  const finalRate =
    reversalWindow.length > 0
      ? totalReversals / reversalWindow.length
      : totalReversals / Math.max(1, totalProcessed)

  return {
    totalProcessed,
    totalReversals,
    finalReversalRate: finalRate,
    stoppedEarly: false,
    reason: hitMaxBoxes ? 'max_boxes' : 'exhausted_candidates',
  }
}

/**
 * Sleep for specified milliseconds (yields to event loop).
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Chunk array into batches of specified size.
 *
 * @param array - Array to chunk
 * @param size - Batch size
 * @returns Array of batches
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}
