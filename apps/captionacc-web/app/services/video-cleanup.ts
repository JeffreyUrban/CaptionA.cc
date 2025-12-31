/**
 * Video cleanup service
 *
 * Handles:
 * 1. Cleanup of videos marked for deletion
 * 2. Detection and recovery of stale processing jobs
 * 3. Detection of duplicate video hashes (alerts only, no auto-delete)
 *
 * Runs on server startup and periodically (hourly)
 *
 * TODO: Remove compatibility checks for old database schemas (PRAGMA table_info)
 *       after all existing videos have been re-uploaded or migrated to new schema.
 *       Old databases don't have: deleted, processing_attempts, last_heartbeat_at columns.
 */

import { existsSync, readdirSync } from 'fs'
import { rm } from 'fs/promises'
import { resolve } from 'path'

import Database from 'better-sqlite3'

import { queueVideoProcessing } from './video-processing'

import { getAllVideos, getDbPath, getVideoDir } from '~/utils/video-paths'

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
const MAX_PROCESSING_ATTEMPTS = 3 // Max retries before marking as error
const PROCESSING_STATES = ['extracting_frames', 'running_ocr', 'analyzing_layout'] as const

let cleanupTimer: NodeJS.Timeout | null = null

interface DeletedVideo {
  displayPath: string
  videoDir: string
  pid: string | null
  videoId: string
}

/**
 * Find all videos marked for deletion
 */
async function findDeletedVideos(): Promise<DeletedVideo[]> {
  const deletedVideos: DeletedVideo[] = []

  // Get all videos and check for deletion flag
  const allVideos = getAllVideos()

  for (const video of allVideos) {
    const dbPath = getDbPath(video.videoId)
    const videoDir = getVideoDir(video.videoId)

    if (!dbPath || !videoDir) continue

    try {
      const db = new Database(dbPath, { readonly: true })
      try {
        // Check if deleted column exists (newer databases only)
        const tableInfo = db.prepare(`PRAGMA table_info(processing_status)`).all() as Array<{
          name: string
        }>
        const hasDeletedColumn = tableInfo.some(col => col.name === 'deleted')

        if (hasDeletedColumn) {
          const status = db
            .prepare(
              `
            SELECT deleted, current_job_id
            FROM processing_status
            WHERE id = 1 AND deleted = 1
          `
            )
            .get() as { deleted: number; current_job_id: string | null } | undefined

          if (status?.deleted === 1) {
            deletedVideos.push({
              displayPath: video.displayPath,
              videoDir,
              pid: status.current_job_id,
              videoId: video.videoId,
            })
            console.log(`[Cleanup] Found deleted video: ${video.displayPath}`)
          }
        }
      } finally {
        db.close()
      }
    } catch (error) {
      console.error(`[Cleanup] Error checking ${video.displayPath}:`, error)
    }
  }

  return deletedVideos
}

/**
 * Cleanup a single deleted video
 */
async function cleanupDeletedVideo(video: DeletedVideo): Promise<void> {
  const { displayPath, videoDir, pid } = video

  console.log(`[Cleanup] Processing: ${displayPath}`)

  // Kill processing job if running
  if (pid) {
    try {
      const pidNum = parseInt(pid)
      process.kill(pidNum, 'SIGTERM')
      console.log(`[Cleanup] Killed processing job PID: ${pidNum}`)

      // Wait for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Force kill if still running
      try {
        process.kill(pidNum, 'SIGKILL')
      } catch {
        // Already dead
      }
    } catch {
      console.log(`[Cleanup] Process ${pid} already terminated`)
    }
  }

  // Delete the video directory
  try {
    if (existsSync(videoDir)) {
      await rm(videoDir, { recursive: true, force: true })
      console.log(`[Cleanup] Deleted files for: ${displayPath}`)
    }
  } catch (error) {
    console.error(`[Cleanup] Failed to delete ${displayPath}:`, error)
  }
}

