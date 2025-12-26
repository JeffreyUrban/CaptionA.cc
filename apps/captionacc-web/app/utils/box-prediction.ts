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
  in_features: GaussianParams[]  // 7 features
  out_features: GaussianParams[]  // 7 features
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
}

/**
 * Extract 7 features from a box given layout parameters.
 *
 * Features match the Python implementation in box_classification package.
 */
function extractFeatures(box: BoxBounds, layout: VideoLayoutConfig): number[] {
  const boxWidth = box.right - box.left
  const boxHeight = box.bottom - box.top
  const boxCenterX = (box.left + box.right) / 2
  const boxCenterY = (box.top + box.bottom) / 2
  const boxArea = boxWidth * boxHeight
  const frameArea = layout.frame_width * layout.frame_height

  // Feature 1: Vertical alignment Z-score
  let verticalAlignmentZScore = 0.0
  if (layout.vertical_position !== null && layout.vertical_std !== null) {
    const verticalDistance = Math.abs(boxCenterY - layout.vertical_position)
    const verticalStd = layout.vertical_std > 0 ? layout.vertical_std : 1.0
    verticalAlignmentZScore = verticalDistance / verticalStd
  }

  // Feature 2: Height similarity Z-score
  let heightSimilarityZScore = 0.0
  if (layout.box_height !== null && layout.box_height_std !== null) {
    const heightDifference = Math.abs(boxHeight - layout.box_height)
    const heightStd = layout.box_height_std > 0 ? layout.box_height_std : 1.0
    heightSimilarityZScore = heightDifference / heightStd
  }

  // Feature 3: Anchor distance
  let anchorDistance = 0.0
  if (layout.anchor_type && layout.anchor_position !== null) {
    if (layout.anchor_type === 'left') {
      anchorDistance = Math.abs(box.left - layout.anchor_position)
    } else if (layout.anchor_type === 'right') {
      anchorDistance = Math.abs(box.right - layout.anchor_position)
    } else {  // 'center'
      anchorDistance = Math.abs(boxCenterX - layout.anchor_position)
    }
  }

  // Feature 4: Crop overlap
  const overlapLeft = Math.max(box.left, layout.crop_left)
  const overlapTop = Math.max(box.top, layout.crop_top)
  const overlapRight = Math.min(box.right, layout.crop_right)
  const overlapBottom = Math.min(box.bottom, layout.crop_bottom)

  let cropOverlap = 0.0
  if (overlapRight > overlapLeft && overlapBottom > overlapTop) {
    const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop)
    cropOverlap = boxArea > 0 ? overlapArea / boxArea : 0.0
  }

  // Feature 5: Aspect ratio
  const aspectRatio = boxHeight > 0 ? boxWidth / boxHeight : 0.0

  // Feature 6: Normalized Y position
  const normalizedYPosition = layout.frame_height > 0 ? boxCenterY / layout.frame_height : 0.0

  // Feature 7: Normalized area
  const normalizedArea = frameArea > 0 ? boxArea / frameArea : 0.0

  return [
    verticalAlignmentZScore,
    heightSimilarityZScore,
    anchorDistance,
    cropOverlap,
    aspectRatio,
    normalizedYPosition,
    normalizedArea,
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
  const exponent = -0.5 * ((x - mean) ** 2) / variance

  return coefficient * Math.exp(exponent)
}

/**
 * Load model parameters from database.
 */
function loadModelFromDB(db: Database): ModelParams | null {
  const row = db.prepare('SELECT * FROM box_classification_model WHERE id = 1').get() as ModelRow | undefined

  if (!row || row.n_training_samples < 10) {
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
  ]

  const outFeatures: GaussianParams[] = [
    { mean: row.out_vertical_alignment_mean, std: row.out_vertical_alignment_std },
    { mean: row.out_height_similarity_mean, std: row.out_height_similarity_std },
    { mean: row.out_anchor_distance_mean, std: row.out_anchor_distance_std },
    { mean: row.out_crop_overlap_mean, std: row.out_crop_overlap_std },
    { mean: row.out_aspect_ratio_mean, std: row.out_aspect_ratio_std },
    { mean: row.out_normalized_y_mean, std: row.out_normalized_y_std },
    { mean: row.out_normalized_area_mean, std: row.out_normalized_area_std },
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
  model: ModelParams
): { label: 'in' | 'out'; confidence: number } {
  const features = extractFeatures(box, layout)

  // Calculate likelihoods: P(features|class) = ∏ Gaussian_PDF(feature_i)
  let likelihoodIn = 1.0
  let likelihoodOut = 1.0

  for (let i = 0; i < 7; i++) {
    likelihoodIn *= gaussianPDF(features[i], model.in_features[i].mean, model.in_features[i].std)
    likelihoodOut *= gaussianPDF(features[i], model.out_features[i].mean, model.out_features[i].std)
  }

  // Apply Bayes' theorem: P(class|features) ∝ P(features|class) * P(class)
  const posteriorIn = likelihoodIn * model.prior_in
  const posteriorOut = likelihoodOut * model.prior_out
  const total = posteriorIn + posteriorOut

  if (total === 0) {
    // Degenerate case
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
  const EXPECTED_CAPTION_Y = 0.75  // 75% from top (bottom quarter of frame)
  const EXPECTED_CAPTION_HEIGHT_RATIO = 0.05  // 5% of frame height

  // Score 1: Vertical position penalty
  const normalizedY = boxCenterY / frameHeight
  const yDeviation = Math.abs(normalizedY - EXPECTED_CAPTION_Y)
  const yScore = Math.max(0, 1.0 - yDeviation * 2.5)  // Full penalty at 40% deviation

  // Score 2: Box height penalty
  const heightRatio = boxHeight / frameHeight
  const heightDeviation = Math.abs(heightRatio - EXPECTED_CAPTION_HEIGHT_RATIO)
  const heightScore = Math.max(0, 1.0 - heightDeviation / EXPECTED_CAPTION_HEIGHT_RATIO)

  // Combine scores (weights: tune on dataset later)
  const captionScore = (
    yScore * 0.6 +        // Vertical position is strong signal
    heightScore * 0.4     // Height is secondary signal
  )

  // Convert to label and confidence
  if (captionScore >= 0.6) {
    return { label: 'in', confidence: 0.5 + captionScore * 0.3 }  // 0.68 - 0.80
  } else {
    return { label: 'out', confidence: 0.5 + (1 - captionScore) * 0.3 }  // 0.62 - 0.80
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
  db?: Database
): { label: 'in' | 'out'; confidence: number } {
  // Try to use Bayesian model if database provided
  if (db) {
    try {
      const model = loadModelFromDB(db)
      if (model) {
        return predictBayesian(boxBounds, layoutConfig, model)
      }
    } catch (error) {
      // Log error and fall back to heuristics
      console.error('Error loading/using Bayesian model:', error)
    }
  }

  // Fall back to heuristics
  return predictWithHeuristics(boxBounds, layoutConfig)
}
