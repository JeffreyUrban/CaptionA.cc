/**
 * Model version checking and recalculation utilities
 *
 * Detects when box classification model version changes and triggers
 * crop bounds recalculation + boundary pending review if bounds changed.
 */

import Database from 'better-sqlite3'

interface LayoutConfig {
  crop_left: number
  crop_top: number
  crop_right: number
  crop_bottom: number
  analysis_model_version: string | null
  crop_bounds_version: number
}

interface ModelInfo {
  model_version: string
}

/**
 * Append a new layout config row with updated values (append-only for history)
 */
function appendLayoutConfig(
  db: Database.Database,
  updates: {
    cropBounds?: { crop_left: number; crop_top: number; crop_right: number; crop_bottom: number }
    analysisModelVersion?: string
    incrementVersion?: boolean
  }
): void {
  // Get current config
  const current = db
    .prepare('SELECT * FROM video_layout_config ORDER BY created_at DESC LIMIT 1')
    .get() as Record<string, unknown> | undefined

  if (!current) {
    return // No config to update
  }

  const newCropLeft = updates.cropBounds?.crop_left ?? (current['crop_left'] as number)
  const newCropTop = updates.cropBounds?.crop_top ?? (current['crop_top'] as number)
  const newCropRight = updates.cropBounds?.crop_right ?? (current['crop_right'] as number)
  const newCropBottom = updates.cropBounds?.crop_bottom ?? (current['crop_bottom'] as number)
  const newVersion = updates.incrementVersion
    ? (current['crop_bounds_version'] as number) + 1
    : current['crop_bounds_version']
  const newAnalysisVersion = updates.analysisModelVersion ?? current['analysis_model_version']

  db.prepare(
    `INSERT INTO video_layout_config (
      frame_width, frame_height,
      crop_left, crop_top, crop_right, crop_bottom,
      selection_left, selection_top, selection_right, selection_bottom,
      selection_mode,
      vertical_position, vertical_std, box_height, box_height_std,
      anchor_type, anchor_position, top_edge_std, bottom_edge_std,
      horizontal_std_slope, horizontal_std_intercept,
      crop_bounds_version, analysis_model_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    current['frame_width'],
    current['frame_height'],
    newCropLeft,
    newCropTop,
    newCropRight,
    newCropBottom,
    current['selection_left'],
    current['selection_top'],
    current['selection_right'],
    current['selection_bottom'],
    current['selection_mode'],
    current['vertical_position'],
    current['vertical_std'],
    current['box_height'],
    current['box_height_std'],
    current['anchor_type'],
    current['anchor_position'],
    current['top_edge_std'],
    current['bottom_edge_std'],
    current['horizontal_std_slope'],
    current['horizontal_std_intercept'],
    newVersion,
    newAnalysisVersion
  )
}

/**
 * Check if model version has changed since last analysis
 * Returns true if recalculation is needed
 */
export function needsRecalculation(db: Database.Database): boolean {
  try {
    // Get current layout config (most recent row)
    const layoutConfig = db
      .prepare(
        'SELECT analysis_model_version FROM video_layout_config ORDER BY created_at DESC LIMIT 1'
      )
      .get() as { analysis_model_version: string | null } | undefined

    if (!layoutConfig) {
      // No layout config yet, no recalculation needed
      return false
    }

    // Get current model version
    const modelInfo = db
      .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
      .get() as ModelInfo | undefined

    const currentModelVersion = modelInfo?.model_version ?? null

    // Need recalculation if:
    // 1. No analysis_model_version recorded (old database)
    // 2. Model version has changed
    return (
      layoutConfig.analysis_model_version === null ||
      layoutConfig.analysis_model_version !== currentModelVersion
    )
  } catch (error) {
    console.error('[ModelVersionCheck] Error checking model version:', error)
    return false
  }
}

/**
 * Check model version and trigger recalculation if needed
 *
 * This function:
 * 1. Checks if model version has changed
 * 2. If changed: recalculates crop bounds using current model
 * 3. If bounds changed: marks affected captions as boundary_pending
 * 4. Updates analysis_model_version to current version
 *
 * @param db - Database connection
 * @param recalculateFunction - Function to recalculate crop bounds, returns new bounds or null if no change
 * @returns True if recalculation was performed and bounds changed
 */
export async function checkAndRecalculate(
  db: Database.Database,
  recalculateFunction: () => Promise<{
    crop_left: number
    crop_top: number
    crop_right: number
    crop_bottom: number
  } | null>
): Promise<{
  recalculated: boolean
  boundsChanged: boolean
  oldVersion: string | null
  newVersion: string
}> {
  if (!needsRecalculation(db)) {
    const modelInfo = db
      .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
      .get() as ModelInfo | undefined
    return {
      recalculated: false,
      boundsChanged: false,
      oldVersion: modelInfo?.model_version ?? null,
      newVersion: modelInfo?.model_version ?? 'unknown',
    }
  }

  // Get old config (most recent row)
  const oldConfig = db
    .prepare(
      'SELECT crop_left, crop_top, crop_right, crop_bottom, analysis_model_version FROM video_layout_config ORDER BY created_at DESC LIMIT 1'
    )
    .get() as LayoutConfig | undefined

  if (!oldConfig) {
    throw new Error('No layout config found')
  }

  const oldVersion = oldConfig.analysis_model_version

  // Get current model version
  const modelInfo = db
    .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
    .get() as ModelInfo | undefined

  const newVersion = modelInfo?.model_version ?? 'unknown'

  console.log(
    `[ModelVersionCheck] Model version changed: ${oldVersion ?? 'null'} → ${newVersion}. Recalculating crop bounds...`
  )

  // Recalculate crop bounds
  const newBounds = await recalculateFunction()

  if (!newBounds) {
    // Recalculation returned no change, just update version
    appendLayoutConfig(db, { analysisModelVersion: newVersion })

    return {
      recalculated: true,
      boundsChanged: false,
      oldVersion,
      newVersion,
    }
  }

  // Check if bounds actually changed
  const boundsChanged =
    newBounds.crop_left !== oldConfig.crop_left ||
    newBounds.crop_top !== oldConfig.crop_top ||
    newBounds.crop_right !== oldConfig.crop_right ||
    newBounds.crop_bottom !== oldConfig.crop_bottom

  if (!boundsChanged) {
    // Bounds didn't change, just update version
    appendLayoutConfig(db, { analysisModelVersion: newVersion })

    console.log('[ModelVersionCheck] Recalculated but bounds unchanged')

    return {
      recalculated: true,
      boundsChanged: false,
      oldVersion,
      newVersion,
    }
  }

  // Bounds changed - update layout config and mark captions as pending review
  console.log(
    `[ModelVersionCheck] Bounds changed: [${oldConfig.crop_left},${oldConfig.crop_top},${oldConfig.crop_right},${oldConfig.crop_bottom}] → [${newBounds.crop_left},${newBounds.crop_top},${newBounds.crop_right},${newBounds.crop_bottom}]`
  )

  appendLayoutConfig(db, {
    cropBounds: newBounds,
    analysisModelVersion: newVersion,
    incrementVersion: true,
  })

  // Mark all captions as boundary_pending (need re-review due to model change)
  const result = db
    .prepare(
      `
    UPDATE captions
    SET boundary_pending = 1
    WHERE boundary_state != 'gap'
  `
    )
    .run()

  console.log(`[ModelVersionCheck] Marked ${result.changes} captions as boundary_pending`)

  return {
    recalculated: true,
    boundsChanged: true,
    oldVersion,
    newVersion,
  }
}
