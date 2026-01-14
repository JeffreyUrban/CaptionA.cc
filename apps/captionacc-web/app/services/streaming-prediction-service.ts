/**
 * Streaming prediction update service.
 *
 * Provides intelligent, incremental prediction updates after annotations
 * instead of full batch recalculation.
 */

import type Database from 'better-sqlite3'

import {
  extractFeatures,
  predictBoxLabel,
  type BoxBounds,
  type VideoLayoutConfig,
} from '~/utils/box-prediction'
import {
  identifyAffectedBoxes,
  adaptiveRecalculation,
  type BoxWithPrediction,
  type Annotation,
} from '~/utils/streaming-prediction-updates'

/**
 * Result of streaming prediction update.
 */
export interface StreamingUpdateResult {
  success: boolean
  /** Total boxes considered for update */
  candidatesIdentified: number
  /** Boxes actually processed */
  boxesProcessed: number
  /** Predictions that changed */
  predictionsChanged: number
  /** Final reversal rate when stopped */
  finalReversalRate: number
  /** Why the update stopped */
  stopReason: 'reversal_rate' | 'max_boxes' | 'exhausted_candidates' | 'no_covariance'
}

/**
 * OCR box data from database.
 */
interface OcrBoxRow {
  frame_index: number
  box_index: number
  text: string
  x: number
  y: number
  width: number
  height: number
  timestamp_seconds: number
  predicted_label: 'in' | 'out'
  predicted_confidence: number
}

/**
 * Convert OCR fractional coordinates to pixel bounds.
 */
function ocrToPixelBounds(
  ocrBox: { x: number; y: number; width: number; height: number },
  frameWidth: number,
  frameHeight: number
): BoxBounds {
  const boxLeft = Math.floor(ocrBox.x * frameWidth)
  const boxBottom = Math.floor((1 - ocrBox.y) * frameHeight)
  const boxTop = boxBottom - Math.floor(ocrBox.height * frameHeight)
  const boxRight = boxLeft + Math.floor(ocrBox.width * frameWidth)

  return { left: boxLeft, top: boxTop, right: boxRight, bottom: boxBottom }
}

/**
 * Load all boxes with their current predictions and features.
 *
 * @param db - Database connection
 * @param layoutConfig - Video layout configuration
 * @param durationSeconds - Video duration
 * @returns Array of boxes with predictions and features
 */
function loadAllBoxesWithFeatures(
  db: Database.Database,
  layoutConfig: VideoLayoutConfig,
  durationSeconds: number
): BoxWithPrediction[] {
  // Get all OCR boxes with predictions
  const allBoxes = db
    .prepare(
      `
      SELECT frame_index, box_index, text, x, y, width, height,
             timestamp_seconds, predicted_label, predicted_confidence
      FROM full_frame_ocr
      WHERE predicted_label IS NOT NULL
      ORDER BY frame_index, box_index
    `
    )
    .all() as OcrBoxRow[]

  // Group boxes by frame for feature extraction context
  const frameBoxesMap = new Map<number, OcrBoxRow[]>()
  for (const box of allBoxes) {
    if (!frameBoxesMap.has(box.frame_index)) {
      frameBoxesMap.set(box.frame_index, [])
    }
    frameBoxesMap.get(box.frame_index)!.push(box)
  }

  // Extract features for each box
  const boxesWithFeatures: BoxWithPrediction[] = []

  for (const frameIndex of Array.from(frameBoxesMap.keys())) {
    const frameBoxes = frameBoxesMap.get(frameIndex)!
    // Convert all boxes to bounds for context
    const allBounds = frameBoxes.map(b =>
      ocrToPixelBounds(b, layoutConfig.frame_width, layoutConfig.frame_height)
    )

    for (const box of frameBoxes) {
      const bounds = ocrToPixelBounds(box, layoutConfig.frame_width, layoutConfig.frame_height)

      const features = extractFeatures(
        bounds,
        layoutConfig,
        allBounds,
        frameIndex,
        box.box_index,
        box.text,
        box.timestamp_seconds,
        durationSeconds,
        db
      )

      boxesWithFeatures.push({
        frameIndex,
        boxIndex: box.box_index,
        features,
        currentPrediction: {
          label: box.predicted_label,
          confidence: box.predicted_confidence,
        },
      })
    }
  }

  return boxesWithFeatures
}

