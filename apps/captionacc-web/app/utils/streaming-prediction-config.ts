/**
 * Configuration for streaming prediction updates.
 *
 * All constants are global (not per-video) to avoid user configuration complexity.
 * Values chosen based on statistical principles and classification theory.
 */

/**
 * Configuration for adaptive recalculation strategy.
 *
 * Determines which boxes need recalculation and when to stop.
 */
export const ADAPTIVE_RECALC_CONFIG = {
  /**
   * Safety limit: maximum boxes to recalculate per annotation.
   * Prevents runaway recalculation on edge cases where most boxes are similar.
   */
  MAX_BOXES_PER_UPDATE: 2000,

  /**
   * Minimum change probability to consider recalculating.
   * Boxes below this threshold are skipped entirely (prediction unlikely to flip).
   *
   * Rationale: 5% represents low but non-negligible probability.
   * Below this, cost of recalculation outweighs expected benefit.
   */
  MIN_CHANGE_PROBABILITY: 0.05,

  /**
   * Target reversal rate - stop when rolling average drops below this.
   * If fewer than 2% of predictions are actually changing, remaining boxes unlikely to flip.
   *
   * Rationale: 2% balances thoroughness vs efficiency.
   * - Too low (e.g., 0.5%): Wastes computation on negligible improvements
   * - Too high (e.g., 10%): Stops too early, misses real changes
   */
  TARGET_REVERSAL_RATE: 0.02,

  /**
   * Window size for calculating rolling reversal rate.
   * Larger window = more stable estimate but slower to react.
   *
   * Rationale: 100 boxes provides good statistical power for 2% rate detection:
   * - Expected reversals in window: 2
   * - Standard error: sqrt(0.02 × 0.98 / 100) ≈ 1.4%
   */
  REVERSAL_WINDOW_SIZE: 100,

  /**
   * Minimum boxes processed before checking reversal rate.
   * Ensures we have enough data for meaningful statistics.
   *
   * Rationale: At least half the window size to avoid premature stopping.
   */
  MIN_BOXES_BEFORE_CHECK: 50,

  /**
   * Batch size for streaming updates (UI responsiveness).
   * Process this many boxes before yielding to event loop.
   *
   * Rationale: 50 boxes ≈ 5-10ms processing time, keeps UI at 60fps.
   */
  BATCH_SIZE: 50,
} as const

/**
 * Configuration for prediction change probability estimation.
 *
 * Weights for combining uncertainty, similarity, and boundary proximity.
 */
export const PREDICTION_CHANGE_CONFIG = {
  /**
   * Weight for uncertainty factor (1 - confidence).
   * Low confidence predictions more likely to flip.
   *
   * Rationale: Primary signal - uncertain predictions are candidates for change.
   */
  UNCERTAINTY_WEIGHT: 0.4,

  /**
   * Weight for feature similarity factor (Mahalanobis distance).
   * Similar boxes affected by annotation.
   *
   * Rationale: Primary signal - annotation affects similar boxes.
   */
  SIMILARITY_WEIGHT: 0.4,

  /**
   * Weight for decision boundary proximity (|confidence - 0.5|).
   * Boxes near 50% confidence are on the decision boundary.
   *
   * Rationale: Secondary refinement signal.
   */
  BOUNDARY_SENSITIVITY_WEIGHT: 0.2,

  /**
   * Threshold Mahalanobis distance for "similar" features.
   * Distance > this considered dissimilar (unlikely to be affected).
   *
   * Rationale: 3 standard deviations covers 99.7% of normal distribution.
   * Beyond this, boxes in different feature space entirely.
   */
  MAX_MAHALANOBIS_DISTANCE: 3.0,
} as const

/**
 * Configuration for model retraining triggers.
 *
 * Multiple trigger conditions to adapt to annotation patterns.
 */
