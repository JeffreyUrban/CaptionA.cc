/**
 * Bayesian prediction for OCR box classification.
 *
 * Predicts whether a box is a caption ("in") or noise ("out") based on:
 * - Trained Gaussian Naive Bayes model (when available)
 * - Fallback heuristics based on layout parameters
 */

import type Database from 'better-sqlite3'

interface VideoLayoutConfig {
  frame_width: number
  frame_height: number
  crop_left: number
  crop_top: number
  crop_right: number
  crop_bottom: number
  vertical_position: number | null
  vertical_std: number | null
  box_height: number | null
  box_height_std: number | null
  anchor_type: 'left' | 'center' | 'right' | null
  anchor_position: number | null
}

interface BoxBounds {
  left: number
  top: number
  right: number
  bottom: number
}

interface GaussianParams {
  mean: number
  std: number
}

interface ModelParams {
  model_version: string
  n_training_samples: number
  prior_in: number
  prior_out: number
  in_features: GaussianParams[] // 9 features
  out_features: GaussianParams[] // 9 features
}

interface ModelRow {
  model_version: string
  n_training_samples: number
  prior_in: number
  prior_out: number
  in_vertical_alignment_mean: number
  in_vertical_alignment_std: number
  in_height_similarity_mean: number
  in_height_similarity_std: number
  in_anchor_distance_mean: number
  in_anchor_distance_std: number
  in_crop_overlap_mean: number
  in_crop_overlap_std: number
  in_aspect_ratio_mean: number
  in_aspect_ratio_std: number
  in_normalized_y_mean: number
  in_normalized_y_std: number
  in_normalized_area_mean: number
  in_normalized_area_std: number
  in_user_annotated_in_mean: number
  in_user_annotated_in_std: number
  in_user_annotated_out_mean: number
  in_user_annotated_out_std: number
  out_vertical_alignment_mean: number
  out_vertical_alignment_std: number
  out_height_similarity_mean: number
  out_height_similarity_std: number
  out_anchor_distance_mean: number
  out_anchor_distance_std: number
  out_crop_overlap_mean: number
  out_crop_overlap_std: number
  out_aspect_ratio_mean: number
  out_aspect_ratio_std: number
  out_normalized_y_mean: number
  out_normalized_y_std: number
  out_normalized_area_mean: number
  out_normalized_area_std: number
  out_user_annotated_in_mean: number
  out_user_annotated_in_std: number
  out_user_annotated_out_mean: number
  out_user_annotated_out_std: number
}

/**
 * Extract 9 features from a box based on local clustering with other boxes.
 *
 * All features are independent of pre-computed cluster parameters to avoid
 * circular dependencies. Uses k-nearest neighbors approach.
 *
 * Features 8-9 are user annotations as binary indicators:
 * - Feature 8: isUserAnnotatedIn (1.0 if user annotated as "in", 0.0 otherwise)
 * - Feature 9: isUserAnnotatedOut (1.0 if user annotated as "out", 0.0 otherwise)
 * Unannotated boxes have both features = 0.0
 */
