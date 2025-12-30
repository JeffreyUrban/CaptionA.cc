/**
 * Background model version monitoring service
 *
 * Periodically checks all videos for model version mismatches and
 * triggers recalculation + review marking when needed.
 */

import Database from 'better-sqlite3'

import { getAllVideos } from '~/utils/video-paths'

interface RecalculationResult {
  videoId: string
  displayPath: string
  recalculated: boolean
  boundsChanged: boolean
  oldVersion: string | null
  newVersion: string
  error?: string
}

/**
 * Calculate new crop bounds from 'in' boxes
 */
function calculateBoundsFromBoxes(
  db: Database.Database
): { crop_left: number; crop_top: number; crop_right: number; crop_bottom: number } | null {
  // Get predicted 'in' boxes
  const inBoxes = db
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
    const userInBoxes = db
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
 * Update crop bounds and mark captions as pending review
 */
function updateBoundsAndMarkPending(
  db: Database.Database,
  newBounds: { crop_left: number; crop_top: number; crop_right: number; crop_bottom: number },
  currentVersion: string
): void {
  db.prepare(
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
  ).run(
    newBounds.crop_left,
    newBounds.crop_top,
    newBounds.crop_right,
    newBounds.crop_bottom,
    currentVersion
  )

  db.prepare(
    `
    UPDATE captions
    SET boundary_pending = 1
    WHERE boundary_state != 'gap'
  `
  ).run()
}

/**
 * Check a single video for model version mismatch
 */
function checkVideoModelVersion(dbPath: string): RecalculationResult | null {
  try {
    const db = new Database(dbPath)

    // Get video metadata
    const metadata = db
      .prepare('SELECT video_id, display_path FROM video_metadata WHERE id = 1')
      .get() as { video_id: string; display_path: string } | undefined

    if (!metadata) {
      db.close()
      return null
    }

    // Get current and analysis model versions
    const layoutConfig = db
      .prepare('SELECT analysis_model_version FROM video_layout_config WHERE id = 1')
      .get() as { analysis_model_version: string | null } | undefined

    const modelInfo = db
      .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
      .get() as { model_version: string } | undefined

    const analysisVersion = layoutConfig?.analysis_model_version ?? null
    const currentVersion = modelInfo?.model_version ?? 'unknown'

    // Check if calculation/recalculation needed
    const needsCalculation = analysisVersion === null // Never calculated
    const needsRecalculation = analysisVersion !== null && analysisVersion !== currentVersion // Model changed

    if (!needsCalculation && !needsRecalculation) {
      // Already up to date
      db.close()
      return {
        videoId: metadata.video_id,
        displayPath: metadata.display_path,
        recalculated: false,
        boundsChanged: false,
        oldVersion: analysisVersion,
        newVersion: currentVersion,
      }
    }

    // Get old bounds for comparison
    const oldBounds = db
      .prepare(
        'SELECT crop_left, crop_top, crop_right, crop_bottom FROM video_layout_config WHERE id = 1'
      )
      .get() as
      | { crop_left: number; crop_top: number; crop_right: number; crop_bottom: number }
      | undefined

    if (!oldBounds) {
      db.close()
      return {
        videoId: metadata.video_id,
        displayPath: metadata.display_path,
        recalculated: false,
        boundsChanged: false,
        oldVersion: analysisVersion,
        newVersion: currentVersion,
        error: 'No layout config found',
      }
    }

    // Calculate new bounds from boxes
    const newBounds = calculateBoundsFromBoxes(db)

    if (!newBounds) {
      // No boxes to calculate from - just update version
      db.prepare('UPDATE video_layout_config SET analysis_model_version = ? WHERE id = 1').run(
        currentVersion
      )
      db.close()

      return {
        videoId: metadata.video_id,
        displayPath: metadata.display_path,
        recalculated: true,
        boundsChanged: false,
        oldVersion: analysisVersion,
        newVersion: currentVersion,
      }
    }

    // Check if bounds changed
    const boundsChanged =
      newBounds.crop_left !== oldBounds.crop_left ||
      newBounds.crop_top !== oldBounds.crop_top ||
      newBounds.crop_right !== oldBounds.crop_right ||
      newBounds.crop_bottom !== oldBounds.crop_bottom

    if (!boundsChanged) {
      // Bounds unchanged - just update version
      db.prepare('UPDATE video_layout_config SET analysis_model_version = ? WHERE id = 1').run(
        currentVersion
      )
      db.close()

      return {
        videoId: metadata.video_id,
        displayPath: metadata.display_path,
        recalculated: true,
        boundsChanged: false,
        oldVersion: analysisVersion,
        newVersion: currentVersion,
      }
    }

    // Bounds changed - update config and mark captions pending
    updateBoundsAndMarkPending(db, newBounds, currentVersion)
    db.close()

    return {
      videoId: metadata.video_id,
      displayPath: metadata.display_path,
      recalculated: true,
      boundsChanged: true,
      oldVersion: analysisVersion,
      newVersion: currentVersion,
    }
  } catch (error) {
    return {
      videoId: 'unknown',
      displayPath: dbPath,
      recalculated: false,
      boundsChanged: false,
      oldVersion: null,
      newVersion: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Run model version check across all videos
 */
export async function runModelVersionCheck(): Promise<{
  total: number
  upToDate: number
  recalculated: number
  boundsChanged: number
  errors: number
  changedVideos: Array<{ displayPath: string; oldVersion: string | null; newVersion: string }>
}> {
  const videos = getAllVideos()
  const results: RecalculationResult[] = []

  console.log(
    `[ModelVersionMonitor] Checking ${videos.length} videos for missing/outdated layout analysis...`
  )

  for (const video of videos) {
    const dbPath = `${process.cwd()}/../../local/data/${video.storagePath}/annotations.db`
    const result = checkVideoModelVersion(dbPath)

    if (result) {
      results.push(result)

      if (result.boundsChanged) {
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
    boundsChanged: results.filter(r => r.boundsChanged).length,
    errors: results.filter(r => r.error).length,
    changedVideos: results
      .filter(r => r.boundsChanged)
      .map(r => ({
        displayPath: r.displayPath,
        oldVersion: r.oldVersion,
        newVersion: r.newVersion,
      })),
  }

  console.log(
    `[ModelVersionMonitor] Complete: ${stats.upToDate} up-to-date, ` +
      `${stats.recalculated} recalculated, ${stats.boundsChanged} bounds changed, ` +
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