export const RETRAIN_TRIGGER_CONFIG = {
  /**
   * Minimum annotations before first retrain.
   * Below this, fall back to heuristics.
   *
   * Rationale: 20 samples minimum for reasonable Gaussian parameter estimates
   * (enough to estimate mean ± std per feature per class).
   */
  MIN_ANNOTATIONS_FOR_RETRAIN: 20,

  /**
   * Standard trigger: retrain after this many new annotations.
   *
   * Rationale: 100 annotations represents significant model update.
   * - Enough to shift Gaussian parameters meaningfully
   * - Not so frequent as to cause constant retraining
   */
  ANNOTATION_COUNT_THRESHOLD: 100,

  /**
   * Time-based trigger: minimum seconds between retrains.
   * Prevents thrashing on rapid annotation bursts.
   *
   * Rationale: 20 seconds prevents thrashing while staying responsive:
   * - Short enough for active bulk annotation (2000 boxes/min = ~33/sec)
   * - Long enough to batch individual edits (prevents retrain per annotation)
   * - With high-rate trigger, retrains every ~1.5 min during fast annotation
   */
  MIN_RETRAIN_INTERVAL_SECONDS: 20,

  /**
   * High-rate annotation threshold (annotations per minute).
   * If user annotating quickly, retrain more frequently.
   *
   * Rationale: 20 annotations/minute = rapid workflow, user expects responsive model.
   */
  HIGH_ANNOTATION_RATE_PER_MINUTE: 20,

  /**
   * Minimum annotations for high-rate trigger.
   * Even with high rate, need enough samples.
   *
   * Rationale: 30 samples provides reasonable parameter estimates even with rapid pace.
   */
  HIGH_RATE_MIN_ANNOTATIONS: 30,

  /**
   * Maximum time without retrain (seconds).
   * Forces periodic retrain even with slow annotation.
   *
   * Rationale: 5 minutes max ensures model stays fresh during active sessions.
   * Shorter than original 30min since layout annotation is focused, continuous work.
   */
  MAX_RETRAIN_INTERVAL_SECONDS: 300,
} as const

/**
 * Feature names for the 26-feature model.
 * Order matches feature extraction in box-prediction.ts.
 */
export const FEATURE_NAMES = [
  // Spatial features (1-7)
  'topAlignment',
  'bottomAlignment',
  'heightSimilarity',
  'horizontalClustering',
  'aspectRatio',
  'normalizedY',
  'normalizedArea',
  // User annotations (8-9)
  'isUserAnnotatedIn',
  'isUserAnnotatedOut',
  // Edge positions (10-13)
  'normalizedLeft',
  'normalizedTop',
  'normalizedRight',
  'normalizedBottom',
  // Character sets (14-24)
  'isRoman',
  'isHanzi',
  'isArabic',
  'isKorean',
  'isHiragana',
  'isKatakana',
  'isCyrillic',
  'isDevanagari',
  'isThai',
  'isDigits',
  'isPunctuation',
  // Temporal features (25-26)
  'timeFromStart',
  'timeFromEnd',
] as const

/**
 * Number of features in the model.
 */
export const NUM_FEATURES = 26

/**
 * Type for feature importance metrics.
 */
export interface FeatureImportanceMetrics {
  /** Feature index (0-25) */
  featureIndex: number
  /** Feature name */
  featureName: (typeof FEATURE_NAMES)[number]
  /** Fisher score: (μ_in - μ_out)² / (σ²_in + σ²_out) */
  fisherScore: number
  /** Normalized importance weight [0-1] */
  importanceWeight: number
  /** Mean difference between classes (absolute) */
  meanDifference: number
}

/**
 * Configuration for feature importance calculation.
 */
export const FEATURE_IMPORTANCE_CONFIG = {
  /**
   * Minimum samples before calculating feature importance.
   * Need enough data for stable variance estimates.
   *
   * Rationale: 50 samples provides reasonable variance estimates
   * (25 per class assuming balanced distribution).
   */
  MIN_SAMPLES_FOR_IMPORTANCE: 50,

  /**
   * Method for calculating feature importance.
   * Fisher score = variance ratio between classes.
   */
  METHOD: 'fisher' as const,
} as const
