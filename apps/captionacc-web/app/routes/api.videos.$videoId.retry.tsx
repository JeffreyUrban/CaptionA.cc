/**
 * Retry failed video processing
 */

import { type ActionFunctionArgs } from 'react-router'
import { getDbPath, getVideoDir } from '~/utils/video-paths'
import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { queueVideoProcessing } from '~/services/video-processing'

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

    const videoDir = getVideoDir(videoId)
    if (!videoDir) {
      return new Response(JSON.stringify({ error: 'Video directory not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const db = new Database(dbPath)
    try {
      // Get current status
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
          error: `Cannot retry video in ${status.status} state. Only error state can be retried.`
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Get video metadata
      const metadata = db.prepare(`
        SELECT video_id, original_filename FROM video_metadata WHERE id = 1
      `).get() as { video_id: string; original_filename: string } | undefined

      if (!metadata) {
        return new Response(JSON.stringify({ error: 'Video metadata not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Reset status to upload_complete to allow reprocessing
      db.prepare(`
        UPDATE processing_status
        SET status = 'upload_complete',
            error_message = NULL,
            error_details = NULL,
            error_occurred_at = NULL,
            processing_attempts = processing_attempts + 1
        WHERE id = 1
      `).run()

      console.log(`[RetryProcessing] Retrying video: ${videoId}`)
    } finally {
      db.close()
    }

    // Find the video file
    const { readdirSync } = await import('fs')
    const videoFiles = readdirSync(videoDir).filter(f =>
      f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.avi') || f.endsWith('.mov')
    )

    if (videoFiles.length === 0) {
      return new Response(JSON.stringify({ error: 'Video file not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const videoFile = resolve(videoDir, videoFiles[0])

    // Queue for processing
    queueVideoProcessing({
      videoPath: videoId,  // display_path
      videoFile,
      videoId,  // UUID
    })

    return new Response(JSON.stringify({
      success: true,
      message: 'Video queued for reprocessing'
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error(`[RetryProcessing] Error retrying ${videoId}:`, error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
