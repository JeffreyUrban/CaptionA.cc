import { existsSync } from 'fs'
import { rm } from 'fs/promises'

import Database from 'better-sqlite3'
import { type ActionFunctionArgs } from 'react-router'

import { getDbPath, getVideoDir } from '~/utils/video-paths'

/**
 * Background cleanup function - kills process and deletes files
 */
async function cleanupVideo(videoId: string, videoDir: string, pid: string | null) {
  console.log(`[VideoDelete] Starting cleanup for: ${videoId}`)

  // Kill processing job if running
  if (pid) {
    try {
      const pidNum = parseInt(pid)
      process.kill(pidNum, 'SIGTERM')
      console.log(`[VideoDelete] Killed processing job PID: ${pidNum}`)

      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Force kill if still running
      try {
        process.kill(pidNum, 'SIGKILL')
      } catch {
        // Process already dead, that's fine
      }
    } catch {
      console.log(`[VideoDelete] Process ${pid} already terminated or not found`)
    }
  }

  // Delete the entire video directory
  try {
    if (existsSync(videoDir)) {
      await rm(videoDir, { recursive: true, force: true })
      console.log(`[VideoDelete] Successfully deleted files for: ${videoId}`)
    }
  } catch (error) {
    console.error(`[VideoDelete] Failed to delete files for ${videoId}:`, error)
    // Don't throw - we've already marked as deleted
  }
}

/**
 * DELETE - Soft delete a video and trigger background cleanup
 *
 * This implements a soft-delete pattern:
 * 1. Mark video as deleted in database (immediate)
 * 2. Kill processing job if running (background)
 * 3. Delete files (background)
 * 4. Return success immediately (no user wait)
 */
export async function action({ params }: ActionFunctionArgs) {
  const { videoId: encodedVideoId } = params

  if (!encodedVideoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    // Resolve video paths (videoId can be display_path or UUID)
    const dbPath = getDbPath(videoId)
    const videoDir = getVideoDir(videoId)

    if (!dbPath || !videoDir) {
      return new Response(
        JSON.stringify({
          error: 'Video not found',
          videoId,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Soft delete: mark as deleted and get PID
    let pid: string | null = null
    const db = new Database(dbPath)
    try {
      // Get current job ID (PID) before marking deleted
      const status = db
        .prepare(
          `
        SELECT current_job_id FROM processing_status WHERE id = 1
      `
        )
        .get() as { current_job_id: string | null } | undefined

      pid = status?.current_job_id ?? null

      // Mark as deleted
      db.prepare(
        `
        UPDATE processing_status
        SET deleted = 1,
            deleted_at = datetime('now')
        WHERE id = 1
      `
      ).run()

      console.log(`[VideoDelete] Marked as deleted: ${videoId} (PID: ${pid ?? 'none'})`)
    } finally {
      db.close()
    }

    // Trigger background cleanup (don't await)
    cleanupVideo(videoId, videoDir, pid).catch(error => {
      console.error(`[VideoDelete] Background cleanup failed for ${videoId}:`, error)
    })

    // Return success immediately
    return new Response(
      JSON.stringify({
        success: true,
        videoId,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Error deleting video:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        videoId,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
