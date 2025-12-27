/**
 * Video cleanup service
 *
 * Handles:
 * 1. Cleanup of videos marked for deletion
 * 2. Detection and recovery of stale processing jobs
 *
 * Runs on server startup and periodically (hourly)
 *
 * TODO: Remove compatibility checks for old database schemas (PRAGMA table_info)
 *       after all existing videos have been re-uploaded or migrated to new schema.
 *       Old databases don't have: deleted, processing_attempts, last_heartbeat_at columns.
 */

import { resolve } from 'path'
import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import { rm } from 'fs/promises'
import Database from 'better-sqlite3'
import { triggerVideoProcessing } from './video-processing'

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
const MAX_PROCESSING_ATTEMPTS = 3 // Max retries before marking as error
const PROCESSING_STATES = ['extracting_frames', 'running_ocr', 'analyzing_layout'] as const

let cleanupTimer: NodeJS.Timeout | null = null

interface DeletedVideo {
  videoPath: string
  videoDir: string
  pid: string | null
}

/**
 * Find all videos marked for deletion
 */
async function findDeletedVideos(): Promise<DeletedVideo[]> {
  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')

  if (!existsSync(dataDir)) {
    return []
  }

  const deletedVideos: DeletedVideo[] = []

  // Recursively scan for video directories
  async function scanDir(dir: string, relativePath: string = ''): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true })

      // Check if this directory has an annotations.db
      const hasDb = entries.some(e => e.isFile() && e.name === 'annotations.db')

      if (hasDb) {
        // This is a video directory - check if deleted
        const dbPath = resolve(dir, 'annotations.db')
        try {
          const db = new Database(dbPath, { readonly: true })
          try {
            // Check if deleted column exists (newer databases only)
            const tableInfo = db.prepare(`PRAGMA table_info(processing_status)`).all() as Array<{ name: string }>
            const hasDeletedColumn = tableInfo.some(col => col.name === 'deleted')

            if (hasDeletedColumn) {
              const status = db.prepare(`
                SELECT deleted, current_job_id
                FROM processing_status
                WHERE id = 1 AND deleted = 1
              `).get() as { deleted: number; current_job_id: string | null } | undefined

              if (status?.deleted === 1) {
                deletedVideos.push({
                  videoPath: relativePath,
                  videoDir: dir,
                  pid: status.current_job_id
                })
                console.log(`[Cleanup] Found deleted video: ${relativePath}`)
              }
            }
            // If column doesn't exist, skip (old database, can't be deleted)
          } finally {
            db.close()
          }
        } catch (error) {
          console.error(`[Cleanup] Error checking ${relativePath}:`, error)
        }

        // Don't recurse into video directories
        return
      }

      // Recurse into subdirectories
      const skipDirs = new Set(['crop_frames', 'full_frames'])
      for (const entry of entries) {
        if (entry.isDirectory() && !skipDirs.has(entry.name)) {
          const subPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
          await scanDir(resolve(dir, entry.name), subPath)
        }
      }
    } catch (error) {
      console.error(`[Cleanup] Error scanning ${dir}:`, error)
    }
  }

  await scanDir(dataDir)
  return deletedVideos
}

/**
 * Cleanup a single deleted video
 */
