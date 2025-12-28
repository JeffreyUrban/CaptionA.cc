/**
 * API endpoint to get all currently active uploads
 * Returns list of videos with status='uploading'
 */

import Database from 'better-sqlite3'
import { getAllVideos, getDbPath } from '~/utils/video-paths'

interface ActiveUpload {
  videoId: string
  originalFilename: string
  uploadProgress: number
  uploadStartedAt: string
}

export async function loader() {
  try {
    const activeUploads: ActiveUpload[] = []

    // Get all videos and check for active uploads
    const allVideos = getAllVideos()

    for (const video of allVideos) {
      const dbPath = getDbPath(video.videoId)
      if (!dbPath) continue

      try {
        const db = new Database(dbPath, { readonly: true })
        try {
          const status = db.prepare(`
            SELECT status, upload_progress, upload_started_at
            FROM processing_status
            WHERE id = 1 AND status = 'uploading'
          `).get() as { status: string; upload_progress: number; upload_started_at: string } | undefined

          if (status) {
            activeUploads.push({
              videoId: video.displayPath,  // Return display_path to user
              originalFilename: video.originalFilename,
              uploadProgress: status.upload_progress || 0,
              uploadStartedAt: status.upload_started_at
            })
          }
        } finally {
          db.close()
        }
      } catch (error) {
        // Ignore database errors for individual videos
        console.error(`[ActiveUploads] Error checking ${video.displayPath}:`, error)
      }
    }

    return new Response(JSON.stringify({ uploads: activeUploads }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('[ActiveUploads] Error:', error)
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