function extractFeatures(
  box: BoxBounds,
  layout: VideoLayoutConfig,
  allBoxes: BoxBounds[],
  frameIndex: number,
  boxIndex: number,
  db: Database.Database | null
): number[] {
  const boxWidth = box.right - box.left
  const boxHeight = box.bottom - box.top
  const boxCenterX = (box.left + box.right) / 2
  const boxCenterY = (box.top + box.bottom) / 2
  const boxArea = boxWidth * boxHeight
  const frameArea = layout.frame_width * layout.frame_height

  // K-nearest neighbors: use ceiling of 20% of total boxes, minimum 5
  const k = Math.max(5, Math.ceil(allBoxes.length * 0.2))

  // Filter out the current box from allBoxes
  const otherBoxes = allBoxes.filter(
    b =>
      !(
        b.left === box.left &&
        b.top === box.top &&
        b.right === box.right &&
        b.bottom === box.bottom
      )
  )

  // Feature 1a: Top edge vertical alignment
  // Among k boxes with nearest top positions, measure alignment variance
  let topAlignmentScore = 0.0
  if (otherBoxes.length > 0) {
    const sortedByTop = otherBoxes
      .map(b => ({ box: b, distance: Math.abs(b.top - box.top) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.min(k, otherBoxes.length))

    if (sortedByTop.length > 1) {
      const topPositions = sortedByTop.map(item => item.box.top)
      const mean = topPositions.reduce((sum, val) => sum + val, 0) / topPositions.length
      const variance =
        topPositions.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / topPositions.length
      const std = Math.sqrt(variance)
      topAlignmentScore = std > 0 ? Math.abs(box.top - mean) / std : 0
    }
  }

  // Feature 1b: Bottom edge vertical alignment
  // Among k boxes with nearest bottom positions, measure alignment variance
  let bottomAlignmentScore = 0.0
  if (otherBoxes.length > 0) {
    const sortedByBottom = otherBoxes
      .map(b => ({ box: b, distance: Math.abs(b.bottom - box.bottom) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.min(k, otherBoxes.length))

    if (sortedByBottom.length > 1) {
      const bottomPositions = sortedByBottom.map(item => item.box.bottom)
      const mean = bottomPositions.reduce((sum, val) => sum + val, 0) / bottomPositions.length
      const variance =
        bottomPositions.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
        bottomPositions.length
      const std = Math.sqrt(variance)
      bottomAlignmentScore = std > 0 ? Math.abs(box.bottom - mean) / std : 0
    }
  }

  // Feature 2: Height similarity
  // Among k boxes with nearest bottom positions, measure height variance
  let heightSimilarityScore = 0.0
  if (otherBoxes.length > 0) {
    const sortedByBottom = otherBoxes
      .map(b => ({ box: b, distance: Math.abs(b.bottom - box.bottom) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.min(k, otherBoxes.length))

    if (sortedByBottom.length > 1) {
      const heights = sortedByBottom.map(item => item.box.bottom - item.box.top)
      const mean = heights.reduce((sum, val) => sum + val, 0) / heights.length
      const variance =
        heights.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / heights.length
      const std = Math.sqrt(variance)
      heightSimilarityScore = std > 0 ? Math.abs(boxHeight - mean) / std : 0
    }
  }

  // Feature 3: Horizontal clustering
  // Among k boxes nearest by weighted combination of vertical (bottom) and horizontal (center) distance,
  // measure horizontal center distance variance
  let horizontalClusteringScore = 0.0
  if (otherBoxes.length > 0) {
    const verticalWeight = 0.7 // Weight for vertical proximity
    const horizontalWeight = 0.3 // Weight for horizontal proximity

    const sortedByCombined = otherBoxes
      .map(b => {
        const bCenterX = (b.left + b.right) / 2
        const verticalDist = Math.abs(b.bottom - box.bottom)
        const horizontalDist = Math.abs(bCenterX - boxCenterX)
        const combinedDist = verticalWeight * verticalDist + horizontalWeight * horizontalDist
        return { box: b, distance: combinedDist, centerX: bCenterX }
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.min(k, otherBoxes.length))

    if (sortedByCombined.length > 1) {
      const centerXs = sortedByCombined.map(item => item.centerX)
      const mean = centerXs.reduce((sum, val) => sum + val, 0) / centerXs.length
      const variance =
        centerXs.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / centerXs.length
      const std = Math.sqrt(variance)
      horizontalClusteringScore = std > 0 ? Math.abs(boxCenterX - mean) / std : 0
    }
  }

  // Feature 4: Aspect ratio (unchanged)
  const aspectRatio = boxHeight > 0 ? boxWidth / boxHeight : 0.0

  // Feature 5: Normalized Y position (unchanged)
  const normalizedYPosition = layout.frame_height > 0 ? boxCenterY / layout.frame_height : 0.0

  // Feature 6: Normalized area (unchanged)
  const normalizedArea = frameArea > 0 ? boxArea / frameArea : 0.0

  // Feature 7 & 8: User annotations as binary indicators
  // We use TWO features instead of one to avoid the "neutral value" problem:
  // - With one feature (0.0=out, 0.5=unannotated, 1.0=in), the model never sees 0.5 during training
  //   (all boxes are annotated), causing numerical issues when predicting unannotated boxes
  // - With two binary features, unannotated boxes are (0,0) which the model learns during training
  //   from boxes of the opposite class (e.g., "in" boxes have isUserAnnotatedOut=0)
  let isUserAnnotatedIn = 0.0
  let isUserAnnotatedOut = 0.0

  if (db) {
    try {
      const annotation = db
        .prepare(
          `
        SELECT label
        FROM full_frame_box_labels
        WHERE annotation_source = 'full_frame'
          AND frame_index = ?
          AND box_index = ?
          AND label_source = 'user'
      `
        )
        .get(frameIndex, boxIndex) as { label: 'in' | 'out' } | undefined

      if (annotation) {
        if (annotation.label === 'in') {
          isUserAnnotatedIn = 1.0
        } else {
          isUserAnnotatedOut = 1.0
        }
      }
    } catch (error) {
      // If table doesn't exist or query fails, features remain 0.0
      console.warn('[extractFeatures] Failed to lookup user annotation:', error)
    }
  }

  return [
    topAlignmentScore,
    bottomAlignmentScore,
    heightSimilarityScore,
    horizontalClusteringScore,
    aspectRatio,
    normalizedYPosition,
    normalizedArea,
    isUserAnnotatedIn,
    isUserAnnotatedOut,
  ]
}

/**
 * Calculate Gaussian probability density function.
 */
function gaussianPDF(x: number, mean: number, std: number): number {
  if (std <= 0) {
    // Degenerate case
    return Math.abs(x - mean) < 1e-9 ? 1.0 : 1e-10
  }

  const variance = std ** 2
  const coefficient = 1.0 / Math.sqrt(2 * Math.PI * variance)
  const exponent = (-0.5 * (x - mean) ** 2) / variance

  return coefficient * Math.exp(exponent)
}

/**
 * Migrate box_classification_model schema to include user annotation columns if needed.
 */
function migrateModelSchema(db: Database.Database): void {
  try {
    // Check if new user_annotated columns exist
    db.prepare('SELECT in_user_annotated_in_mean FROM box_classification_model WHERE id = 1').get()
    // If we get here, columns exist - no migration needed
    return
  } catch (error) {
    // Columns don't exist - need to migrate
    console.log('[migrateModelSchema] Adding user annotation columns to box_classification_model')

    try {
      // Add the 8 new columns (4 for in class, 4 for out class, 2 features each)
      db.prepare(
        'ALTER TABLE box_classification_model ADD COLUMN in_user_annotated_in_mean REAL'
      ).run()
      db.prepare(
        'ALTER TABLE box_classification_model ADD COLUMN in_user_annotated_in_std REAL'
      ).run()
      db.prepare(
        'ALTER TABLE box_classification_model ADD COLUMN in_user_annotated_out_mean REAL'
      ).run()
      db.prepare(
        'ALTER TABLE box_classification_model ADD COLUMN in_user_annotated_out_std REAL'
      ).run()
      db.prepare(
        'ALTER TABLE box_classification_model ADD COLUMN out_user_annotated_in_mean REAL'
      ).run()
      db.prepare(
        'ALTER TABLE box_classification_model ADD COLUMN out_user_annotated_in_std REAL'
      ).run()
      db.prepare(
        'ALTER TABLE box_classification_model ADD COLUMN out_user_annotated_out_mean REAL'
      ).run()
      db.prepare(
        'ALTER TABLE box_classification_model ADD COLUMN out_user_annotated_out_std REAL'
      ).run()

      // Update existing model with reasonable defaults for the new features
      // "in" boxes: isUserAnnotatedIn=1, isUserAnnotatedOut=0
      // "out" boxes: isUserAnnotatedIn=0, isUserAnnotatedOut=1
      db.prepare(
        `
        UPDATE box_classification_model
        SET
          in_user_annotated_in_mean = 1.0,
          in_user_annotated_in_std = 0.01,
          in_user_annotated_out_mean = 0.0,
          in_user_annotated_out_std = 0.01,
          out_user_annotated_in_mean = 0.0,
          out_user_annotated_in_std = 0.01,
          out_user_annotated_out_mean = 1.0,
          out_user_annotated_out_std = 0.01
        WHERE id = 1
      `
      ).run()

      console.log('[migrateModelSchema] Schema migration completed successfully')
    } catch (migrationError) {
      console.error('[migrateModelSchema] Migration failed:', migrationError)
      // If migration fails, we'll need to recreate the model
      throw new Error('Failed to migrate model schema - model will need to be retrained')
    }
  }
}

/**
 * Load model parameters from database.
 *
 * Accepts both seed model (n_training_samples = 0) and trained models (n_training_samples >= 10).
 * The seed model provides reasonable starting predictions before user annotations are available.
 */
function loadModelFromDB(db: Database.Database): ModelParams | null {
  // Migrate schema if needed
  migrateModelSchema(db)
  const row = db.prepare('SELECT * FROM box_classification_model WHERE id = 1').get() as
    | ModelRow
    | undefined

  if (!row) {
    return null
  }

  // Accept seed model (0 samples) or trained model (10+ samples)
  // Reject models with 1-9 samples (insufficient for meaningful statistics)
  if (row.n_training_samples > 0 && row.n_training_samples < 10) {
    console.warn(
      `[loadModelFromDB] Model has insufficient samples (${row.n_training_samples}), falling back to heuristics`
    )
    return null
  }

  // Parse model parameters from database row
  const inFeatures: GaussianParams[] = [
    { mean: row.in_vertical_alignment_mean, std: row.in_vertical_alignment_std },
    { mean: row.in_height_similarity_mean, std: row.in_height_similarity_std },
    { mean: row.in_anchor_distance_mean, std: row.in_anchor_distance_std },
    { mean: row.in_crop_overlap_mean, std: row.in_crop_overlap_std },
    { mean: row.in_aspect_ratio_mean, std: row.in_aspect_ratio_std },
    { mean: row.in_normalized_y_mean, std: row.in_normalized_y_std },
    { mean: row.in_normalized_area_mean, std: row.in_normalized_area_std },
    { mean: row.in_user_annotated_in_mean, std: row.in_user_annotated_in_std },
    { mean: row.in_user_annotated_out_mean, std: row.in_user_annotated_out_std },
  ]

  const outFeatures: GaussianParams[] = [
    { mean: row.out_vertical_alignment_mean, std: row.out_vertical_alignment_std },
    { mean: row.out_height_similarity_mean, std: row.out_height_similarity_std },
    { mean: row.out_anchor_distance_mean, std: row.out_anchor_distance_std },
    { mean: row.out_crop_overlap_mean, std: row.out_crop_overlap_std },
    { mean: row.out_aspect_ratio_mean, std: row.out_aspect_ratio_std },
    { mean: row.out_normalized_y_mean, std: row.out_normalized_y_std },
    { mean: row.out_normalized_area_mean, std: row.out_normalized_area_std },
    { mean: row.out_user_annotated_in_mean, std: row.out_user_annotated_in_std },
    { mean: row.out_user_annotated_out_mean, std: row.out_user_annotated_out_std },
  ]

  return {
    model_version: row.model_version,
    n_training_samples: row.n_training_samples,
    prior_in: row.prior_in,
    prior_out: row.prior_out,
    in_features: inFeatures,
    out_features: outFeatures,
  }
}

/**
 * Predict using Bayesian model.
 */
function predictBayesian(
  box: BoxBounds,
  layout: VideoLayoutConfig,
  model: ModelParams,
  allBoxes: BoxBounds[],
  frameIndex: number,
  boxIndex: number,
  db: Database.Database
): { label: 'in' | 'out'; confidence: number } {
  const features = extractFeatures(box, layout, allBoxes, frameIndex, boxIndex, db)

  // Calculate log-likelihoods using log-space to prevent numerical underflow
  //
  // PROBLEM: Naive Bayes multiplies probabilities for each feature:
  //   P(features|class) = P(f1|class) × P(f2|class) × ... × P(f9|class)
  //
  // With 9 features, each having Gaussian PDF values often < 0.01, the product can underflow to 0.
  // Example: 0.01^9 = 1e-18, which underflows to 0 in floating point.
  //
  // When a single feature has an extreme value (e.g., topAlignment=177 vs mean=0.5),
  // its Gaussian PDF ≈ 0, causing the entire likelihood to become 0 for both classes.
  // This leads to the degenerate case where total = posteriorIn + posteriorOut = 0.
  //
  // SOLUTION: Use log-space arithmetic
  //   log(P(features|class)) = log(P(f1|class)) + log(P(f2|class)) + ... + log(P(f9|class))
  //
  // Benefits:
  //   - Product becomes sum (numerically stable)
  //   - Can represent very small probabilities (log(1e-100) = -230, no underflow)
  //   - Convert back to probability space only at the end
  //
  // See: https://en.wikipedia.org/wiki/Log_probability
  let logLikelihoodIn = 0.0
  let logLikelihoodOut = 0.0

  for (let i = 0; i < 9; i++) {
    const pdfIn = gaussianPDF(features[i]!, model.in_features[i]!.mean, model.in_features[i]!.std)
    const pdfOut = gaussianPDF(
      features[i]!,
      model.out_features[i]!.mean,
      model.out_features[i]!.std
    )

    // Add to log-likelihood (log of product is sum of logs)
    // Use Math.max to avoid log(0) = -Infinity
    logLikelihoodIn += Math.log(Math.max(pdfIn, 1e-300))
    logLikelihoodOut += Math.log(Math.max(pdfOut, 1e-300))
  }

  // Apply Bayes' theorem in log-space: log(P(class|features)) = log(P(features|class)) + log(P(class))
  const logPosteriorIn = logLikelihoodIn + Math.log(model.prior_in)
  const logPosteriorOut = logLikelihoodOut + Math.log(model.prior_out)

  // Convert back from log-space for final probabilities using the log-sum-exp trick
  //
  // PROBLEM: Direct conversion can overflow/underflow:
  //   posteriorIn = exp(logPosteriorIn)  // Can overflow if logPosteriorIn is large
  //   total = posteriorIn + posteriorOut // Can be Infinity or NaN
  //
  // SOLUTION: Log-sum-exp trick - factor out the maximum before exponentiating:
  //   max = max(logPosteriorIn, logPosteriorOut)
  //   posteriorIn = exp(logPosteriorIn - max)
  //   posteriorOut = exp(logPosteriorOut - max)
  //   total = posteriorIn + posteriorOut
  //
  // This ensures that the largest exponent is always 0, preventing overflow.
  // The max term cancels out when computing probIn = posteriorIn / total.
  //
  // See: https://en.wikipedia.org/wiki/LogSumExp
  const maxLogPosterior = Math.max(logPosteriorIn, logPosteriorOut)
  const posteriorIn = Math.exp(logPosteriorIn - maxLogPosterior)
  const posteriorOut = Math.exp(logPosteriorOut - maxLogPosterior)
  const total = posteriorIn + posteriorOut

  if (total === 0 || !isFinite(total)) {
    // Degenerate case (shouldn't happen with log-space, but handle it just in case)
    return { label: 'in', confidence: 0.5 }
  }

  const probIn = posteriorIn / total
  const probOut = posteriorOut / total

  return probIn > probOut
    ? { label: 'in', confidence: probIn }
    : { label: 'out', confidence: probOut }
}

/**
 * Predict using heuristics (fallback when no trained model available).
 *
 * Universal heuristics based on:
 * - Vertical position (captions typically in bottom portion of frame)
 * - Box height (relative to frame and consistency with neighbors)
 * - Horizontal neighbor distance (caption characters cluster horizontally)
 *
 * Note: This signature will need to be updated to accept allBoxesInFrame
 * when we implement the full clustering-based heuristics.
 */
function predictWithHeuristics(
  boxBounds: BoxBounds,
  layoutConfig: VideoLayoutConfig
): { label: 'in' | 'out'; confidence: number } {
  const frameHeight = layoutConfig.frame_height
  const boxCenterY = (boxBounds.top + boxBounds.bottom) / 2
  const boxHeight = boxBounds.bottom - boxBounds.top

  // Expected caption characteristics (initial guesses, tune on dataset later)
  const EXPECTED_CAPTION_Y = 0.75 // 75% from top (bottom quarter of frame)
  const EXPECTED_CAPTION_HEIGHT_RATIO = 0.05 // 5% of frame height

  // Score 1: Vertical position penalty
  const normalizedY = boxCenterY / frameHeight
  const yDeviation = Math.abs(normalizedY - EXPECTED_CAPTION_Y)
  const yScore = Math.max(0, 1.0 - yDeviation * 2.5) // Full penalty at 40% deviation

  // Score 2: Box height penalty
  const heightRatio = boxHeight / frameHeight
  const heightDeviation = Math.abs(heightRatio - EXPECTED_CAPTION_HEIGHT_RATIO)
  const heightScore = Math.max(0, 1.0 - heightDeviation / EXPECTED_CAPTION_HEIGHT_RATIO)

  // Combine scores (weights: tune on dataset later)
  const captionScore =
    yScore * 0.6 + // Vertical position is strong signal
    heightScore * 0.4 // Height is secondary signal

  // Convert to label and confidence
  if (captionScore >= 0.6) {
    return { label: 'in', confidence: 0.5 + captionScore * 0.3 } // 0.68 - 0.80
  } else {
    return { label: 'out', confidence: 0.5 + (1 - captionScore) * 0.3 } // 0.62 - 0.80
  }
}

/**
 * TODO: Enhanced heuristics with clustering (not yet implemented)
 *
 * This will replace predictWithHeuristics once we add support for passing
 * all boxes in the frame. Will include:
 * - Height consistency among vertically-aligned boxes
 * - Horizontal neighbor distance (1-2x box width)
 * - Cluster size (5+ boxes at similar vertical position)
 */
// function predictWithClusteringHeuristics(
//   boxBounds: BoxBounds,
//   layoutConfig: VideoLayoutConfig,
//   allBoxesInFrame: BoxBounds[]
// ): { label: 'in' | 'out'; confidence: number } {
//   // Implementation with full clustering logic
// }

/**
 * Predict label and confidence for an OCR box.
 *
 * Uses trained Bayesian model if available (requires db parameter),
 * otherwise falls back to heuristics.
 *
 * Returns:
 * - label: 'in' (caption) or 'out' (noise)
 * - confidence: Posterior probability [0-1] if using Bayesian model,
 *               or heuristic confidence [0.5-0.95] if using fallback
 */
export function predictBoxLabel(
  boxBounds: BoxBounds,
  layoutConfig: VideoLayoutConfig,
  allBoxes: BoxBounds[],
  frameIndex: number,
  boxIndex: number,
  db?: Database.Database
): { label: 'in' | 'out'; confidence: number } {
  // Try to use Bayesian model if database provided
  if (db) {
    try {
      const model = loadModelFromDB(db)
      if (model) {
        return predictBayesian(boxBounds, layoutConfig, model, allBoxes, frameIndex, boxIndex, db)
      }
    } catch (error) {
      // Log error and fall back to heuristics
      console.error('Error loading/using Bayesian model:', error)
    }
  }

  // Fall back to heuristics
  return predictWithHeuristics(boxBounds, layoutConfig)
}

/**
 * Initialize seed model with typical caption layout parameters.
 *
 * This provides reasonable starting predictions before user annotations are available.
 * Based on common caption characteristics:
 * - Captions: well-aligned, similar heights, horizontally clustered, wide aspect ratio,
 *   bottom of frame, small area
 * - Noise: less aligned, varied heights/positions, scattered, varied aspect ratios
 *
 * @param db Database connection
 */
export function initializeSeedModel(db: Database.Database): void {
  // Migrate schema if needed (add user_annotation columns)
  migrateModelSchema(db)

  // Check if model already exists
  const existing = db.prepare('SELECT id FROM box_classification_model WHERE id = 1').get()
  if (existing) {
    console.log('[initializeSeedModel] Model already exists, skipping seed initialization')
    return
  }

  console.log('[initializeSeedModel] Initializing seed model with typical caption parameters')

  // Seed parameters based on typical caption characteristics
  // Features in order: [topAlignment, bottomAlignment, heightSimilarity, horizontalClustering, aspectRatio, normalizedY, normalizedArea, isUserAnnotatedIn, isUserAnnotatedOut]

  // "in" (caption) boxes: well-aligned, similar, clustered, wide, bottom of frame, small
  const inParams = [
    { mean: 0.5, std: 0.5 }, // topAlignment: low = well aligned
    { mean: 0.5, std: 0.5 }, // bottomAlignment: low = well aligned
    { mean: 0.5, std: 0.5 }, // heightSimilarity: low = similar heights
    { mean: 0.5, std: 0.5 }, // horizontalClustering: low = clustered
    { mean: 4.0, std: 2.0 }, // aspectRatio: wide boxes (3-5x wider than tall)
    { mean: 0.8, std: 0.1 }, // normalizedY: bottom 20% of frame (0.75-0.85)
    { mean: 0.02, std: 0.015 }, // normalizedArea: 1-3% of frame area
    { mean: 0.5, std: 0.5 }, // isUserAnnotatedIn: neutral (no annotations yet)
    { mean: 0.5, std: 0.5 }, // isUserAnnotatedOut: neutral (no annotations yet)
  ]

  // "out" (noise) boxes: less aligned, varied, scattered, more varied
  const outParams = [
    { mean: 1.5, std: 1.0 }, // topAlignment: higher = less aligned
    { mean: 1.5, std: 1.0 }, // bottomAlignment: higher = less aligned
    { mean: 1.5, std: 1.0 }, // heightSimilarity: higher = varied heights
    { mean: 1.5, std: 1.0 }, // horizontalClustering: higher = scattered
    { mean: 2.0, std: 3.0 }, // aspectRatio: more varied
    { mean: 0.5, std: 0.3 }, // normalizedY: more varied vertical position
    { mean: 0.03, std: 0.03 }, // normalizedArea: more varied area
    { mean: 0.5, std: 0.5 }, // isUserAnnotatedIn: neutral (no annotations yet)
    { mean: 0.5, std: 0.5 }, // isUserAnnotatedOut: neutral (no annotations yet)
  ]

  // Start with balanced priors (50/50)
  const priorIn = 0.5
  const priorOut = 0.5

  // Store seed model in database
  db.prepare(
    `
    INSERT INTO box_classification_model (
      id,
      model_version,
      trained_at,
      n_training_samples,
      prior_in,
      prior_out,
      in_vertical_alignment_mean, in_vertical_alignment_std,
      in_height_similarity_mean, in_height_similarity_std,
      in_anchor_distance_mean, in_anchor_distance_std,
      in_crop_overlap_mean, in_crop_overlap_std,
      in_aspect_ratio_mean, in_aspect_ratio_std,
      in_normalized_y_mean, in_normalized_y_std,
      in_normalized_area_mean, in_normalized_area_std,
      in_user_annotated_in_mean, in_user_annotated_in_std,
      in_user_annotated_out_mean, in_user_annotated_out_std,
      out_vertical_alignment_mean, out_vertical_alignment_std,
      out_height_similarity_mean, out_height_similarity_std,
      out_anchor_distance_mean, out_anchor_distance_std,
      out_crop_overlap_mean, out_crop_overlap_std,
      out_aspect_ratio_mean, out_aspect_ratio_std,
      out_normalized_y_mean, out_normalized_y_std,
      out_normalized_area_mean, out_normalized_area_std,
      out_user_annotated_in_mean, out_user_annotated_in_std,
      out_user_annotated_out_mean, out_user_annotated_out_std
    ) VALUES (
      1,
      'seed_v1',
      datetime('now'),
      0,
      ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `
  ).run(
    priorIn,
    priorOut,
    inParams[0]!.mean,
    inParams[0]!.std,
    inParams[1]!.mean,
    inParams[1]!.std,
    inParams[2]!.mean,
    inParams[2]!.std,
    inParams[3]!.mean,
    inParams[3]!.std,
    inParams[4]!.mean,
    inParams[4]!.std,
    inParams[5]!.mean,
    inParams[5]!.std,
    inParams[6]!.mean,
    inParams[6]!.std,
    inParams[7]!.mean,
    inParams[7]!.std,
    inParams[8]!.mean,
    inParams[8]!.std,
    outParams[0]!.mean,
    outParams[0]!.std,
    outParams[1]!.mean,
    outParams[1]!.std,
    outParams[2]!.mean,
    outParams[2]!.std,
    outParams[3]!.mean,
    outParams[3]!.std,
    outParams[4]!.mean,
    outParams[4]!.std,
    outParams[5]!.mean,
    outParams[5]!.std,
    outParams[6]!.mean,
    outParams[6]!.std,
    outParams[7]!.mean,
    outParams[7]!.std,
    outParams[8]!.mean,
    outParams[8]!.std
  )

  console.log('[initializeSeedModel] Seed model initialized successfully')
}

/**
 * Train Bayesian model using user annotations.
 *
 * Fetches all user-labeled boxes, extracts features, calculates Gaussian
 * parameters for each feature per class, and stores in box_classification_model table.
 *
 * Replaces the seed model once 10+ annotations are available.
 *
 * @param db Database connection
 * @param layoutConfig Video layout configuration
 * @returns Number of training samples used, or null if insufficient data
 */
export function trainModel(db: Database.Database, layoutConfig: VideoLayoutConfig): number | null {
  // Migrate schema if needed (add user_annotation columns)
  migrateModelSchema(db)

  // Fetch all user annotations
  const annotations = db
    .prepare(
      `
    SELECT
      label,
      box_left,
      box_top,
      box_right,
      box_bottom,
      frame_index,
      box_index
    FROM full_frame_box_labels
    WHERE label_source = 'user'
    ORDER BY frame_index
  `
    )
    .all() as Array<{
    label: 'in' | 'out'
    box_left: number
    box_top: number
    box_right: number
    box_bottom: number
    frame_index: number
    box_index: number
  }>

  if (annotations.length < 10) {
    console.log(`[trainModel] Insufficient training data: ${annotations.length} samples (need 10+)`)

    // If annotations were cleared, reset to seed model
    const existingModel = db
      .prepare('SELECT n_training_samples FROM box_classification_model WHERE id = 1')
      .get() as { n_training_samples: number } | undefined

    if (existingModel && existingModel.n_training_samples >= 10) {
      console.log(`[trainModel] Resetting to seed model (annotations cleared)`)
      // Re-initialize seed model to replace trained model
      db.prepare('DELETE FROM box_classification_model WHERE id = 1').run()
      // Seed model will be re-initialized on next prediction calculation
    }

    return null
  }

  console.log(`[trainModel] Training with ${annotations.length} user annotations`)

  // Group annotations by frame to get all boxes for feature extraction
  const annotationsByFrame = new Map<number, typeof annotations>()
  for (const ann of annotations) {
    if (!annotationsByFrame.has(ann.frame_index)) {
      annotationsByFrame.set(ann.frame_index, [])
    }
    annotationsByFrame.get(ann.frame_index)!.push(ann)
  }

  // Get all OCR boxes for each frame (needed for feature extraction context)
  const frameBoxesCache = new Map<number, BoxBounds[]>()

  // Extract features for each annotation
  const inFeatures: number[][] = []
  const outFeatures: number[][] = []

  for (const ann of annotations) {
    // Get all boxes in this frame for context
    if (!frameBoxesCache.has(ann.frame_index)) {
      const boxes = db
        .prepare(
          `
        SELECT x, y, width, height
        FROM full_frame_ocr
        WHERE frame_index = ?
        ORDER BY box_index
      `
        )
        .all(ann.frame_index) as Array<{
        x: number
        y: number
        width: number
        height: number
      }>

      const boxBounds = boxes.map(b => {
        const left = Math.floor(b.x * layoutConfig.frame_width)
        const bottom = Math.floor((1 - b.y) * layoutConfig.frame_height)
        const boxWidth = Math.floor(b.width * layoutConfig.frame_width)
        const boxHeight = Math.floor(b.height * layoutConfig.frame_height)
        const top = bottom - boxHeight
        const right = left + boxWidth
        return { left, top, right, bottom }
      })

      frameBoxesCache.set(ann.frame_index, boxBounds)
    }

    const allBoxes = frameBoxesCache.get(ann.frame_index)!
    const boxBounds: BoxBounds = {
      left: ann.box_left,
      top: ann.box_top,
      right: ann.box_right,
      bottom: ann.box_bottom,
    }

    const features = extractFeatures(
      boxBounds,
      layoutConfig,
      allBoxes,
      ann.frame_index,
      ann.box_index,
      db
    )

    if (ann.label === 'in') {
      inFeatures.push(features)
    } else {
      outFeatures.push(features)
    }
  }

  // Need at least 2 samples per class for meaningful statistics
  if (inFeatures.length < 2 || outFeatures.length < 2) {
    console.log(
      `[trainModel] Insufficient samples per class: in=${inFeatures.length}, out=${outFeatures.length}`
    )
    return null
  }

  // Calculate Gaussian parameters for each feature
  const calculateGaussian = (values: number[]): { mean: number; std: number } => {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
    const std = Math.sqrt(variance)
    // Use minimum std of 0.01 to avoid numerical precision issues
    // For user_annotation feature with all 0s or all 1s, this allows ~68% probability within ±0.01
    return { mean, std: Math.max(std, 0.01) }
  }

  // Extract each feature column and calculate parameters
  const inParams: Array<{ mean: number; std: number }> = []
  const outParams: Array<{ mean: number; std: number }> = []

  for (let i = 0; i < 9; i++) {
    const inFeatureValues = inFeatures.map(f => f[i]!)
    const outFeatureValues = outFeatures.map(f => f[i]!)

    inParams.push(calculateGaussian(inFeatureValues))
    outParams.push(calculateGaussian(outFeatureValues))
  }

  // Calculate priors
  const total = annotations.length
  const priorIn = inFeatures.length / total
  const priorOut = outFeatures.length / total

  // Store model in database
  db.prepare(
    `
    INSERT OR REPLACE INTO box_classification_model (
      id,
      model_version,
      trained_at,
      n_training_samples,
      prior_in,
      prior_out,
      in_vertical_alignment_mean, in_vertical_alignment_std,
      in_height_similarity_mean, in_height_similarity_std,
      in_anchor_distance_mean, in_anchor_distance_std,
      in_crop_overlap_mean, in_crop_overlap_std,
      in_aspect_ratio_mean, in_aspect_ratio_std,
      in_normalized_y_mean, in_normalized_y_std,
      in_normalized_area_mean, in_normalized_area_std,
      in_user_annotated_in_mean, in_user_annotated_in_std,
      in_user_annotated_out_mean, in_user_annotated_out_std,
      out_vertical_alignment_mean, out_vertical_alignment_std,
      out_height_similarity_mean, out_height_similarity_std,
      out_anchor_distance_mean, out_anchor_distance_std,
      out_crop_overlap_mean, out_crop_overlap_std,
      out_aspect_ratio_mean, out_aspect_ratio_std,
      out_normalized_y_mean, out_normalized_y_std,
      out_normalized_area_mean, out_normalized_area_std,
      out_user_annotated_in_mean, out_user_annotated_in_std,
      out_user_annotated_out_mean, out_user_annotated_out_std
    ) VALUES (
      1,
      'naive_bayes_v1',
      datetime('now'),
      ?,
      ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `
  ).run(
    total,
    priorIn,
    priorOut,
    inParams[0]!.mean,
    inParams[0]!.std,
    inParams[1]!.mean,
    inParams[1]!.std,
    inParams[2]!.mean,
    inParams[2]!.std,
    inParams[3]!.mean,
    inParams[3]!.std,
    inParams[4]!.mean,
    inParams[4]!.std,
    inParams[5]!.mean,
    inParams[5]!.std,
    inParams[6]!.mean,
    inParams[6]!.std,
    inParams[7]!.mean,
    inParams[7]!.std,
    inParams[8]!.mean,
    inParams[8]!.std,
    outParams[0]!.mean,
    outParams[0]!.std,
    outParams[1]!.mean,
    outParams[1]!.std,
    outParams[2]!.mean,
    outParams[2]!.std,
    outParams[3]!.mean,
    outParams[3]!.std,
    outParams[4]!.mean,
    outParams[4]!.std,
    outParams[5]!.mean,
    outParams[5]!.std,
    outParams[6]!.mean,
    outParams[6]!.std,
    outParams[7]!.mean,
    outParams[7]!.std,
    outParams[8]!.mean,
    outParams[8]!.std
  )

  console.log(
    `[trainModel] Model trained successfully: ${inFeatures.length} 'in', ${outFeatures.length} 'out'`
  )

  return total
}