async function cleanupDeletedVideo(video: DeletedVideo): Promise<void> {
  const { videoPath, videoDir, pid } = video

  console.log(`[Cleanup] Processing: ${videoPath}`)

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
    } catch (error) {
      console.log(`[Cleanup] Process ${pid} already terminated`)
    }
  }

  // Delete the video directory
  try {
    if (existsSync(videoDir)) {
      await rm(videoDir, { recursive: true, force: true })
      console.log(`[Cleanup] Deleted files for: ${videoPath}`)
    }
  } catch (error) {
    console.error(`[Cleanup] Failed to delete ${videoPath}:`, error)
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
async function findStaleProcessing(): Promise<Array<{ videoPath: string; videoDir: string; videoFile: string; pid: string | null; attempts: number }>> {
  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')

  if (!existsSync(dataDir)) {
    return []
  }

  const staleVideos: Array<{ videoPath: string; videoDir: string; videoFile: string; pid: string | null; attempts: number }> = []

  async function scanDir(dir: string, relativePath: string = ''): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      const hasDb = entries.some(e => e.isFile() && e.name === 'annotations.db')

      if (hasDb) {
        const dbPath = resolve(dir, 'annotations.db')
        try {
          const db = new Database(dbPath, { readonly: true })
          try {
            // Check if required columns exist (newer databases only)
            const tableInfo = db.prepare(`PRAGMA table_info(processing_status)`).all() as Array<{ name: string }>
            const hasProcessingAttemptsColumn = tableInfo.some(col => col.name === 'processing_attempts')
            const hasDeletedColumn = tableInfo.some(col => col.name === 'deleted')

            if (!hasProcessingAttemptsColumn) {
              // Old database schema - skip stale processing check
              return
            }

            const status = db.prepare(`
              SELECT status, current_job_id, processing_attempts${hasDeletedColumn ? ', deleted' : ''}
              FROM processing_status
              WHERE id = 1
            `).get() as { status: string; current_job_id: string | null; processing_attempts: number; deleted?: number } | undefined

            // Skip if deleted or not in processing state
            if (!status || status.deleted === 1) {
              return
            }

            // Check if stuck in processing state
            if (PROCESSING_STATES.includes(status.status as any)) {
              const pid = status.current_job_id
              const isRunning = pid ? isProcessRunning(pid) : false

              if (!isRunning) {
                // Process is not running but status says processing - this is stale
                const videoMetadata = db.prepare(`SELECT original_filename FROM video_metadata WHERE id = 1`).get() as { original_filename: string } | undefined

                if (videoMetadata) {
                  const videoFile = resolve(dir, videoMetadata.original_filename)
                  if (existsSync(videoFile)) {
                    staleVideos.push({
                      videoPath: relativePath,
                      videoDir: dir,
                      videoFile,
                      pid,
                      attempts: status.processing_attempts
                    })
                    console.log(`[Cleanup] Found stale processing: ${relativePath} (PID: ${pid || 'none'}, attempts: ${status.processing_attempts})`)
                  }
                }
              }
            }
          } finally {
            db.close()
          }
        } catch (error) {
          console.error(`[Cleanup] Error checking ${relativePath}:`, error)
        }
        return
      }

      const skipDirs = new Set(['crop_frames', 'full_frames'])
      for (const entry of entries) {
        if (entry.isDirectory() && !skipDirs.has(entry.name)) {
          const subPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
          await scanDir(resolve(dir, entry.name), subPath)
        }
      }
    } catch (error) {
      console.error(`[Cleanup] Error scanning ${dir}:`, error)
    }
  }

  await scanDir(dataDir)
  return staleVideos
}

/**
 * Recover a stale processing job
 */
async function recoverStaleProcessing(video: { videoPath: string; videoDir: string; videoFile: string; attempts: number }): Promise<void> {
  const { videoPath, videoDir, videoFile, attempts } = video

  // Check if exceeded max attempts
  if (attempts >= MAX_PROCESSING_ATTEMPTS) {
    console.log(`[Cleanup] Max attempts reached for ${videoPath}, marking as error`)

    const dbPath = resolve(videoDir, 'annotations.db')
    const db = new Database(dbPath)
    try {
      db.prepare(`
        UPDATE processing_status
        SET status = 'error',
            error_message = ?,
            error_details = ?,
            error_occurred_at = datetime('now'),
            current_job_id = NULL
        WHERE id = 1
      `).run(
        `Processing failed after ${attempts} attempts (server restarts or crashes)`,
        JSON.stringify({ reason: 'max_attempts_exceeded', attempts })
      )
    } finally {
      db.close()
    }
    return
  }

  // Restart processing
  console.log(`[Cleanup] Restarting processing for ${videoPath} (attempt ${attempts + 1}/${MAX_PROCESSING_ATTEMPTS})`)

  try {
    await triggerVideoProcessing({
      videoPath,
      videoFile
    })
    console.log(`[Cleanup] Successfully restarted processing for ${videoPath}`)
  } catch (error) {
    console.error(`[Cleanup] Failed to restart processing for ${videoPath}:`, error)

    // Mark as error
    const dbPath = resolve(videoDir, 'annotations.db')
    const db = new Database(dbPath)
    try {
      db.prepare(`
        UPDATE processing_status
        SET status = 'error',
            error_message = ?,
            error_details = ?,
            error_occurred_at = datetime('now'),
            current_job_id = NULL
        WHERE id = 1
      `).run(
        `Failed to restart processing: ${error instanceof Error ? error.message : 'Unknown error'}`,
        JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown', attempts: attempts + 1 })
      )
    } finally {
      db.close()
    }
  }
}

/**
 * Run cleanup process - find and cleanup deleted videos, recover stale processing
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

    if (deletedVideos.length === 0 && staleVideos.length === 0) {
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

  console.log(`[Cleanup] Starting periodic cleanup (every ${CLEANUP_INTERVAL_MS / 1000 / 60} minutes)`)

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
