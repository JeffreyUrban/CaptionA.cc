/**
 * Bayesian prediction for OCR box classification.
 *
 * Predicts whether a box is a caption ("in") or noise ("out") based on:
 * - Trained Gaussian Naive Bayes model (when available)
 * - Fallback heuristics based on layout parameters
 */

import type Database from 'better-sqlite3'

import type { BoxLabel, TextAnchor } from '~/types/enums'

import {
  calculateFeatureImportance,
  computePooledCovariance,
  invertCovarianceMatrix,
  shouldCalculateFeatureImportance,
  type ClassSamples,
  type GaussianParams as FeatureGaussianParams,
} from './feature-importance'
import { type FeatureImportanceMetrics } from './streaming-prediction-config'

/** SQLite error with code property */
interface SqliteError extends Error {
  code: string
}

/** Type guard for SQLite errors */
function isSqliteError(error: unknown): error is SqliteError {
  return error instanceof Error && 'code' in error
}

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
  anchor_type: TextAnchor | null
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
  in_features: GaussianParams[] // 26 features
  out_features: GaussianParams[] // 26 features
  feature_importance: FeatureImportanceMetrics[] | null // Fisher scores (26 features)
  covariance_matrix: number[] | null // Pooled covariance (676 values: 26×26 row-major)
  covariance_inverse: number[] | null // Inverted covariance (676 values, pre-computed)
}

interface ModelRow {
  model_version: string
  n_training_samples: number
  prior_in: number
  prior_out: number
  // Features 1-7: Spatial features
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
  // Features 8-9: User annotations
  in_user_annotated_in_mean: number
  in_user_annotated_in_std: number
  in_user_annotated_out_mean: number
  in_user_annotated_out_std: number
  out_user_annotated_in_mean: number
  out_user_annotated_in_std: number
  out_user_annotated_out_mean: number
  out_user_annotated_out_std: number
  // Features 10-13: Edge positions
  in_normalized_left_mean: number
  in_normalized_left_std: number
  in_normalized_top_mean: number
  in_normalized_top_std: number
  in_normalized_right_mean: number
  in_normalized_right_std: number
  in_normalized_bottom_mean: number
  in_normalized_bottom_std: number
  out_normalized_left_mean: number
  out_normalized_left_std: number
  out_normalized_top_mean: number
  out_normalized_top_std: number
  out_normalized_right_mean: number
  out_normalized_right_std: number
  out_normalized_bottom_mean: number
  out_normalized_bottom_std: number
  // Features 14-24: Character sets (11 features)
  in_is_roman_mean: number
  in_is_roman_std: number
  in_is_hanzi_mean: number
  in_is_hanzi_std: number
  in_is_arabic_mean: number
  in_is_arabic_std: number
  in_is_korean_mean: number
  in_is_korean_std: number
  in_is_hiragana_mean: number
  in_is_hiragana_std: number
  in_is_katakana_mean: number
  in_is_katakana_std: number
  in_is_cyrillic_mean: number
  in_is_cyrillic_std: number
  in_is_devanagari_mean: number
  in_is_devanagari_std: number
  in_is_thai_mean: number
  in_is_thai_std: number
  in_is_digits_mean: number
  in_is_digits_std: number
  in_is_punctuation_mean: number
  in_is_punctuation_std: number
  out_is_roman_mean: number
  out_is_roman_std: number
  out_is_hanzi_mean: number
  out_is_hanzi_std: number
  out_is_arabic_mean: number
  out_is_arabic_std: number
  out_is_korean_mean: number
  out_is_korean_std: number
  out_is_hiragana_mean: number
  out_is_hiragana_std: number
  out_is_katakana_mean: number
  out_is_katakana_std: number
  out_is_cyrillic_mean: number
  out_is_cyrillic_std: number
  out_is_devanagari_mean: number
  out_is_devanagari_std: number
  out_is_thai_mean: number
  out_is_thai_std: number
  out_is_digits_mean: number
  out_is_digits_std: number
  out_is_punctuation_mean: number
  out_is_punctuation_std: number
  // Features 25-26: Temporal features
  in_time_from_start_mean: number
  in_time_from_start_std: number
  in_time_from_end_mean: number
  in_time_from_end_std: number
  out_time_from_start_mean: number
  out_time_from_start_std: number
  out_time_from_end_mean: number
  out_time_from_end_std: number
  // Streaming prediction metrics (JSON columns)
  feature_importance: string | null // JSON array of FeatureImportanceMetrics
  covariance_matrix: string | null // JSON array of 676 values (26×26 row-major)
  covariance_inverse: string | null // JSON array of 676 values
}

/**
 * Character set detection results using Unicode ranges.
 * Each field is binary (1.0 if detected, 0.0 otherwise).
 * Non-exclusive: text can contain multiple character sets.
 */
interface CharacterSets {
  isRoman: number
  isHanzi: number
  isArabic: number
  isKorean: number
  isHiragana: number
  isKatakana: number
  isCyrillic: number
  isDevanagari: number
  isThai: number
  isDigits: number
  isPunctuation: number
}

/**
 * Unicode range definition for a character set.
 * Each range is defined as [start, end] inclusive.
 */
type UnicodeRange = [number, number]

/**
 * Check if a character code falls within any of the provided Unicode ranges.
 */
function isInRanges(code: number, ranges: UnicodeRange[]): boolean {
  return ranges.some(([start, end]) => code >= start && code <= end)
}

/**
 * Check if character is Roman (Latin alphabet).
 * Includes: Basic Latin, Latin-1 Supplement, Latin Extended-A, Latin Extended-B
 */
function isRomanChar(code: number): boolean {
  const ranges: UnicodeRange[] = [
    [0x0041, 0x005a], // A-Z
    [0x0061, 0x007a], // a-z
    [0x00c0, 0x00ff], // Latin-1 Supplement (accented chars)
    [0x0100, 0x017f], // Latin Extended-A
    [0x0180, 0x024f], // Latin Extended-B
  ]
  return isInRanges(code, ranges)
}

/**
 * Check if character is Hanzi (Chinese).
 * Includes: CJK Unified Ideographs, CJK Extension A
 */
function isHanziChar(code: number): boolean {
  const ranges: UnicodeRange[] = [
    [0x4e00, 0x9fff], // CJK Unified Ideographs
    [0x3400, 0x4dbf], // CJK Extension A
  ]
  return isInRanges(code, ranges)
}

/**
 * Check if character is Arabic.
 * Includes: Arabic, Arabic Supplement
 */
function isArabicChar(code: number): boolean {
  const ranges: UnicodeRange[] = [
    [0x0600, 0x06ff], // Arabic
    [0x0750, 0x077f], // Arabic Supplement
  ]
  return isInRanges(code, ranges)
}

/**
 * Check if character is Korean (Hangul).
 * Includes: Hangul Syllables, Hangul Jamo
 */
function isKoreanChar(code: number): boolean {
  const ranges: UnicodeRange[] = [
    [0xac00, 0xd7af], // Hangul Syllables
    [0x1100, 0x11ff], // Hangul Jamo
  ]
  return isInRanges(code, ranges)
}