/**
 * Apply streaming prediction updates after a new annotation.
 *
 * Uses intelligent scope detection to identify affected boxes and adaptive
 * recalculation to stop when predictions stabilize.
 *
 * @param db - Database connection
 * @param newAnnotation - The newly created annotation
 * @param layoutConfig - Video layout configuration
 * @returns Update result with statistics
 */
export async function applyStreamingPredictionUpdates(
  db: Database.Database,
  newAnnotation: {
    frameIndex: number
    boxIndex: number
    label: 'in' | 'out'
  },
  layoutConfig: VideoLayoutConfig
): Promise<StreamingUpdateResult> {
  try {
    // Check if model has covariance inverse (required for Mahalanobis distance)
    const modelData = db
      .prepare('SELECT covariance_inverse FROM box_classification_model WHERE id = 1')
      .get() as { covariance_inverse: string | null } | undefined

    if (!modelData?.covariance_inverse) {
      console.log('[streamingUpdate] No covariance matrix - skipping streaming updates')
      return {
        success: false,
        candidatesIdentified: 0,
        boxesProcessed: 0,
        predictionsChanged: 0,
        finalReversalRate: 0,
        stopReason: 'no_covariance',
      }
    }

    const covarianceInverse = JSON.parse(modelData.covariance_inverse) as number[]

    // Get video duration
    const videoDuration = db
      .prepare('SELECT duration_seconds FROM video_metadata WHERE id = 1')
      .get() as { duration_seconds: number } | undefined
    const durationSeconds = videoDuration?.duration_seconds ?? 600.0

    // Get annotation box data
    const annotationBox = db
      .prepare(
        `
        SELECT text, x, y, width, height, timestamp_seconds
        FROM full_frame_ocr
        WHERE frame_index = ? AND box_index = ?
      `
      )
      .get(newAnnotation.frameIndex, newAnnotation.boxIndex) as
      | {
          text: string
          x: number
          y: number
          width: number
          height: number
          timestamp_seconds: number
        }
      | undefined

    if (!annotationBox) {
      console.warn('[streamingUpdate] Annotation box not found in OCR data')
      return {
        success: false,
        candidatesIdentified: 0,
        boxesProcessed: 0,
        predictionsChanged: 0,
        finalReversalRate: 0,
        stopReason: 'no_covariance',
      }
    }

    // Get all boxes in annotation's frame for feature extraction context
    const frameBoxes = db
      .prepare(
        `
        SELECT box_index, x, y, width, height
        FROM full_frame_ocr
        WHERE frame_index = ?
        ORDER BY box_index
      `
      )
      .all(newAnnotation.frameIndex) as Array<{
      box_index: number
      x: number
      y: number
      width: number
      height: number
    }>

    const allBoundsInFrame = frameBoxes.map(b =>
      ocrToPixelBounds(b, layoutConfig.frame_width, layoutConfig.frame_height)
    )

    const annotationBounds = ocrToPixelBounds(
      annotationBox,
      layoutConfig.frame_width,
      layoutConfig.frame_height
    )

    // Extract features for the new annotation
    const annotationFeatures = extractFeatures(
      annotationBounds,
      layoutConfig,
      allBoundsInFrame,
      newAnnotation.frameIndex,
      newAnnotation.boxIndex,
      annotationBox.text,
      annotationBox.timestamp_seconds,
      durationSeconds,
      db
    )

    const annotation: Annotation = {
      frameIndex: newAnnotation.frameIndex,
      boxIndex: newAnnotation.boxIndex,
      label: newAnnotation.label,
      features: annotationFeatures,
    }

    // Load all boxes with features and current predictions
    console.log('[streamingUpdate] Loading all boxes with features...')
    const allBoxes = loadAllBoxesWithFeatures(db, layoutConfig, durationSeconds)
    console.log(`[streamingUpdate] Loaded ${allBoxes.length} boxes`)

    // Identify affected boxes using Mahalanobis distance
    console.log('[streamingUpdate] Identifying affected boxes...')
    const candidates = identifyAffectedBoxes(annotation, allBoxes, covarianceInverse)
    console.log(`[streamingUpdate] Identified ${candidates.length} candidates for update`)

    if (candidates.length === 0) {
      return {
        success: true,
        candidatesIdentified: 0,
        boxesProcessed: 0,
        predictionsChanged: 0,
        finalReversalRate: 0,
        stopReason: 'exhausted_candidates',
      }
    }

    // Prepare update statement
    const updatePrediction = db.prepare(`
      UPDATE full_frame_ocr
      SET predicted_label = ?, predicted_confidence = ?
      WHERE frame_index = ? AND box_index = ?
    `)

    // Create the predictAndUpdate function for adaptive recalculation
    const predictAndUpdate = async (
      batch: Array<BoxWithPrediction & { changeProb: number }>
    ): Promise<
      Array<{
        box: BoxWithPrediction & { changeProb: number }
        oldLabel: 'in' | 'out'
        newLabel: 'in' | 'out'
        didReverse: boolean
      }>
    > => {
      const results: Array<{
        box: BoxWithPrediction & { changeProb: number }
        oldLabel: 'in' | 'out'
        newLabel: 'in' | 'out'
        didReverse: boolean
      }> = []

      for (const box of batch) {
        // Get box data for prediction
        const boxData = db
          .prepare(
            `
            SELECT x, y, width, height
            FROM full_frame_ocr
            WHERE frame_index = ? AND box_index = ?
          `
          )
          .get(box.frameIndex, box.boxIndex) as
          | { x: number; y: number; width: number; height: number }
          | undefined

        if (!boxData) continue

        const bounds = ocrToPixelBounds(
          boxData,
          layoutConfig.frame_width,
          layoutConfig.frame_height
        )

        // Get all boxes in this frame for context
        const frameBoxes = db
          .prepare(
            `
            SELECT box_index, x, y, width, height
            FROM full_frame_ocr
            WHERE frame_index = ?
            ORDER BY box_index
          `
          )
          .all(box.frameIndex) as Array<{
          box_index: number
          x: number
          y: number
          width: number
          height: number
        }>

        const allBounds = frameBoxes.map(b =>
          ocrToPixelBounds(b, layoutConfig.frame_width, layoutConfig.frame_height)
        )

        // Recalculate prediction with updated model
        const newPrediction = predictBoxLabel(
          bounds,
          layoutConfig,
          allBounds,
          box.frameIndex,
          box.boxIndex,
          db
        )

        // Update database
        updatePrediction.run(
          newPrediction.label,
          newPrediction.confidence,
          box.frameIndex,
          box.boxIndex
        )

        const didReverse = box.currentPrediction.label !== newPrediction.label

        results.push({
          box,
          oldLabel: box.currentPrediction.label,
          newLabel: newPrediction.label,
          didReverse,
        })
      }

      return results
    }

    // Run adaptive recalculation
    console.log('[streamingUpdate] Running adaptive recalculation...')
    const recalcResult = await adaptiveRecalculation(candidates, predictAndUpdate)

    console.log(
      `[streamingUpdate] Complete: processed=${recalcResult.totalProcessed}, ` +
        `changed=${recalcResult.totalReversals}, rate=${recalcResult.finalReversalRate.toFixed(3)}, ` +
        `reason=${recalcResult.reason}`
    )

    return {
      success: true,
      candidatesIdentified: candidates.length,
      boxesProcessed: recalcResult.totalProcessed,
      predictionsChanged: recalcResult.totalReversals,
      finalReversalRate: recalcResult.finalReversalRate,
      stopReason: recalcResult.reason,
    }
  } catch (error) {
    console.error('[streamingUpdate] Error:', error)
    return {
      success: false,
      candidatesIdentified: 0,
      boxesProcessed: 0,
      predictionsChanged: 0,
      finalReversalRate: 0,
      stopReason: 'no_covariance',
    }
  }
}
