#!/usr/bin/env tsx
/**
 * Cleanup script for stale uploads
 *
 * Finds videos stuck in 'uploading' status for >30 minutes with no progress
 * and resets them to allow retry
 */

import Database from 'better-sqlite3'
import { getAllVideos, getDbPath } from '../apps/captionacc-web/app/utils/video-paths'
import { existsSync } from 'fs'
import { resolve } from 'path'

const STALE_THRESHOLD_MINUTES = 30

function cleanupStaleUploads() {
  console.log('Scanning for stale uploads...')

  const allVideos = getAllVideos()
  let staleCount = 0
  let cleanedCount = 0

  for (const video of allVideos) {
    const dbPath = getDbPath(video.videoId)
    if (!dbPath) continue

    const db = new Database(dbPath)
    try {
      const status = db.prepare(`
        SELECT status, upload_started_at, upload_progress
        FROM processing_status
        WHERE id = 1 AND status = 'uploading'
      `).get() as { status: string; upload_started_at: string; upload_progress: number } | undefined

      if (!status) continue

      // Check if upload started more than STALE_THRESHOLD_MINUTES ago
      const startedAt = new Date(status.upload_started_at)
      const now = new Date()
      const minutesAgo = (now.getTime() - startedAt.getTime()) / (1000 * 60)

      if (minutesAgo > STALE_THRESHOLD_MINUTES) {
        staleCount++

        // Check if video file exists (upload actually completed but status not updated)
        const videoDir = resolve(process.cwd(), '..', 'local', 'data', ...video.storagePath.split('/'))
        const hasVideoFile = existsSync(videoDir) &&
          ['mp4', 'mkv', 'avi', 'mov'].some(ext => existsSync(resolve(videoDir, `${video.originalFilename}`)))

        if (hasVideoFile) {
          // Video file exists, mark as upload_complete
          db.prepare(`
            UPDATE processing_status
            SET status = 'upload_complete',
                upload_progress = 1.0,
                upload_completed_at = datetime('now')
            WHERE id = 1
          `).run()
          console.log(`✓ Reset ${video.displayPath} to upload_complete (video file found)`)
        } else {
          // No video file, reset to allow retry
          db.prepare(`
            UPDATE processing_status
            SET status = 'error',
                error_message = 'Upload stalled or abandoned',
                upload_progress = 0.0,
                error_occurred_at = datetime('now')
            WHERE id = 1
          `).run()
          console.log(`✓ Reset ${video.displayPath} to error (no video file, can retry)`)
        }

        cleanedCount++
      }
    } finally {
      db.close()
    }
  }

  console.log(`\nFound ${staleCount} stale uploads`)
  console.log(`Cleaned up ${cleanedCount} uploads`)
}

cleanupStaleUploads()
