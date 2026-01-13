/**
 * Background model version monitoring service
 *
 * Periodically checks all videos for model version mismatches and
 * triggers recalculation + review marking when needed.
 *
 * Uses split database architecture:
 * - layout.db: video_layout_config, full_frame_box_labels, box_classification_model
 * - captions.db: captions table
 */

import { existsSync } from 'fs'
import { resolve } from 'path'

import Database from 'better-sqlite3'

import { getAllVideos } from '~/utils/video-paths'

interface RecalculationResult {
  videoId: string
  displayPath: string
  recalculated: boolean
  cropRegionChanged: boolean
  oldVersion: string | null
  newVersion: string
  error?: string
}

/**
 * Calculate new crop region from 'in' boxes
 */
function updateCropRegionFromBoxes(
  layoutDb: Database.Database
): { crop_left: number; crop_top: number; crop_right: number; crop_bottom: number } | null {
  // Get predicted 'in' boxes
  const inBoxes = layoutDb
    .prepare(
      `
      SELECT box_left, box_top, box_right, box_bottom
      FROM full_frame_box_labels
      WHERE predicted_label = 'in'
    `
    )
    .all() as Array<{ box_left: number; box_top: number; box_right: number; box_bottom: number }>

  // Fallback to user-annotated 'in' boxes if no predictions
  if (inBoxes.length === 0) {
    const userInBoxes = layoutDb
      .prepare(
        `
        SELECT box_left, box_top, box_right, box_bottom
        FROM full_frame_box_labels
        WHERE label = 'in'
      `
      )
      .all() as Array<{
      box_left: number
      box_top: number
      box_right: number
      box_bottom: number
    }>

    if (userInBoxes.length === 0) {
      return null
    }

    inBoxes.push(...userInBoxes)
  }

  return {
    crop_left: Math.min(...inBoxes.map(b => b.box_left)),
    crop_top: Math.min(...inBoxes.map(b => b.box_top)),
    crop_right: Math.max(...inBoxes.map(b => b.box_right)),
    crop_bottom: Math.max(...inBoxes.map(b => b.box_bottom)),
  }
}

/**
 * Update crop region in layout.db and mark captions as pending review in captions.db
 */
function updateCropRegionAndMarkPending(
  layoutDb: Database.Database,
  captionsDb: Database.Database | null,
  newCropRegion: { crop_left: number; crop_top: number; crop_right: number; crop_bottom: number },
  currentVersion: string
): void {
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
      currentVersion
    )

  if (captionsDb) {
    captionsDb
      .prepare(
        `
      UPDATE captions
      SET caption_frame_extents_pending = 1
      WHERE caption_frame_extents_state != 'gap'
    `
      )
      .run()
  }
}

interface VideoModelInfo {
  analysisVersion: string | null
  currentVersion: string
  oldCropRegion: {
    crop_left: number
    crop_top: number
    crop_right: number
    crop_bottom: number
  } | null
}

interface RecalculationDecision {
  shouldRecalculate: boolean
  reason: 'up_to_date' | 'never_calculated' | 'version_changed'
}

/**
 * Query video model version and layout info from layout database
 */
function getVideoModelInfo(layoutDb: Database.Database): VideoModelInfo | null {
  const layoutConfig = layoutDb
    .prepare(
      'SELECT analysis_model_version, crop_left, crop_top, crop_right, crop_bottom FROM video_layout_config WHERE id = 1'
    )
    .get() as {
    analysis_model_version: string | null
    crop_left: number
    crop_top: number
    crop_right: number
    crop_bottom: number
  } | null

  const modelInfo = layoutDb
    .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
    .get() as { model_version: string } | undefined

  return {
    analysisVersion: layoutConfig?.analysis_model_version ?? null,
    currentVersion: modelInfo?.model_version ?? 'unknown',
    oldCropRegion: layoutConfig
      ? {
          crop_left: layoutConfig.crop_left,
          crop_top: layoutConfig.crop_top,
          crop_right: layoutConfig.crop_right,
          crop_bottom: layoutConfig.crop_bottom,
        }
      : null,
  }
}

/**
 * Determine if predictions need recalculation based on version comparison
 */
function shouldRecalculatePredictions(
  analysisVersion: string | null,
  currentVersion: string
): RecalculationDecision {
  if (analysisVersion === null) {
    return { shouldRecalculate: true, reason: 'never_calculated' }
  }

  if (analysisVersion !== currentVersion) {
    return { shouldRecalculate: true, reason: 'version_changed' }
  }

  return { shouldRecalculate: false, reason: 'up_to_date' }
}

/**
 * Update model version without changing crop region
 */
function updateModelVersionOnly(layoutDb: Database.Database, currentVersion: string): void {
  layoutDb
    .prepare('UPDATE video_layout_config SET analysis_model_version = ? WHERE id = 1')
    .run(currentVersion)
}

/**
 * Check if region has changed
 */
function hasCropRegionChanged(
  oldCropRegion: { crop_left: number; crop_top: number; crop_right: number; crop_bottom: number },
  newCropRegion: { crop_left: number; crop_top: number; crop_right: number; crop_bottom: number }
): boolean {
  return (
    newCropRegion.crop_left !== oldCropRegion.crop_left ||
    newCropRegion.crop_top !== oldCropRegion.crop_top ||
    newCropRegion.crop_right !== oldCropRegion.crop_right ||
    newCropRegion.crop_bottom !== oldCropRegion.crop_bottom
  )
}

/**
 * Build a RecalculationResult object
 */
