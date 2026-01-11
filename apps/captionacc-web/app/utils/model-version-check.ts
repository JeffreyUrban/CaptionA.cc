/**
 * Model version checking and recalculation utilities
 *
 * Detects when box classification model version changes and triggers
 * crop bounds recalculation + boundary pending review if bounds changed.
 *
 * Uses split database architecture:
 * - layoutDb: video_layout_config, box_classification_model
 * - captionsDb: captions table
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
 * Check if model version has changed since last analysis
 * Returns true if recalculation is needed
 *
 * @param layoutDb - Layout database connection (layout.db)
 */
export function needsRecalculation(layoutDb: Database.Database): boolean {
  try {
    // Get current layout config
    const layoutConfig = layoutDb
      .prepare('SELECT analysis_model_version FROM video_layout_config WHERE id = 1')
      .get() as { analysis_model_version: string | null } | undefined

    if (!layoutConfig) {
      // No layout config yet, no recalculation needed
      return false
    }

    // Get current model version
    const modelInfo = layoutDb
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
 * @param layoutDb - Layout database connection (layout.db)
 * @param captionsDb - Captions database connection (captions.db) - optional, only needed if bounds change
 * @param recalculateFunction - Function to recalculate crop bounds, returns new bounds or null if no change
 * @returns True if recalculation was performed and bounds changed
 */
export async function checkAndRecalculate(
  layoutDb: Database.Database,
  captionsDb: Database.Database | null,
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
  if (!needsRecalculation(layoutDb)) {
    const modelInfo = layoutDb
      .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
      .get() as ModelInfo | undefined
    return {
      recalculated: false,
      boundsChanged: false,
      oldVersion: modelInfo?.model_version ?? null,
      newVersion: modelInfo?.model_version ?? 'unknown',
    }
  }

  // Get old config
  const oldConfig = layoutDb
    .prepare(
      'SELECT crop_left, crop_top, crop_right, crop_bottom, analysis_model_version FROM video_layout_config WHERE id = 1'
    )
    .get() as LayoutConfig | undefined

  if (!oldConfig) {
    throw new Error('No layout config found')
  }

  const oldVersion = oldConfig.analysis_model_version

  // Get current model version
  const modelInfo = layoutDb
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
    layoutDb
      .prepare(
        `
      UPDATE video_layout_config
      SET analysis_model_version = ?
      WHERE id = 1
    `
      )
      .run(newVersion)

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
    layoutDb
      .prepare(
        `
      UPDATE video_layout_config
      SET analysis_model_version = ?
      WHERE id = 1
    `
      )
      .run(newVersion)

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

  layoutDb
    .prepare(
      `
    UPDATE video_layout_config
    SET
      crop_left = ?,
      crop_top = ?,
      crop_right = ?,
      crop_bottom = ?,
      crop_bounds_version = crop_bounds_version + 1,
      analysis_model_version = ?,
      updated_at = datetime('now')
    WHERE id = 1
  `
    )
    .run(
      newBounds.crop_left,
      newBounds.crop_top,
      newBounds.crop_right,
      newBounds.crop_bottom,
      newVersion
    )

  // Mark all captions as boundary_pending (need re-review due to model change)
  if (captionsDb) {
    const result = captionsDb
      .prepare(
        `
      UPDATE captions
      SET boundary_pending = 1
      WHERE boundary_state != 'gap'
    `
      )
      .run()

    console.log(`[ModelVersionCheck] Marked ${result.changes} captions as boundary_pending`)
  } else {
    console.warn(
      '[ModelVersionCheck] No captions database provided, skipping boundary_pending update'
    )
  }

  return {
    recalculated: true,
    boundsChanged: true,
    oldVersion,
    newVersion,
  }
}
