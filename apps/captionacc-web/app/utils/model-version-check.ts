/**
 * Model version checking and recalculation utilities
 *
 * Detects when box classification model version changes and triggers
 * crop region recalculation + crop region pending review if crop region changed.
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
  crop_region_version: number
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
 * 2. If changed: recalculates crop region using current model
 * 3. If crop region changed: marks affected captions as caption_frame_extents_pending
 * 4. Updates analysis_model_version to current version
 *
 * @param layoutDb - Layout database connection (layout.db)
 * @param captionsDb - Captions database connection (captions.db) - optional, only needed if crop region change
 * @param recalculateFunction - Function to recalculate crop region, returns new crop region or null if no change
 * @returns True if recalculation was performed and crop region changed
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
  cropRegionChanged: boolean
  oldVersion: string | null
  newVersion: string
}> {
  if (!needsRecalculation(layoutDb)) {
    const modelInfo = layoutDb
      .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
      .get() as ModelInfo | undefined
    return {
      recalculated: false,
      cropRegionChanged: false,
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
    `[ModelVersionCheck] Model version changed: ${oldVersion ?? 'null'} → ${newVersion}. Recalculating crop region...`
  )

  // Recalculate crop region
  const newCropRegion = await recalculateFunction()

  if (!newCropRegion) {
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
      cropRegionChanged: false,
      oldVersion,
      newVersion,
    }
  }

  // Check if crop region actually changed
  const cropRegionChanged =
    newCropRegion.crop_left !== oldConfig.crop_left ||
    newCropRegion.crop_top !== oldConfig.crop_top ||
    newCropRegion.crop_right !== oldConfig.crop_right ||
    newCropRegion.crop_bottom !== oldConfig.crop_bottom

  if (!cropRegionChanged) {
    // Crop region didn't change, just update version
    layoutDb
      .prepare(
        `
      UPDATE video_layout_config
      SET analysis_model_version = ?
      WHERE id = 1
    `
      )
      .run(newVersion)

    console.log('[ModelVersionCheck] Recalculated but crop region unchanged')

    return {
      recalculated: true,
      cropRegionChanged: false,
      oldVersion,
      newVersion,
    }
  }

  // Crop region changed - update layout config and mark captions as pending review
  console.log(
    `[ModelVersionCheck] Crop region changed: [${oldConfig.crop_left},${oldConfig.crop_top},${oldConfig.crop_right},${oldConfig.crop_bottom}] → [${newCropRegion.crop_left},${newCropRegion.crop_top},${newCropRegion.crop_right},${newCropRegion.crop_bottom}]`
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
      crop_region_version = crop_region_version + 1,
      analysis_model_version = ?,
      updated_at = datetime('now')
    WHERE id = 1
  `
    )
    .run(
      newCropRegion.crop_left,
      newCropRegion.crop_top,
      newCropRegion.crop_right,
      newCropRegion.crop_bottom,
      newVersion
    )

  // Mark all captions as caption_frame_extents_pending (need re-review due to model change)
  if (captionsDb) {
    const result = captionsDb
      .prepare(
        `
      UPDATE captions
      SET caption_frame_extents_pending = 1
      WHERE caption_frame_extents_state != 'gap'
    `
      )
      .run()

    console.log(
      `[ModelVersionCheck] Marked ${result.changes} captions as caption_frame_extents_pending`
    )
  } else {
    console.warn(
      '[ModelVersionCheck] No captions database provided, skipping caption_frame_extents_pending update'
    )
  }

  return {
    recalculated: true,
    cropRegionChanged: true,
    oldVersion,
    newVersion,
  }
}