function buildResult(
  videoId: string,
  displayPath: string,
  recalculated: boolean,
  cropRegionChanged: boolean,
  oldVersion: string | null,
  newVersion: string,
  error?: string
): RecalculationResult {
  return { videoId, displayPath, recalculated, cropRegionChanged, oldVersion, newVersion, error }
}

/**
 * Check a single video for model version mismatch
 * Uses split databases: layout.db for layout tables, captions.db for captions table
 */
function checkVideoModelVersion(
  videoId: string,
  displayPath: string,
  videoDir: string
): RecalculationResult | null {
  const layoutDbPath = resolve(videoDir, 'layout.db')
  const captionsDbPath = resolve(videoDir, 'captions.db')

  // Check if layout.db exists
  if (!existsSync(layoutDbPath)) {
    return null // No layout database yet
  }

  let layoutDb: Database.Database | null = null
  let captionsDb: Database.Database | null = null

  try {
    layoutDb = new Database(layoutDbPath)

    const videoInfo = getVideoModelInfo(layoutDb)
    if (!videoInfo) {
      layoutDb.close()
      return null
    }

    const { analysisVersion, currentVersion, oldCropRegion } = videoInfo
    const decision = shouldRecalculatePredictions(analysisVersion, currentVersion)

    if (!decision.shouldRecalculate) {
      layoutDb.close()
      return buildResult(videoId, displayPath, false, false, analysisVersion, currentVersion)
    }

    if (!oldCropRegion) {
      layoutDb.close()
      return buildResult(
        videoId,
        displayPath,
        false,
        false,
        analysisVersion,
        currentVersion,
        'No layout config found'
      )
    }

    const newCropRegion = updateCropRegionFromBoxes(layoutDb)

    if (!newCropRegion) {
      updateModelVersionOnly(layoutDb, currentVersion)
      layoutDb.close()
      return buildResult(videoId, displayPath, true, false, analysisVersion, currentVersion)
    }

    const cropRegionChanged = hasCropRegionChanged(oldCropRegion, newCropRegion)

    if (!cropRegionChanged) {
      updateModelVersionOnly(layoutDb, currentVersion)
      layoutDb.close()
      return buildResult(videoId, displayPath, true, false, analysisVersion, currentVersion)
    }

    // Bounds changed - need to update both databases
    // Open captions.db if it exists
    if (existsSync(captionsDbPath)) {
      captionsDb = new Database(captionsDbPath)
    }

    updateCropRegionAndMarkPending(layoutDb, captionsDb, newCropRegion, currentVersion)

    layoutDb.close()
    if (captionsDb) {
      captionsDb.close()
    }

    return buildResult(videoId, displayPath, true, true, analysisVersion, currentVersion)
  } catch (error) {
    if (layoutDb) {
      try {
        layoutDb.close()
      } catch {
        /* ignore */
      }
    }
    if (captionsDb) {
      try {
        captionsDb.close()
      } catch {
        /* ignore */
      }
    }
    return buildResult(
      videoId,
      displayPath,
      false,
      false,
      null,
      'unknown',
      error instanceof Error ? error.message : String(error)
    )
  }
}

/**
 * Run model version check across all videos
 */
export async function runModelVersionCheck(): Promise<{
  total: number
  upToDate: number
  recalculated: number
  cropRegionChanged: number
  errors: number
  changedVideos: Array<{ displayPath: string; oldVersion: string | null; newVersion: string }>
}> {
  const videos = await getAllVideos()
  const results: RecalculationResult[] = []

  console.log(
    `[ModelVersionMonitor] Checking ${videos.length} videos for missing/outdated layout analysis...`
  )

  for (const video of videos) {
    const videoDir = `${process.cwd()}/../../local/processing/${video.storagePath}`
    const result = checkVideoModelVersion(video.videoId, video.displayPath, videoDir)

    if (result) {
      results.push(result)

      if (result.cropRegionChanged) {
        const action = result.oldVersion === null ? 'Initial calculation' : 'Recalculated'
        console.log(
          `[ModelVersionMonitor] ${result.displayPath}: ${action} (${result.oldVersion ?? 'null'} → ${result.newVersion})`
        )
      }
    }
  }

  const stats = {
    total: results.length,
    upToDate: results.filter(r => !r.recalculated).length,
    recalculated: results.filter(r => r.recalculated).length,
    cropRegionChanged: results.filter(r => r.cropRegionChanged).length,
    errors: results.filter(r => r.error).length,
    changedVideos: results
      .filter(r => r.cropRegionChanged)
      .map(r => ({
        displayPath: r.displayPath,
        oldVersion: r.oldVersion,
        newVersion: r.newVersion,
      })),
  }

  console.log(
    `[ModelVersionMonitor] Complete: ${stats.upToDate} up-to-date, ` +
      `${stats.recalculated} recalculated, ${stats.cropRegionChanged} crop region changed, ` +
      `${stats.errors} errors`
  )

  return stats
}

/**
 * Start periodic model version monitoring
 * Runs check every interval (default: 1 hour)
 */
export function startModelVersionMonitor(intervalMs: number = 60 * 60 * 1000) {
  console.log(
    `[ModelVersionMonitor] Starting periodic checks every ${intervalMs / 1000 / 60} minutes`
  )

  // Run immediately on start
  runModelVersionCheck().catch(error => {
    console.error('[ModelVersionMonitor] Error in initial check:', error)
  })

  // Then run periodically
  setInterval(() => {
    runModelVersionCheck().catch(error => {
      console.error('[ModelVersionMonitor] Error in periodic check:', error)
    })
  }, intervalMs)
}
