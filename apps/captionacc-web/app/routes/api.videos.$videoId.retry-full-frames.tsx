/**
 * Retry failed full_frames processing
 */

import { type ActionFunctionArgs } from 'react-router'
import { getDbPath, getVideoDir } from '~/utils/video-paths'
import Database from 'better-sqlite3'
import { queueVideoProcessing } from '~/services/video-processing'
import { readdirSync } from 'fs'
import { resolve } from 'path'

export async function action({ params }: ActionFunctionArgs) {
  const { videoId: encodedVideoId } = params

  if (!encodedVideoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    const dbPath = getDbPath(videoId)
    if (!dbPath) {
      return new Response(JSON.stringify({ error: 'Video not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    let videoPath: string
    let videoFile: string

    const db = new Database(dbPath)
    try {
      // Get current processing status
      const status = db.prepare(`
        SELECT status FROM processing_status WHERE id = 1
      `).get() as { status: string } | undefined

      if (!status) {
        return new Response(JSON.stringify({ error: 'No processing status found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Only retry if in error state
      if (status.status !== 'error') {
        return new Response(JSON.stringify({
          error: `Cannot retry full_frames in ${status.status} state. Only error state can be retried.`
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Get display_path for logging
      const metadata = db.prepare(`
        SELECT display_path FROM video_metadata WHERE id = 1
      `).get() as { display_path: string } | undefined

      videoPath = metadata?.display_path || videoId

      // Find video file
      const videoDir = getVideoDir(videoId)
      if (!videoDir) {
        return new Response(JSON.stringify({
          error: 'Video directory not found'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      const videoFiles = readdirSync(videoDir).filter(f =>
        f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.avi') || f.endsWith('.mov')
      )

      if (videoFiles.length === 0) {
        return new Response(JSON.stringify({
          error: 'Video file not found'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      videoFile = resolve(videoDir, videoFiles[0])

      // Check if this is a duplicate frame error and clear if needed
      const errorInfo = db.prepare(`
        SELECT error_details FROM processing_status WHERE id = 1
      `).get() as { error_details: string } | undefined

      const isDuplicateFrame = errorInfo?.error_details?.includes('UNIQUE constraint failed: full_frames.frame_index')

      if (isDuplicateFrame) {
        try {
          const deleteResult = db.prepare(`DELETE FROM full_frames`).run()
          console.log(`[RetryFullFrames] Cleared ${deleteResult.changes} existing frames from database`)
        } catch (error) {
          console.error(`[RetryFullFrames] Failed to clear frames for ${videoPath}:`, error)
          return new Response(JSON.stringify({
            error: 'Failed to clear existing frames'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          })
        }
      }

      // Reset status to upload_complete
      db.prepare(`
        UPDATE processing_status
        SET status = 'upload_complete',
            error_message = NULL,
            error_details = NULL,
            error_occurred_at = NULL
        WHERE id = 1
      `).run()

      console.log(`[RetryFullFrames] Queued retry for video: ${videoPath}`)
    } finally {
      db.close()
    }

    // Queue the full_frames job immediately
    queueVideoProcessing({
      videoId,
      videoPath,
      videoFile
    })

    return new Response(JSON.stringify({
      success: true,
      message: 'Full frames queued for reprocessing'
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error(`[RetryFullFrames] Error retrying ${videoId}:`, error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
