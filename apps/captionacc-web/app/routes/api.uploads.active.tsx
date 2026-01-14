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

interface VideoInfo {
  videoId: string
  displayPath: string
  originalFilename: string
}

async function checkVideoUploadStatus(video: VideoInfo): Promise<ActiveUpload | null> {
  const dbPath = await getDbPath(video.videoId)
  if (!dbPath) return null

  try {
    const db = new Database(dbPath, { readonly: true })
    try {
      const status = db
        .prepare(
          `
        SELECT status, upload_progress, upload_started_at
        FROM processing_status
        WHERE id = 1 AND status = 'uploading'
      `
        )
        .get() as { status: string; upload_progress: number; upload_started_at: string } | undefined

      if (status) {
        return {
          videoId: video.displayPath,
          originalFilename: video.originalFilename,
          uploadProgress: status.upload_progress || 0,
          uploadStartedAt: status.upload_started_at,
        }
      }
    } finally {
      db.close()
    }
  } catch (error) {
    console.error(`[ActiveUploads] Error checking ${video.displayPath}:`, error)
  }

  return null
}

export async function loader() {
  try {
    const activeUploads: ActiveUpload[] = []

    // Get all videos and check for active uploads
    const allVideos = await getAllVideos()

    for (const video of allVideos) {
      const upload = await checkVideoUploadStatus(video)
      if (upload) {
        activeUploads.push(upload)
      }
    }

    return new Response(JSON.stringify({ uploads: activeUploads }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[ActiveUploads] Error:', error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