/** Check if character is Hiragana. */
function isHiraganaChar(code: number): boolean {
  return code >= 0x3040 && code <= 0x309f
}

/** Check if character is Katakana. */
function isKatakanaChar(code: number): boolean {
  return code >= 0x30a0 && code <= 0x30ff
}

/** Check if character is Cyrillic. */
function isCyrillicChar(code: number): boolean {
  return code >= 0x0400 && code <= 0x04ff
}

/** Check if character is Devanagari. */
function isDevanagariChar(code: number): boolean {
  return code >= 0x0900 && code <= 0x097f
}

/** Check if character is Thai. */
function isThaiChar(code: number): boolean {
  return code >= 0x0e00 && code <= 0x0e7f
}

/** Check if character is an ASCII digit. */
function isDigitChar(code: number): boolean {
  return code >= 0x0030 && code <= 0x0039
}

/**
 * Check if character is ASCII punctuation.
 * Includes: ! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \ ] ^ _ ` { | } ~
 */
function isPunctuationChar(code: number): boolean {
  const ranges: UnicodeRange[] = [
    [0x0021, 0x002f], // ! " # $ % & ' ( ) * + , - . /
    [0x003a, 0x0040], // : ; < = > ? @
    [0x005b, 0x0060], // [ \ ] ^ _ `
    [0x007b, 0x007e], // { | } ~
  ]
  return isInRanges(code, ranges)
}

/**
 * Detect character sets in text using Unicode character code ranges.
 * Returns binary indicators (1.0 or 0.0) for each character set.
 * Non-exclusive: "Season 2 第二季" returns {isRoman: 1.0, isHanzi: 1.0, isDigits: 1.0, ...}
 */
function detectCharacterSets(text: string): CharacterSets {
  const result: CharacterSets = {
    isRoman: 0.0,
    isHanzi: 0.0,
    isArabic: 0.0,
    isKorean: 0.0,
    isHiragana: 0.0,
    isKatakana: 0.0,
    isCyrillic: 0.0,
    isDevanagari: 0.0,
    isThai: 0.0,
    isDigits: 0.0,
    isPunctuation: 0.0,
  }

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)

    if (isRomanChar(code)) result.isRoman = 1.0
    if (isHanziChar(code)) result.isHanzi = 1.0
    if (isArabicChar(code)) result.isArabic = 1.0
    if (isKoreanChar(code)) result.isKorean = 1.0
    if (isHiraganaChar(code)) result.isHiragana = 1.0
    if (isKatakanaChar(code)) result.isKatakana = 1.0
    if (isCyrillicChar(code)) result.isCyrillic = 1.0
    if (isDevanagariChar(code)) result.isDevanagari = 1.0
    if (isThaiChar(code)) result.isThai = 1.0
    if (isDigitChar(code)) result.isDigits = 1.0
    if (isPunctuationChar(code)) result.isPunctuation = 1.0
  }

  return result
}

/**
 * Compute k-nearest-neighbors alignment score using a simple distance function.
 * Returns deviation from mean in standard deviation units.
 *
 * @param otherBoxes - Boxes to compare against (excluding current box)
 * @param k - Number of nearest neighbors to use
 * @param distanceFn - Function to compute distance from current box
 * @param valueFn - Function to extract the value to compare from neighbor
 * @param currentValue - The value from the current box to compare against neighbor mean
 */