/**
 * Check if a process is still running
 */
function isProcessRunning(pid: string): boolean {
  try {
    const pidNum = parseInt(pid)
    // Signal 0 checks if process exists without actually sending a signal
    process.kill(pidNum, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Find videos stuck in processing states
 */
async function findStaleProcessing(): Promise<
  Array<{
    displayPath: string
    videoDir: string
    videoFile: string
    pid: string | null
    attempts: number
    videoId: string
  }>
> {
  const staleVideos: Array<{
    displayPath: string
    videoDir: string
    videoFile: string
    pid: string | null
    attempts: number
    videoId: string
  }> = []

  // Get all videos and check for stale processing
  const allVideos = getAllVideos()

  for (const video of allVideos) {
    const dbPath = getDbPath(video.videoId)
    const videoDir = getVideoDir(video.videoId)

    if (!dbPath || !videoDir) continue

    try {
      const db = new Database(dbPath, { readonly: true })
      try {
        // Check if required columns exist (newer databases only)
        const tableInfo = db.prepare(`PRAGMA table_info(processing_status)`).all() as Array<{
          name: string
        }>
        const hasProcessingAttemptsColumn = tableInfo.some(
          col => col.name === 'processing_attempts'
        )
        const hasDeletedColumn = tableInfo.some(col => col.name === 'deleted')

        if (!hasProcessingAttemptsColumn) {
          // Old database schema - skip stale processing check
          continue
        }

        const status = db
          .prepare(
            `
          SELECT status, current_job_id, processing_attempts${hasDeletedColumn ? ', deleted' : ''}
          FROM processing_status
          WHERE id = 1
        `
          )
          .get() as
          | {
              status: string
              current_job_id: string | null
              processing_attempts: number
              deleted?: number
            }
          | undefined

        // Skip if deleted or not in processing state
        if (!status || status.deleted === 1) {
          continue
        }

        // Check if stuck in processing state
        if (PROCESSING_STATES.includes(status.status as (typeof PROCESSING_STATES)[number])) {
          const pid = status.current_job_id
          const isRunning = pid ? isProcessRunning(pid) : false

          if (!isRunning) {
            // Process is not running but status says processing - this is stale
            const videoFile = resolve(videoDir, video.originalFilename)
            if (existsSync(videoFile)) {
              staleVideos.push({
                displayPath: video.displayPath,
                videoDir,
                videoFile,
                pid,
                attempts: status.processing_attempts,
                videoId: video.videoId,
              })
              console.log(
                `[Cleanup] Found stale processing: ${video.displayPath} (PID: ${pid ?? 'none'}, attempts: ${status.processing_attempts})`
              )
            }
          }
        }
      } finally {
        db.close()
      }
    } catch (error) {
      console.error(`[Cleanup] Error checking ${video.displayPath}:`, error)
    }
  }

  return staleVideos
}

/**
 * Recover a stale processing job
 */
async function recoverStaleProcessing(video: {
  displayPath: string
  videoDir: string
  videoFile: string
  attempts: number
  videoId: string
}): Promise<void> {
  const { displayPath, videoDir, videoFile, attempts, videoId } = video

  // Check if exceeded max attempts
  if (attempts >= MAX_PROCESSING_ATTEMPTS) {
    console.log(`[Cleanup] Max attempts reached for ${displayPath}, marking as error`)

    const dbPath = resolve(videoDir, 'annotations.db')
    const db = new Database(dbPath)
    try {
      db.prepare(
        `
        UPDATE processing_status
        SET status = 'error',
            error_message = ?,
            error_details = ?,
            error_occurred_at = datetime('now'),
            current_job_id = NULL
        WHERE id = 1
      `
      ).run(
        `Processing failed after ${attempts} attempts (server restarts or crashes)`,
        JSON.stringify({ reason: 'max_attempts_exceeded', attempts })
      )
    } finally {
      db.close()
    }
    return
  }

  // Restart processing (queue to respect concurrency limits)
  console.log(
    `[Cleanup] Queueing ${displayPath} for processing restart (attempt ${attempts + 1}/${MAX_PROCESSING_ATTEMPTS})`
  )

  try {
    queueVideoProcessing({
      videoPath: displayPath,
      videoFile,
      videoId,
    })
    console.log(`[Cleanup] Successfully queued ${displayPath} for processing restart`)
  } catch (error) {
    console.error(`[Cleanup] Failed to restart processing for ${displayPath}:`, error)

    // Mark as error
    const dbPath = resolve(videoDir, 'annotations.db')
    const db = new Database(dbPath)
    try {
      db.prepare(
        `
        UPDATE processing_status
        SET status = 'error',
            error_message = ?,
            error_details = ?,
            error_occurred_at = datetime('now'),
            current_job_id = NULL
        WHERE id = 1
      `
      ).run(
        `Failed to restart processing: ${error instanceof Error ? error.message : 'Unknown error'}`,
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown',
          attempts: attempts + 1,
        })
      )
    } finally {
      db.close()
    }
  }
}

/**
 * Clean up orphaned crop_frames directories
 * Removes crop_frames directories that contain files when processing is complete/error
 */
async function cleanupOrphanedCropFrames(): Promise<number> {
  let cleanedCount = 0
  const allVideos = getAllVideos()

  for (const video of allVideos) {
    const videoDir = getVideoDir(video.videoId)
    const dbPath = getDbPath(video.videoId)

    if (!videoDir || !dbPath) continue

    const cropFramesDir = resolve(videoDir, 'crop_frames')

    // Skip if crop_frames directory doesn't exist
    if (!existsSync(cropFramesDir)) continue

    // Check if there are any frame files in the directory
    const frameFiles = readdirSync(cropFramesDir).filter(f => f.endsWith('.jpg'))
    if (frameFiles.length === 0) continue

    try {
      const db = new Database(dbPath, { readonly: true })
      try {
        // Check crop_frames_status
        const status = db
          .prepare(
            `
          SELECT status FROM crop_frames_status WHERE id = 1
        `
          )
          .get() as { status: string } | undefined

        // Clean up frames if processing is complete or error
        // (frames should have been written to database and deleted)
        if (status && (status.status === 'complete' || status.status === 'error')) {
          console.log(
            `[Cleanup] Found ${frameFiles.length} orphaned frames in ${video.displayPath}/crop_frames`
          )

          // Delete all frame files
          for (const frameFile of frameFiles) {
            const framePath = resolve(cropFramesDir, frameFile)
            try {
              await rm(framePath)
            } catch (error) {
              console.error(`[Cleanup] Failed to delete ${framePath}:`, error)
            }
          }

          // Try to remove empty directory
          if (readdirSync(cropFramesDir).length === 0) {
            await rm(cropFramesDir, { recursive: true, force: true })
            console.log(`[Cleanup] Removed empty crop_frames directory for ${video.displayPath}`)
          }

          cleanedCount++
        }
      } finally {
        db.close()
      }
    } catch (error) {
      console.error(`[Cleanup] Error cleaning crop_frames for ${video.displayPath}:`, error)
    }
  }

  return cleanedCount
}

/**
 * Check for duplicate video hashes (alerts only, does not auto-delete)
 *
 * Detects videos with identical video_hash values, which indicates
 * duplicate uploads or migration issues. Logs warnings for manual review.
 */
async function checkDuplicateVideoHashes(): Promise<number> {
  const hashGroups = new Map<string, Array<{ videoId: string; displayPath: string }>>()

  const allVideos = getAllVideos()

  for (const video of allVideos) {
    const dbPath = getDbPath(video.videoId)
    if (!dbPath || !existsSync(dbPath)) continue

    try {
      const db = new Database(dbPath, { readonly: true })
      try {
        // Get video hash
        const result = db
          .prepare(
            `
          SELECT video_hash, display_path
          FROM video_metadata
          WHERE id = 1
        `
          )
          .get() as { video_hash: string; display_path: string } | undefined

        if (result?.video_hash && result.video_hash !== '') {
          // Group by hash
          const existing = hashGroups.get(result.video_hash) ?? []
          existing.push({
            videoId: video.videoId,
            displayPath: result.display_path,
          })
          hashGroups.set(result.video_hash, existing)
        }
      } finally {
        db.close()
      }
    } catch {
      // Skip videos with old schema or errors
    }
  }

  // Find and report duplicates
  let duplicateCount = 0
  for (const [hash, videos] of hashGroups.entries()) {
    if (videos.length > 1) {
      duplicateCount++
      console.warn(`[Cleanup] ⚠️  DUPLICATE VIDEO HASH DETECTED:`)
      console.warn(`  Hash: ${hash}`)
      console.warn(`  Found in ${videos.length} videos:`)
      for (const video of videos) {
        console.warn(`    - ${video.displayPath} (${video.videoId})`)
      }
      console.warn(
        `  Action required: Review and delete duplicates manually or use deduplication script`
      )
    }
  }

  return duplicateCount
}

/**
 * Run cleanup process - find and cleanup deleted videos, recover stale processing, cleanup orphaned frames
 */
export async function runCleanup(): Promise<void> {
  console.log('[Cleanup] Starting cleanup scan...')

  try {
    // 1. Cleanup deleted videos
    const deletedVideos = await findDeletedVideos()
    if (deletedVideos.length > 0) {
      console.log(`[Cleanup] Found ${deletedVideos.length} deleted video(s)`)
      for (const video of deletedVideos) {
        await cleanupDeletedVideo(video)
      }
    }

    // 2. Recover stale processing
    const staleVideos = await findStaleProcessing()
    if (staleVideos.length > 0) {
      console.log(`[Cleanup] Found ${staleVideos.length} stale processing job(s)`)
      for (const video of staleVideos) {
        await recoverStaleProcessing(video)
      }
    }

    // 3. Cleanup orphaned crop_frames directories
    const cleanedCropFrames = await cleanupOrphanedCropFrames()
    if (cleanedCropFrames > 0) {
      console.log(`[Cleanup] Cleaned up ${cleanedCropFrames} orphaned crop_frames directories`)
    }

    // 4. Check for duplicate video hashes
    const duplicateHashes = await checkDuplicateVideoHashes()
    if (duplicateHashes > 0) {
      console.log(
        `[Cleanup] ⚠️  Found ${duplicateHashes} duplicate video hash group(s) - see warnings above`
      )
    }

    if (
      deletedVideos.length === 0 &&
      staleVideos.length === 0 &&
      cleanedCropFrames === 0 &&
      duplicateHashes === 0
    ) {
      console.log('[Cleanup] No cleanup needed')
    } else {
      console.log('[Cleanup] Cleanup complete')
    }
  } catch (error) {
    console.error('[Cleanup] Cleanup failed:', error)
  }
}

/**
 * Start periodic cleanup
 */
export function startPeriodicCleanup(): void {
  if (cleanupTimer) {
    console.log('[Cleanup] Periodic cleanup already running')
    return
  }

  console.log(
    `[Cleanup] Starting periodic cleanup (every ${CLEANUP_INTERVAL_MS / 1000 / 60} minutes)`
  )

  // Run immediately on start
  runCleanup().catch(console.error)

  // Then run periodically
  cleanupTimer = setInterval(() => {
    runCleanup().catch(console.error)
  }, CLEANUP_INTERVAL_MS)
}

/**
 * Stop periodic cleanup
 */
export function stopPeriodicCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
    console.log('[Cleanup] Stopped periodic cleanup')
  }
}
