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
 * Extract 7 features from a box based on local clustering with other boxes.
 *
 * All features are independent of pre-computed cluster parameters to avoid
 * circular dependencies. Uses k-nearest neighbors approach.
 */
function extractFeatures(box: BoxBounds, layout: VideoLayoutConfig, allBoxes: BoxBounds[]): number[] {
  const boxWidth = box.right - box.left
  const boxHeight = box.bottom - box.top
  const boxCenterX = (box.left + box.right) / 2
  const boxCenterY = (box.top + box.bottom) / 2
  const boxArea = boxWidth * boxHeight
  const frameArea = layout.frame_width * layout.frame_height

  // K-nearest neighbors: use ceiling of 20% of total boxes, minimum 5
  const k = Math.max(5, Math.ceil(allBoxes.length * 0.2))

  // Filter out the current box from allBoxes
  const otherBoxes = allBoxes.filter(b =>
    !(b.left === box.left && b.top === box.top && b.right === box.right && b.bottom === box.bottom)
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
      const variance = topPositions.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / topPositions.length
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
      const variance = bottomPositions.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / bottomPositions.length
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
      const variance = heights.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / heights.length
      const std = Math.sqrt(variance)
      heightSimilarityScore = std > 0 ? Math.abs(boxHeight - mean) / std : 0
    }
  }

  // Feature 3: Horizontal clustering
  // Among k boxes nearest by weighted combination of vertical (bottom) and horizontal (center) distance,
  // measure horizontal center distance variance
  let horizontalClusteringScore = 0.0
  if (otherBoxes.length > 0) {
    const verticalWeight = 0.7  // Weight for vertical proximity
    const horizontalWeight = 0.3  // Weight for horizontal proximity

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
      const variance = centerXs.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / centerXs.length
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

  return [
    topAlignmentScore,
    bottomAlignmentScore,
    heightSimilarityScore,
    horizontalClusteringScore,
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
 *
 * Accepts both seed model (n_training_samples = 0) and trained models (n_training_samples >= 10).
 * The seed model provides reasonable starting predictions before user annotations are available.
 */
function loadModelFromDB(db: Database.Database): ModelParams | null {
  const row = db.prepare('SELECT * FROM box_classification_model WHERE id = 1').get() as ModelRow | undefined

  if (!row) {
    return null
  }

  // Accept seed model (0 samples) or trained model (10+ samples)
  // Reject models with 1-9 samples (insufficient for meaningful statistics)
  if (row.n_training_samples > 0 && row.n_training_samples < 10) {
    console.warn(`[loadModelFromDB] Model has insufficient samples (${row.n_training_samples}), falling back to heuristics`)
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
  model: ModelParams,
  allBoxes: BoxBounds[]
): { label: 'in' | 'out'; confidence: number } {
  const features = extractFeatures(box, layout, allBoxes)

  // Calculate likelihoods: P(features|class) = ∏ Gaussian_PDF(feature_i)
  let likelihoodIn = 1.0
  let likelihoodOut = 1.0

  for (let i = 0; i < 7; i++) {
    likelihoodIn *= gaussianPDF(features[i]!, model.in_features[i]!.mean, model.in_features[i]!.std)
    likelihoodOut *= gaussianPDF(features[i]!, model.out_features[i]!.mean, model.out_features[i]!.std)
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
  allBoxes: BoxBounds[],
  db?: Database.Database
): { label: 'in' | 'out'; confidence: number } {
  // Try to use Bayesian model if database provided
  if (db) {
    try {
      const model = loadModelFromDB(db)
      if (model) {
        return predictBayesian(boxBounds, layoutConfig, model, allBoxes)
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
  // Check if model already exists
  const existing = db.prepare('SELECT id FROM box_classification_model WHERE id = 1').get()
  if (existing) {
    console.log('[initializeSeedModel] Model already exists, skipping seed initialization')
    return
  }

  console.log('[initializeSeedModel] Initializing seed model with typical caption parameters')

  // Seed parameters based on typical caption characteristics
  // Features in order: [topAlignment, bottomAlignment, heightSimilarity, horizontalClustering, aspectRatio, normalizedY, normalizedArea]

  // "in" (caption) boxes: well-aligned, similar, clustered, wide, bottom of frame, small
  const inParams = [
    { mean: 0.5, std: 0.5 },   // topAlignment: low = well aligned
    { mean: 0.5, std: 0.5 },   // bottomAlignment: low = well aligned
    { mean: 0.5, std: 0.5 },   // heightSimilarity: low = similar heights
    { mean: 0.5, std: 0.5 },   // horizontalClustering: low = clustered
    { mean: 4.0, std: 2.0 },   // aspectRatio: wide boxes (3-5x wider than tall)
    { mean: 0.8, std: 0.1 },   // normalizedY: bottom 20% of frame (0.75-0.85)
    { mean: 0.02, std: 0.015 } // normalizedArea: 1-3% of frame area
  ]

  // "out" (noise) boxes: less aligned, varied, scattered, more varied
  const outParams = [
    { mean: 1.5, std: 1.0 },   // topAlignment: higher = less aligned
    { mean: 1.5, std: 1.0 },   // bottomAlignment: higher = less aligned
    { mean: 1.5, std: 1.0 },   // heightSimilarity: higher = varied heights
    { mean: 1.5, std: 1.0 },   // horizontalClustering: higher = scattered
    { mean: 2.0, std: 3.0 },   // aspectRatio: more varied
    { mean: 0.5, std: 0.3 },   // normalizedY: more varied vertical position
    { mean: 0.03, std: 0.03 }  // normalizedArea: more varied area
  ]

  // Start with balanced priors (50/50)
  const priorIn = 0.5
  const priorOut = 0.5

  // Store seed model in database
  db.prepare(`
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
      out_vertical_alignment_mean, out_vertical_alignment_std,
      out_height_similarity_mean, out_height_similarity_std,
      out_anchor_distance_mean, out_anchor_distance_std,
      out_crop_overlap_mean, out_crop_overlap_std,
      out_aspect_ratio_mean, out_aspect_ratio_std,
      out_normalized_y_mean, out_normalized_y_std,
      out_normalized_area_mean, out_normalized_area_std
    ) VALUES (
      1,
      'seed_v1',
      datetime('now'),
      0,
      ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    priorIn, priorOut,
    inParams[0]!.mean, inParams[0]!.std,
    inParams[1]!.mean, inParams[1]!.std,
    inParams[2]!.mean, inParams[2]!.std,
    inParams[3]!.mean, inParams[3]!.std,
    inParams[4]!.mean, inParams[4]!.std,
    inParams[5]!.mean, inParams[5]!.std,
    inParams[6]!.mean, inParams[6]!.std,
    outParams[0]!.mean, outParams[0]!.std,
    outParams[1]!.mean, outParams[1]!.std,
    outParams[2]!.mean, outParams[2]!.std,
    outParams[3]!.mean, outParams[3]!.std,
    outParams[4]!.mean, outParams[4]!.std,
    outParams[5]!.mean, outParams[5]!.std,
    outParams[6]!.mean, outParams[6]!.std
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
  // Fetch all user annotations
  const annotations = db.prepare(`
    SELECT
      label,
      box_left,
      box_top,
      box_right,
      box_bottom,
      frame_index
    FROM full_frame_box_labels
    WHERE label_source = 'user'
    ORDER BY frame_index
  `).all() as Array<{
    label: 'in' | 'out'
    box_left: number
    box_top: number
    box_right: number
    box_bottom: number
    frame_index: number
  }>

  if (annotations.length < 10) {
    console.log(`[trainModel] Insufficient training data: ${annotations.length} samples (need 10+)`)

    // If annotations were cleared, reset to seed model
    const existingModel = db.prepare('SELECT n_training_samples FROM box_classification_model WHERE id = 1').get() as { n_training_samples: number } | undefined

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
      const boxes = db.prepare(`
        SELECT x, y, width, height
        FROM full_frame_ocr
        WHERE frame_index = ?
        ORDER BY box_index
      `).all(ann.frame_index) as Array<{
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
      bottom: ann.box_bottom
    }

    const features = extractFeatures(boxBounds, layoutConfig, allBoxes)

    if (ann.label === 'in') {
      inFeatures.push(features)
    } else {
      outFeatures.push(features)
    }
  }

  // Need at least 2 samples per class for meaningful statistics
  if (inFeatures.length < 2 || outFeatures.length < 2) {
    console.log(`[trainModel] Insufficient samples per class: in=${inFeatures.length}, out=${outFeatures.length}`)
    return null
  }

  // Calculate Gaussian parameters for each feature
  const calculateGaussian = (values: number[]): { mean: number; std: number } => {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
    const std = Math.sqrt(variance)
    return { mean, std: std > 0 ? std : 1e-6 }  // Avoid zero std
  }

  // Extract each feature column and calculate parameters
  const inParams: Array<{ mean: number; std: number }> = []
  const outParams: Array<{ mean: number; std: number }> = []

  for (let i = 0; i < 7; i++) {
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
  db.prepare(`
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
      out_vertical_alignment_mean, out_vertical_alignment_std,
      out_height_similarity_mean, out_height_similarity_std,
      out_anchor_distance_mean, out_anchor_distance_std,
      out_crop_overlap_mean, out_crop_overlap_std,
      out_aspect_ratio_mean, out_aspect_ratio_std,
      out_normalized_y_mean, out_normalized_y_std,
      out_normalized_area_mean, out_normalized_area_std
    ) VALUES (
      1,
      'naive_bayes_v1',
      datetime('now'),
      ?,
      ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    total,
    priorIn, priorOut,
    inParams[0]!.mean, inParams[0]!.std,
    inParams[1]!.mean, inParams[1]!.std,
    inParams[2]!.mean, inParams[2]!.std,
    inParams[3]!.mean, inParams[3]!.std,
    inParams[4]!.mean, inParams[4]!.std,
    inParams[5]!.mean, inParams[5]!.std,
    inParams[6]!.mean, inParams[6]!.std,
    outParams[0]!.mean, outParams[0]!.std,
    outParams[1]!.mean, outParams[1]!.std,
    outParams[2]!.mean, outParams[2]!.std,
    outParams[3]!.mean, outParams[3]!.std,
    outParams[4]!.mean, outParams[4]!.std,
    outParams[5]!.mean, outParams[5]!.std,
    outParams[6]!.mean, outParams[6]!.std
  )

  console.log(`[trainModel] Model trained successfully: ${inFeatures.length} 'in', ${outFeatures.length} 'out'`)

  return total
}