function computeKnnAlignmentScore(
  otherBoxes: BoxBounds[],
  k: number,
  distanceFn: (b: BoxBounds) => number,
  valueFn: (b: BoxBounds) => number,
  currentValue: number
): number {
  if (otherBoxes.length === 0) return 0.0

  const sorted = otherBoxes
    .map(b => ({ box: b, distance: distanceFn(b) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.min(k, otherBoxes.length))

  if (sorted.length <= 1) return 0.0

  const values = sorted.map(item => valueFn(item.box))
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
  const std = Math.sqrt(variance)

  return std > 0 ? Math.abs(currentValue - mean) / std : 0
}

/**
 * Compute horizontal clustering score using weighted distance.
 * Combines vertical and horizontal distance with configurable weights.
 */
function computeHorizontalClusteringScore(
  otherBoxes: BoxBounds[],
  k: number,
  boxCenterX: number,
  boxBottom: number
): number {
  if (otherBoxes.length === 0) return 0.0

  const verticalWeight = 0.7
  const horizontalWeight = 0.3

  const sorted = otherBoxes
    .map(b => {
      const bCenterX = (b.left + b.right) / 2
      const verticalDist = Math.abs(b.bottom - boxBottom)
      const horizontalDist = Math.abs(bCenterX - boxCenterX)
      const combinedDist = verticalWeight * verticalDist + horizontalWeight * horizontalDist
      return { centerX: bCenterX, distance: combinedDist }
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.min(k, otherBoxes.length))

  if (sorted.length <= 1) return 0.0

  const centerXs = sorted.map(item => item.centerX)
  const mean = centerXs.reduce((sum, val) => sum + val, 0) / centerXs.length
  const variance = centerXs.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / centerXs.length
  const std = Math.sqrt(variance)

  return std > 0 ? Math.abs(boxCenterX - mean) / std : 0
}

/**
 * Query user annotation from database for a box.
 * Returns {isIn: number, isOut: number} indicators.
 */
function queryUserAnnotation(
  db: Database.Database | null,
  frameIndex: number,
  boxIndex: number
): { isIn: number; isOut: number } {
  if (!db) return { isIn: 0.0, isOut: 0.0 }

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
      .get(frameIndex, boxIndex) as { label: BoxLabel } | undefined

    if (!annotation) return { isIn: 0.0, isOut: 0.0 }
    return annotation.label === 'in' ? { isIn: 1.0, isOut: 0.0 } : { isIn: 0.0, isOut: 1.0 }
  } catch (error) {
    console.warn('[extractFeatures] Failed to lookup user annotation:', error)
    return { isIn: 0.0, isOut: 0.0 }
  }
}

/**
 * Extract 26 features from a box for Bayesian classification.
 *
 * Feature categories:
 * - Features 1-7: Spatial features (alignment, clustering, aspect ratio, position, area)
 * - Features 8-9: User annotations (binary indicators for "in" and "out" labels)
 * - Features 10-13: Edge positions (normalized left, top, right, bottom in [0-1] range)
 * - Features 14-24: Character sets (11 binary indicators, non-exclusive)
 * - Features 25-26: Temporal features (time from start and end in seconds)
 *
 * All spatial features use k-nearest neighbors approach, independent of pre-computed
 * cluster parameters to avoid circular dependencies.
 */
function extractFeatures(
  box: BoxBounds,
  layout: VideoLayoutConfig,
  allBoxes: BoxBounds[],
  frameIndex: number,
  boxIndex: number,
  boxText: string,
  timestampSeconds: number,
  durationSeconds: number,
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

  // Features 1a-1b: Vertical alignment scores (top and bottom edges)
  const topAlignmentScore = computeKnnAlignmentScore(
    otherBoxes,
    k,
    b => Math.abs(b.top - box.top),
    b => b.top,
    box.top
  )
  const bottomAlignmentScore = computeKnnAlignmentScore(
    otherBoxes,
    k,
    b => Math.abs(b.bottom - box.bottom),
    b => b.bottom,
    box.bottom
  )

  // Feature 2: Height similarity (among vertically-aligned neighbors)
  const heightSimilarityScore = computeKnnAlignmentScore(
    otherBoxes,
    k,
    b => Math.abs(b.bottom - box.bottom),
    b => b.bottom - b.top,
    boxHeight
  )

  // Feature 3: Horizontal clustering
  const horizontalClusteringScore = computeHorizontalClusteringScore(
    otherBoxes,
    k,
    boxCenterX,
    box.bottom
  )

  // Features 4-6: Simple spatial features
  const aspectRatio = boxHeight > 0 ? boxWidth / boxHeight : 0.0
  const normalizedYPosition = layout.frame_height > 0 ? boxCenterY / layout.frame_height : 0.0
  const normalizedArea = frameArea > 0 ? boxArea / frameArea : 0.0

  // Features 8-9: User annotations (binary indicators)
  const { isIn: isUserAnnotatedIn, isOut: isUserAnnotatedOut } = queryUserAnnotation(
    db,
    frameIndex,
    boxIndex
  )

  // Features 10-13: Edge positions (normalized to [0-1] range)
  const normalizedLeft = layout.frame_width > 0 ? box.left / layout.frame_width : 0.0
  const normalizedTop = layout.frame_height > 0 ? box.top / layout.frame_height : 0.0
  const normalizedRight = layout.frame_width > 0 ? box.right / layout.frame_width : 0.0
  const normalizedBottom = layout.frame_height > 0 ? box.bottom / layout.frame_height : 0.0

  // Features 14-24: Character sets (11 binary indicators, non-exclusive)
  const charSets = detectCharacterSets(boxText)

  // Features 25-26: Temporal features
  const timeFromStart = timestampSeconds
  const timeFromEnd = durationSeconds - timestampSeconds

  return [
    // Features 1-7: Spatial
    topAlignmentScore,
    bottomAlignmentScore,
    heightSimilarityScore,
    horizontalClusteringScore,
    aspectRatio,
    normalizedYPosition,
    normalizedArea,
    // Features 8-9: User annotations
    isUserAnnotatedIn,
    isUserAnnotatedOut,
    // Features 10-13: Edge positions
    normalizedLeft,
    normalizedTop,
    normalizedRight,
    normalizedBottom,
    // Features 14-24: Character sets (11 features)
    charSets.isRoman,
    charSets.isHanzi,
    charSets.isArabic,
    charSets.isKorean,
    charSets.isHiragana,
    charSets.isKatakana,
    charSets.isCyrillic,
    charSets.isDevanagari,
    charSets.isThai,
    charSets.isDigits,
    charSets.isPunctuation,
    // Features 25-26: Temporal
    timeFromStart,
    timeFromEnd,
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
 * Migrate box_classification_model schema to 26-feature model if needed.
 *
 * Adds 68 columns for 17 new features (edge positions, character sets, temporal):
 * - 4 edge position features (normalized left, top, right, bottom)
 * - 11 character set features (is_roman, is_hanzi, is_arabic, is_korean, is_hiragana,
 *   is_katakana, is_cyrillic, is_devanagari, is_thai, is_digits, is_punctuation)
 * - 2 temporal features (time_from_start, time_from_end)
 *
 * Each feature requires 4 columns (mean + std for "in" class, mean + std for "out" class).
 */
function migrateModelSchema(db: Database.Database): void {
  try {
    // Check if 26-feature schema exists by testing for one of the new columns
    db.prepare('SELECT in_normalized_left_mean FROM box_classification_model WHERE id = 1').get()
    // If we get here, 26-feature schema already exists
    return
  } catch {
    // Schema needs migration - could be 7-feature or 9-feature schema
    console.log('[migrateModelSchema] Migrating to 26-feature schema (adding 17 new features)')

    try {
      // First, ensure 9-feature schema exists (user annotations)
      try {
        db.prepare(
          'SELECT in_user_annotated_in_mean FROM box_classification_model WHERE id = 1'
        ).get()
      } catch {
        // Need to add user annotation columns first (features 8-9)
        console.log('[migrateModelSchema] Adding user annotation columns (features 8-9)')
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
      }

      // Now add features 10-26 (edge positions, character sets, temporal)

      // Features 10-13: Edge positions
      const edgeFeatures = [
        'normalized_left',
        'normalized_top',
        'normalized_right',
        'normalized_bottom',
      ]
      for (const feature of edgeFeatures) {
        db.prepare(`ALTER TABLE box_classification_model ADD COLUMN in_${feature}_mean REAL`).run()
        db.prepare(`ALTER TABLE box_classification_model ADD COLUMN in_${feature}_std REAL`).run()
        db.prepare(`ALTER TABLE box_classification_model ADD COLUMN out_${feature}_mean REAL`).run()
        db.prepare(`ALTER TABLE box_classification_model ADD COLUMN out_${feature}_std REAL`).run()
      }

      // Features 14-24: Character sets
      const charSetFeatures = [
        'is_roman',
        'is_hanzi',
        'is_arabic',
        'is_korean',
        'is_hiragana',
        'is_katakana',
        'is_cyrillic',
        'is_devanagari',
        'is_thai',
        'is_digits',
        'is_punctuation',
      ]
      for (const feature of charSetFeatures) {
        db.prepare(`ALTER TABLE box_classification_model ADD COLUMN in_${feature}_mean REAL`).run()
        db.prepare(`ALTER TABLE box_classification_model ADD COLUMN in_${feature}_std REAL`).run()
        db.prepare(`ALTER TABLE box_classification_model ADD COLUMN out_${feature}_mean REAL`).run()
        db.prepare(`ALTER TABLE box_classification_model ADD COLUMN out_${feature}_std REAL`).run()
      }

      // Features 25-26: Temporal features
      const temporalFeatures = ['time_from_start', 'time_from_end']
      for (const feature of temporalFeatures) {
        db.prepare(`ALTER TABLE box_classification_model ADD COLUMN in_${feature}_mean REAL`).run()
        db.prepare(`ALTER TABLE box_classification_model ADD COLUMN in_${feature}_std REAL`).run()
        db.prepare(`ALTER TABLE box_classification_model ADD COLUMN out_${feature}_mean REAL`).run()
        db.prepare(`ALTER TABLE box_classification_model ADD COLUMN out_${feature}_std REAL`).run()
      }

      // Set reasonable defaults for existing model rows
      // Note: This UPDATE will be replaced by full retraining, these are just placeholders
      db.prepare(
        `
        UPDATE box_classification_model
        SET
          -- User annotations (features 8-9)
          in_user_annotated_in_mean = COALESCE(in_user_annotated_in_mean, 1.0),
          in_user_annotated_in_std = COALESCE(in_user_annotated_in_std, 0.01),
          in_user_annotated_out_mean = COALESCE(in_user_annotated_out_mean, 0.0),
          in_user_annotated_out_std = COALESCE(in_user_annotated_out_std, 0.01),
          out_user_annotated_in_mean = COALESCE(out_user_annotated_in_mean, 0.0),
          out_user_annotated_in_std = COALESCE(out_user_annotated_in_std, 0.01),
          out_user_annotated_out_mean = COALESCE(out_user_annotated_out_mean, 1.0),
          out_user_annotated_out_std = COALESCE(out_user_annotated_out_std, 0.01),
          -- Edge positions (features 10-13): default to center of frame
          in_normalized_left_mean = 0.4, in_normalized_left_std = 0.2,
          in_normalized_top_mean = 0.7, in_normalized_top_std = 0.1,
          in_normalized_right_mean = 0.6, in_normalized_right_std = 0.2,
          in_normalized_bottom_mean = 0.8, in_normalized_bottom_std = 0.1,
          out_normalized_left_mean = 0.5, out_normalized_left_std = 0.3,
          out_normalized_top_mean = 0.5, out_normalized_top_std = 0.3,
          out_normalized_right_mean = 0.5, out_normalized_right_std = 0.3,
          out_normalized_bottom_mean = 0.5, out_normalized_bottom_std = 0.3,
          -- Character sets (features 14-24): neutral defaults
          in_is_roman_mean = 0.5, in_is_roman_std = 0.5,
          in_is_hanzi_mean = 0.5, in_is_hanzi_std = 0.5,
          in_is_arabic_mean = 0.5, in_is_arabic_std = 0.5,
          in_is_korean_mean = 0.5, in_is_korean_std = 0.5,
          in_is_hiragana_mean = 0.5, in_is_hiragana_std = 0.5,
          in_is_katakana_mean = 0.5, in_is_katakana_std = 0.5,
          in_is_cyrillic_mean = 0.5, in_is_cyrillic_std = 0.5,
          in_is_devanagari_mean = 0.5, in_is_devanagari_std = 0.5,
          in_is_thai_mean = 0.5, in_is_thai_std = 0.5,
          in_is_digits_mean = 0.5, in_is_digits_std = 0.5,
          in_is_punctuation_mean = 0.5, in_is_punctuation_std = 0.5,
          out_is_roman_mean = 0.5, out_is_roman_std = 0.5,
          out_is_hanzi_mean = 0.5, out_is_hanzi_std = 0.5,
          out_is_arabic_mean = 0.5, out_is_arabic_std = 0.5,
          out_is_korean_mean = 0.5, out_is_korean_std = 0.5,
          out_is_hiragana_mean = 0.5, out_is_hiragana_std = 0.5,
          out_is_katakana_mean = 0.5, out_is_katakana_std = 0.5,
          out_is_cyrillic_mean = 0.5, out_is_cyrillic_std = 0.5,
          out_is_devanagari_mean = 0.5, out_is_devanagari_std = 0.5,
          out_is_thai_mean = 0.5, out_is_thai_std = 0.5,
          out_is_digits_mean = 0.5, out_is_digits_std = 0.5,
          out_is_punctuation_mean = 0.5, out_is_punctuation_std = 0.5,
          -- Temporal features (features 25-26): mid-video defaults
          in_time_from_start_mean = 300.0, in_time_from_start_std = 200.0,
          in_time_from_end_mean = 300.0, in_time_from_end_std = 200.0,
          out_time_from_start_mean = 300.0, out_time_from_start_std = 200.0,
          out_time_from_end_mean = 300.0, out_time_from_end_std = 200.0
        WHERE id = 1
      `
      ).run()

      console.log(
        '[migrateModelSchema] Successfully migrated to 26-feature schema (68 new columns)'
      )
      console.log(
        '[migrateModelSchema] WARNING: Model needs retraining to learn proper parameters for new features'
      )
    } catch (migrationError) {
      // If readonly, silently skip migration
      if (isSqliteError(migrationError) && migrationError.code === 'SQLITE_READONLY') {
        return
      }
      console.error('[migrateModelSchema] Migration failed:', migrationError)
      throw new Error('Failed to migrate model schema - model will need to be retrained')
    }
  }
}

/**
 * Migrate box_classification_model to add streaming prediction columns.
 *
 * Adds columns for intelligent scope detection and feature importance:
 * - feature_importance: JSON array of Fisher scores (26 features)
 * - covariance_matrix: JSON array of pooled covariance (26×26 = 676 values)
 * - covariance_inverse: JSON array of inverted covariance (676 values, pre-computed)
 */
function migrateStreamingPredictionSchema(db: Database.Database): void {
  try {
    // Check if streaming prediction schema exists
    db.prepare('SELECT feature_importance FROM box_classification_model WHERE id = 1').get()
    // If we get here, schema already exists
    return
  } catch {
    // Schema needs migration
    console.log(
      '[migrateStreamingPredictionSchema] Adding feature importance and covariance columns'
    )

    try {
      // Add feature importance column (JSON array of 26 Fisher scores)
      db.prepare('ALTER TABLE box_classification_model ADD COLUMN feature_importance TEXT').run()

      // Add pooled covariance matrix (JSON array of 676 values, row-major 26×26)
      db.prepare('ALTER TABLE box_classification_model ADD COLUMN covariance_matrix TEXT').run()

      // Add inverted covariance (JSON array of 676 values, pre-computed for efficiency)
      db.prepare('ALTER TABLE box_classification_model ADD COLUMN covariance_inverse TEXT').run()

      console.log('[migrateStreamingPredictionSchema] Migration completed successfully')
    } catch (migrationError) {
      // If readonly, silently skip migration
      if (isSqliteError(migrationError) && migrationError.code === 'SQLITE_READONLY') {
        return
      }
      console.error('[migrateStreamingPredictionSchema] Migration failed:', migrationError)
      throw new Error('Failed to migrate streaming prediction schema')
    }
  }
}

/**
 * Migrate video_preferences schema to add index_framerate_hz if needed.
 */
function migrateVideoPreferencesSchema(db: Database.Database): void {
  try {
    // Check if column exists
    db.prepare('SELECT index_framerate_hz FROM video_preferences WHERE id = 1').get()
    // If we get here, column exists - no migration needed
    return
  } catch {
    // Column doesn't exist - need to migrate
    console.log('[migrateVideoPreferencesSchema] Adding index_framerate_hz to video_preferences')

    try {
      db.prepare(
        'ALTER TABLE video_preferences ADD COLUMN index_framerate_hz REAL DEFAULT 10.0'
      ).run()

      // Set default value for existing row
      db.prepare('UPDATE video_preferences SET index_framerate_hz = 10.0 WHERE id = 1').run()

      console.log('[migrateVideoPreferencesSchema] Migration completed successfully')
    } catch (migrationError) {
      // If readonly, silently skip migration
      if (isSqliteError(migrationError) && migrationError.code === 'SQLITE_READONLY') {
        return
      }
      console.error('[migrateVideoPreferencesSchema] Migration failed:', migrationError)
      throw new Error('Failed to migrate video_preferences schema')
    }
  }
}

/**
 * Migrate full_frame_ocr schema to add timestamp_seconds if needed.
 * Calculates timestamps from frame_index and index_framerate_hz.
 */
function migrateFullFrameOcrSchema(db: Database.Database): void {
  try {
    // Check if column exists - the query will throw if column doesn't exist
    db.prepare('SELECT timestamp_seconds FROM full_frame_ocr LIMIT 1').get()

    // If we get here, column exists
    // Check if we need to populate it (might be NULL for existing rows)
    const nullCount = db
      .prepare('SELECT COUNT(*) as count FROM full_frame_ocr WHERE timestamp_seconds IS NULL')
      .get() as { count: number }

    if (nullCount.count === 0) {
      // All rows have timestamps, no migration needed
      return
    }

    console.log(
      `[migrateFullFrameOcrSchema] Populating timestamp_seconds for ${nullCount.count} rows`
    )
  } catch {
    // Column doesn't exist - need to migrate
    console.log('[migrateFullFrameOcrSchema] Adding timestamp_seconds to full_frame_ocr')

    try {
      db.prepare('ALTER TABLE full_frame_ocr ADD COLUMN timestamp_seconds REAL').run()
    } catch (migrationError) {
      // If readonly, silently skip migration
      if (isSqliteError(migrationError) && migrationError.code === 'SQLITE_READONLY') {
        return
      }
      console.error('[migrateFullFrameOcrSchema] Failed to add column:', migrationError)
      throw new Error('Failed to migrate full_frame_ocr schema')
    }
  }

  try {
    // Get index framerate (default 10.0 Hz = 0.1 second intervals)
    const prefs = db
      .prepare('SELECT index_framerate_hz FROM video_preferences WHERE id = 1')
      .get() as { index_framerate_hz: number } | undefined

    const indexFramerate = prefs?.index_framerate_hz ?? 10.0

    // Calculate and populate timestamps for rows without them
    // timestamp = frame_index / index_framerate_hz
    db.prepare(
      `
      UPDATE full_frame_ocr
      SET timestamp_seconds = frame_index / ?
      WHERE timestamp_seconds IS NULL
    `
    ).run(indexFramerate)

    console.log('[migrateFullFrameOcrSchema] Timestamps populated successfully')
  } catch (migrationError) {
    // If readonly, silently skip migration
    if (isSqliteError(migrationError) && migrationError.code === 'SQLITE_READONLY') {
      return
    }
    console.error('[migrateFullFrameOcrSchema] Failed to populate timestamps:', migrationError)
    throw new Error('Failed to populate timestamps in full_frame_ocr')
  }
}

/**
 * Load model parameters from database.
 *
 * Accepts both seed model (n_training_samples = 0) and trained models (n_training_samples >= 10).
 * The seed model provides reasonable starting predictions before user annotations are available.
 */
function loadModelFromDB(db: Database.Database): ModelParams | null {
  // Migrate schemas if needed
  migrateModelSchema(db)
  migrateStreamingPredictionSchema(db)
  migrateVideoPreferencesSchema(db)
  migrateFullFrameOcrSchema(db)
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

  // Parse model parameters from database row (26 features)
  const inFeatures: GaussianParams[] = [
    // Features 1-7: Spatial features
    { mean: row.in_vertical_alignment_mean, std: row.in_vertical_alignment_std },
    { mean: row.in_height_similarity_mean, std: row.in_height_similarity_std },
    { mean: row.in_anchor_distance_mean, std: row.in_anchor_distance_std },
    { mean: row.in_crop_overlap_mean, std: row.in_crop_overlap_std },
    { mean: row.in_aspect_ratio_mean, std: row.in_aspect_ratio_std },
    { mean: row.in_normalized_y_mean, std: row.in_normalized_y_std },
    { mean: row.in_normalized_area_mean, std: row.in_normalized_area_std },
    // Features 8-9: User annotations
    { mean: row.in_user_annotated_in_mean, std: row.in_user_annotated_in_std },
    { mean: row.in_user_annotated_out_mean, std: row.in_user_annotated_out_std },
    // Features 10-13: Edge positions
    { mean: row.in_normalized_left_mean, std: row.in_normalized_left_std },
    { mean: row.in_normalized_top_mean, std: row.in_normalized_top_std },
    { mean: row.in_normalized_right_mean, std: row.in_normalized_right_std },
    { mean: row.in_normalized_bottom_mean, std: row.in_normalized_bottom_std },
    // Features 14-24: Character sets
    { mean: row.in_is_roman_mean, std: row.in_is_roman_std },
    { mean: row.in_is_hanzi_mean, std: row.in_is_hanzi_std },
    { mean: row.in_is_arabic_mean, std: row.in_is_arabic_std },
    { mean: row.in_is_korean_mean, std: row.in_is_korean_std },
    { mean: row.in_is_hiragana_mean, std: row.in_is_hiragana_std },
    { mean: row.in_is_katakana_mean, std: row.in_is_katakana_std },
    { mean: row.in_is_cyrillic_mean, std: row.in_is_cyrillic_std },
    { mean: row.in_is_devanagari_mean, std: row.in_is_devanagari_std },
    { mean: row.in_is_thai_mean, std: row.in_is_thai_std },
    { mean: row.in_is_digits_mean, std: row.in_is_digits_std },
    { mean: row.in_is_punctuation_mean, std: row.in_is_punctuation_std },
    // Features 25-26: Temporal features
    { mean: row.in_time_from_start_mean, std: row.in_time_from_start_std },
    { mean: row.in_time_from_end_mean, std: row.in_time_from_end_std },
  ]

  const outFeatures: GaussianParams[] = [
    // Features 1-7: Spatial features
    { mean: row.out_vertical_alignment_mean, std: row.out_vertical_alignment_std },
    { mean: row.out_height_similarity_mean, std: row.out_height_similarity_std },
    { mean: row.out_anchor_distance_mean, std: row.out_anchor_distance_std },
    { mean: row.out_crop_overlap_mean, std: row.out_crop_overlap_std },
    { mean: row.out_aspect_ratio_mean, std: row.out_aspect_ratio_std },
    { mean: row.out_normalized_y_mean, std: row.out_normalized_y_std },
    { mean: row.out_normalized_area_mean, std: row.out_normalized_area_std },
    // Features 8-9: User annotations
    { mean: row.out_user_annotated_in_mean, std: row.out_user_annotated_in_std },
    { mean: row.out_user_annotated_out_mean, std: row.out_user_annotated_out_std },
    // Features 10-13: Edge positions
    { mean: row.out_normalized_left_mean, std: row.out_normalized_left_std },
    { mean: row.out_normalized_top_mean, std: row.out_normalized_top_std },
    { mean: row.out_normalized_right_mean, std: row.out_normalized_right_std },
    { mean: row.out_normalized_bottom_mean, std: row.out_normalized_bottom_std },
    // Features 14-24: Character sets
    { mean: row.out_is_roman_mean, std: row.out_is_roman_std },
    { mean: row.out_is_hanzi_mean, std: row.out_is_hanzi_std },
    { mean: row.out_is_arabic_mean, std: row.out_is_arabic_std },
    { mean: row.out_is_korean_mean, std: row.out_is_korean_std },
    { mean: row.out_is_hiragana_mean, std: row.out_is_hiragana_std },
    { mean: row.out_is_katakana_mean, std: row.out_is_katakana_std },
    { mean: row.out_is_cyrillic_mean, std: row.out_is_cyrillic_std },
    { mean: row.out_is_devanagari_mean, std: row.out_is_devanagari_std },
    { mean: row.out_is_thai_mean, std: row.out_is_thai_std },
    { mean: row.out_is_digits_mean, std: row.out_is_digits_std },
    { mean: row.out_is_punctuation_mean, std: row.out_is_punctuation_std },
    // Features 25-26: Temporal features
    { mean: row.out_time_from_start_mean, std: row.out_time_from_start_std },
    { mean: row.out_time_from_end_mean, std: row.out_time_from_end_std },
  ]

  // Parse streaming prediction metrics from JSON columns
  let featureImportance: FeatureImportanceMetrics[] | null = null
  let covarianceMatrix: number[] | null = null
  let covarianceInverse: number[] | null = null

  if (row.feature_importance) {
    try {
      featureImportance = JSON.parse(row.feature_importance) as FeatureImportanceMetrics[]
    } catch (error) {
      console.warn('[loadModelFromDB] Failed to parse feature_importance:', error)
    }
  }

  if (row.covariance_matrix) {
    try {
      covarianceMatrix = JSON.parse(row.covariance_matrix) as number[]
    } catch (error) {
      console.warn('[loadModelFromDB] Failed to parse covariance_matrix:', error)
    }
  }

  if (row.covariance_inverse) {
    try {
      covarianceInverse = JSON.parse(row.covariance_inverse) as number[]
    } catch (error) {
      console.warn('[loadModelFromDB] Failed to parse covariance_inverse:', error)
    }
  }

  return {
    model_version: row.model_version,
    n_training_samples: row.n_training_samples,
    prior_in: row.prior_in,
    prior_out: row.prior_out,
    in_features: inFeatures,
    out_features: outFeatures,
    feature_importance: featureImportance,
    covariance_matrix: covarianceMatrix,
    covariance_inverse: covarianceInverse,
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
  boxText: string,
  timestampSeconds: number,
  durationSeconds: number,
  db: Database.Database
): { label: BoxLabel; confidence: number } {
  const features = extractFeatures(
    box,
    layout,
    allBoxes,
    frameIndex,
    boxIndex,
    boxText,
    timestampSeconds,
    durationSeconds,
    db
  )

  // Calculate log-likelihoods using log-space to prevent numerical underflow
  //
  // PROBLEM: Naive Bayes multiplies probabilities for each feature:
  //   P(features|class) = P(f1|class) × P(f2|class) × ... × P(f26|class)
  //
  // With 26 features, each having Gaussian PDF values often < 0.01, the product can underflow to 0.
  // Example: 0.01^26 = 1e-52, which underflows to 0 in floating point.
  //
  // When a single feature has an extreme value (e.g., topAlignment=177 vs mean=0.5),
  // its Gaussian PDF ≈ 0, causing the entire likelihood to become 0 for both classes.
  // This leads to the degenerate case where total = posteriorIn + posteriorOut = 0.
  //
  // SOLUTION: Use log-space arithmetic
  //   log(P(features|class)) = log(P(f1|class)) + log(P(f2|class)) + ... + log(P(f26|class))
  //
  // Benefits:
  //   - Product becomes sum (numerically stable)
  //   - Can represent very small probabilities (log(1e-100) = -230, no underflow)
  //   - Convert back to probability space only at the end
  //
  // See: https://en.wikipedia.org/wiki/Log_probability
  let logLikelihoodIn = 0.0
  let logLikelihoodOut = 0.0

  for (let i = 0; i < 26; i++) {
    const featureValue = features[i] ?? 0
    const inFeature = model.in_features[i] ?? { mean: 0, std: 1 }
    const outFeature = model.out_features[i] ?? { mean: 0, std: 1 }
    const pdfIn = gaussianPDF(featureValue, inFeature.mean, inFeature.std)
    const pdfOut = gaussianPDF(featureValue, outFeature.mean, outFeature.std)

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
): { label: BoxLabel; confidence: number } {
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
): { label: BoxLabel; confidence: number } {
  // Try to use Bayesian model if database provided
  if (db) {
    try {
      const model = loadModelFromDB(db)
      if (model) {
        // Fetch box text and timestamp for feature extraction
        const boxData = db
          .prepare(
            `
          SELECT text, timestamp_seconds
          FROM full_frame_ocr
          WHERE frame_index = ? AND box_index = ?
        `
          )
          .get(frameIndex, boxIndex) as { text: string; timestamp_seconds: number } | undefined

        const boxText = boxData?.text ?? ''
        const timestampSeconds = boxData?.timestamp_seconds ?? 0.0

        // Fetch video duration for temporal features
        const videoDuration = db
          .prepare('SELECT duration_seconds FROM video_metadata WHERE id = 1')
          .get() as { duration_seconds: number } | undefined
        const durationSeconds = videoDuration?.duration_seconds ?? 600.0 // Default 10 minutes

        return predictBayesian(
          boxBounds,
          layoutConfig,
          model,
          allBoxes,
          frameIndex,
          boxIndex,
          boxText,
          timestampSeconds,
          durationSeconds,
          db
        )
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

  // Seed parameters based on typical caption characteristics (26 features)
  // Features: spatial (1-7), user annotations (8-9), edge positions (10-13),
  // character sets (14-24), temporal (25-26)

  // "in" (caption) boxes: well-aligned, similar, clustered, wide, bottom of frame, small,
  // center-aligned horizontally, contain typical caption characters, mid-video
  const inParams = [
    // Spatial features (1-7)
    { mean: 0.5, std: 0.5 }, // topAlignment: low = well aligned
    { mean: 0.5, std: 0.5 }, // bottomAlignment: low = well aligned
    { mean: 0.5, std: 0.5 }, // heightSimilarity: low = similar heights
    { mean: 0.5, std: 0.5 }, // horizontalClustering: low = clustered
    { mean: 4.0, std: 2.0 }, // aspectRatio: wide boxes (3-5x wider than tall)
    { mean: 0.8, std: 0.1 }, // normalizedY: bottom 20% of frame (0.75-0.85)
    { mean: 0.02, std: 0.015 }, // normalizedArea: 1-3% of frame area
    // User annotations (8-9)
    { mean: 0.5, std: 0.5 }, // isUserAnnotatedIn: neutral (no annotations yet)
    { mean: 0.5, std: 0.5 }, // isUserAnnotatedOut: neutral (no annotations yet)
    // Edge positions (10-13): center-bottom of frame
    { mean: 0.35, std: 0.15 }, // normalizedLeft: ~30-50% from left
    { mean: 0.75, std: 0.1 }, // normalizedTop: bottom quarter
    { mean: 0.65, std: 0.15 }, // normalizedRight: ~50-80% from left
    { mean: 0.85, std: 0.1 }, // normalizedBottom: near bottom
    // Character sets (14-24): neutral (language-agnostic)
    { mean: 0.5, std: 0.5 }, // isRoman
    { mean: 0.5, std: 0.5 }, // isHanzi
    { mean: 0.5, std: 0.5 }, // isArabic
    { mean: 0.5, std: 0.5 }, // isKorean
    { mean: 0.5, std: 0.5 }, // isHiragana
    { mean: 0.5, std: 0.5 }, // isKatakana
    { mean: 0.5, std: 0.5 }, // isCyrillic
    { mean: 0.5, std: 0.5 }, // isDevanagari
    { mean: 0.5, std: 0.5 }, // isThai
    { mean: 0.5, std: 0.5 }, // isDigits
    { mean: 0.5, std: 0.5 }, // isPunctuation
    // Temporal features (25-26): mid-video (not opening/closing credits)
    { mean: 300.0, std: 200.0 }, // timeFromStart: 100-500 seconds
    { mean: 300.0, std: 200.0 }, // timeFromEnd: 100-500 seconds
  ]

  // "out" (noise) boxes: less aligned, varied, scattered, varied positions
  const outParams = [
    // Spatial features (1-7)
    { mean: 1.5, std: 1.0 }, // topAlignment: higher = less aligned
    { mean: 1.5, std: 1.0 }, // bottomAlignment: higher = less aligned
    { mean: 1.5, std: 1.0 }, // heightSimilarity: higher = varied heights
    { mean: 1.5, std: 1.0 }, // horizontalClustering: higher = scattered
    { mean: 2.0, std: 3.0 }, // aspectRatio: more varied
    { mean: 0.5, std: 0.3 }, // normalizedY: more varied vertical position
    { mean: 0.03, std: 0.03 }, // normalizedArea: more varied area
    // User annotations (8-9)
    { mean: 0.5, std: 0.5 }, // isUserAnnotatedIn: neutral
    { mean: 0.5, std: 0.5 }, // isUserAnnotatedOut: neutral
    // Edge positions (10-13): varied positions across frame
    { mean: 0.5, std: 0.3 }, // normalizedLeft: anywhere
    { mean: 0.5, std: 0.3 }, // normalizedTop: anywhere
    { mean: 0.5, std: 0.3 }, // normalizedRight: anywhere
    { mean: 0.5, std: 0.3 }, // normalizedBottom: anywhere
    // Character sets (14-24): neutral
    { mean: 0.5, std: 0.5 }, // isRoman
    { mean: 0.5, std: 0.5 }, // isHanzi
    { mean: 0.5, std: 0.5 }, // isArabic
    { mean: 0.5, std: 0.5 }, // isKorean
    { mean: 0.5, std: 0.5 }, // isHiragana
    { mean: 0.5, std: 0.5 }, // isKatakana
    { mean: 0.5, std: 0.5 }, // isCyrillic
    { mean: 0.5, std: 0.5 }, // isDevanagari
    { mean: 0.5, std: 0.5 }, // isThai
    { mean: 0.5, std: 0.5 }, // isDigits
    { mean: 0.5, std: 0.5 }, // isPunctuation
    // Temporal features (25-26): varied timing
    { mean: 300.0, std: 250.0 }, // timeFromStart: more varied
    { mean: 300.0, std: 250.0 }, // timeFromEnd: more varied
  ]

  // Start with balanced priors (50/50)
  const priorIn = 0.5
  const priorOut = 0.5

  // Store seed model in database (26 features = 104 columns + metadata)
  // Uses same schema as trainModel()
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
      in_normalized_left_mean, in_normalized_left_std,
      in_normalized_top_mean, in_normalized_top_std,
      in_normalized_right_mean, in_normalized_right_std,
      in_normalized_bottom_mean, in_normalized_bottom_std,
      in_is_roman_mean, in_is_roman_std,
      in_is_hanzi_mean, in_is_hanzi_std,
      in_is_arabic_mean, in_is_arabic_std,
      in_is_korean_mean, in_is_korean_std,
      in_is_hiragana_mean, in_is_hiragana_std,
      in_is_katakana_mean, in_is_katakana_std,
      in_is_cyrillic_mean, in_is_cyrillic_std,
      in_is_devanagari_mean, in_is_devanagari_std,
      in_is_thai_mean, in_is_thai_std,
      in_is_digits_mean, in_is_digits_std,
      in_is_punctuation_mean, in_is_punctuation_std,
      in_time_from_start_mean, in_time_from_start_std,
      in_time_from_end_mean, in_time_from_end_std,
      out_vertical_alignment_mean, out_vertical_alignment_std,
      out_height_similarity_mean, out_height_similarity_std,
      out_anchor_distance_mean, out_anchor_distance_std,
      out_crop_overlap_mean, out_crop_overlap_std,
      out_aspect_ratio_mean, out_aspect_ratio_std,
      out_normalized_y_mean, out_normalized_y_std,
      out_normalized_area_mean, out_normalized_area_std,
      out_user_annotated_in_mean, out_user_annotated_in_std,
      out_user_annotated_out_mean, out_user_annotated_out_std,
      out_normalized_left_mean, out_normalized_left_std,
      out_normalized_top_mean, out_normalized_top_std,
      out_normalized_right_mean, out_normalized_right_std,
      out_normalized_bottom_mean, out_normalized_bottom_std,
      out_is_roman_mean, out_is_roman_std,
      out_is_hanzi_mean, out_is_hanzi_std,
      out_is_arabic_mean, out_is_arabic_std,
      out_is_korean_mean, out_is_korean_std,
      out_is_hiragana_mean, out_is_hiragana_std,
      out_is_katakana_mean, out_is_katakana_std,
      out_is_cyrillic_mean, out_is_cyrillic_std,
      out_is_devanagari_mean, out_is_devanagari_std,
      out_is_thai_mean, out_is_thai_std,
      out_is_digits_mean, out_is_digits_std,
      out_is_punctuation_mean, out_is_punctuation_std,
      out_time_from_start_mean, out_time_from_start_std,
      out_time_from_end_mean, out_time_from_end_std
    ) VALUES (
      1,
      'seed_v2',
      datetime('now'),
      0,
      ?, ?,
      ${Array(104).fill('?').join(', ')}
    )
  `
  ).run(
    priorIn,
    priorOut,
    ...inParams.flatMap(p => [p.mean, p.std]),
    ...outParams.flatMap(p => [p.mean, p.std])
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

  // Get video duration for temporal features
  const videoDuration = db
    .prepare('SELECT duration_seconds FROM video_metadata WHERE id = 1')
    .get() as { duration_seconds: number } | undefined
  const durationSeconds = videoDuration?.duration_seconds ?? 600.0 // Default 10 minutes if not set

  // Get all OCR boxes for each frame (needed for feature extraction context)
  const frameBoxesCache = new Map<number, BoxBounds[]>()
  const frameBoxTextCache = new Map<string, string>() // Key: "frameIndex-boxIndex"
  const frameBoxTimestampCache = new Map<number, number>() // Key: frameIndex

  // Extract features for each annotation
  const inFeatures: number[][] = []
  const outFeatures: number[][] = []

  for (const ann of annotations) {
    // Get all boxes in this frame for context
    if (!frameBoxesCache.has(ann.frame_index)) {
      const boxes = db
        .prepare(
          `
        SELECT box_index, text, timestamp_seconds, x, y, width, height
        FROM full_frame_ocr
        WHERE frame_index = ?
        ORDER BY box_index
      `
        )
        .all(ann.frame_index) as Array<{
        box_index: number
        text: string
        timestamp_seconds: number
        x: number
        y: number
        width: number
        height: number
      }>

      // Cache box bounds
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

      // Cache box text and timestamp
      for (const box of boxes) {
        frameBoxTextCache.set(`${ann.frame_index}-${box.box_index}`, box.text)
      }
      if (boxes.length > 0) {
        const firstBox = boxes[0]
        if (firstBox) {
          frameBoxTimestampCache.set(ann.frame_index, firstBox.timestamp_seconds)
        }
      }
    }

    const allBoxes = frameBoxesCache.get(ann.frame_index) ?? []
    const boxBounds: BoxBounds = {
      left: ann.box_left,
      top: ann.box_top,
      right: ann.box_right,
      bottom: ann.box_bottom,
    }

    // Get box text and timestamp
    const boxText = frameBoxTextCache.get(`${ann.frame_index}-${ann.box_index}`) ?? ''
    const timestampSeconds = frameBoxTimestampCache.get(ann.frame_index) ?? 0.0

    const features = extractFeatures(
      boxBounds,
      layoutConfig,
      allBoxes,
      ann.frame_index,
      ann.box_index,
      boxText,
      timestampSeconds,
      durationSeconds,
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

  // Extract each feature column and calculate parameters (26 features)
  const inParams: Array<{ mean: number; std: number }> = []
  const outParams: Array<{ mean: number; std: number }> = []

  for (let i = 0; i < 26; i++) {
    const inFeatureValues = inFeatures.map(f => f[i] ?? 0)
    const outFeatureValues = outFeatures.map(f => f[i] ?? 0)

    inParams.push(calculateGaussian(inFeatureValues))
    outParams.push(calculateGaussian(outFeatureValues))
  }

  // Calculate priors
  const total = annotations.length
  const priorIn = inFeatures.length / total
  const priorOut = outFeatures.length / total

  // Calculate feature importance (Fisher scores)
  let featureImportanceJson: string | null = null
  if (shouldCalculateFeatureImportance(total)) {
    const featureImportance = calculateFeatureImportance(inParams, outParams)
    featureImportanceJson = JSON.stringify(featureImportance)
    console.log(
      `[trainModel] Calculated feature importance (top 5): ${featureImportance
        .sort((a, b) => b.fisherScore - a.fisherScore)
        .slice(0, 5)
        .map(f => `${f.featureName}=${f.fisherScore.toFixed(2)}`)
        .join(', ')}`
    )
  }

  // Calculate pooled covariance matrix and its inverse
  let covarianceMatrixJson: string | null = null
  let covarianceInverseJson: string | null = null

  if (inFeatures.length >= 2 && outFeatures.length >= 2) {
    const inSamples: ClassSamples = {
      n: inFeatures.length,
      features: inFeatures,
    }
    const outSamples: ClassSamples = {
      n: outFeatures.length,
      features: outFeatures,
    }

    const covarianceMatrix = computePooledCovariance(inSamples, outSamples)
    const covarianceInverse = invertCovarianceMatrix(covarianceMatrix)

    covarianceMatrixJson = JSON.stringify(covarianceMatrix)
    covarianceInverseJson = JSON.stringify(covarianceInverse)

    console.log(`[trainModel] Computed pooled covariance matrix (26×26 = 676 values)`)
  }

  // Store model in database (26 features = 104 columns + metadata + streaming prediction data)
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
      in_normalized_left_mean, in_normalized_left_std,
      in_normalized_top_mean, in_normalized_top_std,
      in_normalized_right_mean, in_normalized_right_std,
      in_normalized_bottom_mean, in_normalized_bottom_std,
      in_is_roman_mean, in_is_roman_std,
      in_is_hanzi_mean, in_is_hanzi_std,
      in_is_arabic_mean, in_is_arabic_std,
      in_is_korean_mean, in_is_korean_std,
      in_is_hiragana_mean, in_is_hiragana_std,
      in_is_katakana_mean, in_is_katakana_std,
      in_is_cyrillic_mean, in_is_cyrillic_std,
      in_is_devanagari_mean, in_is_devanagari_std,
      in_is_thai_mean, in_is_thai_std,
      in_is_digits_mean, in_is_digits_std,
      in_is_punctuation_mean, in_is_punctuation_std,
      in_time_from_start_mean, in_time_from_start_std,
      in_time_from_end_mean, in_time_from_end_std,
      out_vertical_alignment_mean, out_vertical_alignment_std,
      out_height_similarity_mean, out_height_similarity_std,
      out_anchor_distance_mean, out_anchor_distance_std,
      out_crop_overlap_mean, out_crop_overlap_std,
      out_aspect_ratio_mean, out_aspect_ratio_std,
      out_normalized_y_mean, out_normalized_y_std,
      out_normalized_area_mean, out_normalized_area_std,
      out_user_annotated_in_mean, out_user_annotated_in_std,
      out_user_annotated_out_mean, out_user_annotated_out_std,
      out_normalized_left_mean, out_normalized_left_std,
      out_normalized_top_mean, out_normalized_top_std,
      out_normalized_right_mean, out_normalized_right_std,
      out_normalized_bottom_mean, out_normalized_bottom_std,
      out_is_roman_mean, out_is_roman_std,
      out_is_hanzi_mean, out_is_hanzi_std,
      out_is_arabic_mean, out_is_arabic_std,
      out_is_korean_mean, out_is_korean_std,
      out_is_hiragana_mean, out_is_hiragana_std,
      out_is_katakana_mean, out_is_katakana_std,
      out_is_cyrillic_mean, out_is_cyrillic_std,
      out_is_devanagari_mean, out_is_devanagari_std,
      out_is_thai_mean, out_is_thai_std,
      out_is_digits_mean, out_is_digits_std,
      out_is_punctuation_mean, out_is_punctuation_std,
      out_time_from_start_mean, out_time_from_start_std,
      out_time_from_end_mean, out_time_from_end_std,
      feature_importance,
      covariance_matrix,
      covariance_inverse
    ) VALUES (
      1,
      'naive_bayes_v2',
      datetime('now'),
      ?,
      ?, ?,
      ${Array(104).fill('?').join(', ')},
      ?, ?, ?
    )
  `
  ).run(
    total,
    priorIn,
    priorOut,
    ...inParams.flatMap(p => [p.mean, p.std]),
    ...outParams.flatMap(p => [p.mean, p.std]),
    featureImportanceJson,
    covarianceMatrixJson,
    covarianceInverseJson
  )

  console.log(
    `[trainModel] Model trained successfully: ${inFeatures.length} 'in', ${outFeatures.length} 'out'`
  )

  return total
}
