/**
 * Retry failed crop_frames processing
 */

import Database from 'better-sqlite3'
import { type ActionFunctionArgs } from 'react-router'

import { queueCropFramesProcessing } from '~/services/prefect'
import { getDbPath, getVideoDir } from '~/utils/video-paths'

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
    const dbPath = getDbPath(videoId)
    if (!dbPath) {
      return new Response(JSON.stringify({ error: 'Video not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    let layoutConfig: {
      crop_left: number
      crop_top: number
      crop_right: number
      crop_bottom: number
    }
    let videoPath: string

    const db = new Database(dbPath)
    try {
      // Get current crop_frames status
      const status = db
        .prepare(
          `
        SELECT status FROM crop_frames_status WHERE id = 1
      `
        )
        .get() as { status: string } | undefined

      if (!status) {
        return new Response(JSON.stringify({ error: 'No crop_frames status found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Only retry if in error state
      if (status.status !== 'error') {
        return new Response(
          JSON.stringify({
            error: `Cannot retry crop_frames in ${status.status} state. Only error state can be retried.`,
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Get crop bounds from video_layout_config
      const config = db
        .prepare(
          `
        SELECT crop_left, crop_top, crop_right, crop_bottom
        FROM video_layout_config WHERE id = 1
      `
        )
        .get() as
        | {
            crop_left: number
            crop_top: number
            crop_right: number
            crop_bottom: number
          }
        | undefined

      if (!config) {
        return new Response(
          JSON.stringify({
            error: 'Layout not approved - cannot retry crop_frames',
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      layoutConfig = config

      // Get display_path for logging
      const metadata = db
        .prepare(
          `
        SELECT display_path FROM video_metadata WHERE id = 1
      `
        )
        .get() as { display_path: string } | undefined

      videoPath = metadata?.display_path ?? videoId

      // Reset status to queued
      db.prepare(
        `
        UPDATE crop_frames_status
        SET status = 'queued',
            error_message = NULL,
            error_details = NULL,
            error_occurred_at = NULL,
            retry_count = 0
        WHERE id = 1
      `
      ).run()

      console.log(`[RetryCropFrames] Queued retry for video: ${videoPath}`)
    } finally {
      db.close()
    }

    // Queue the crop_frames job immediately via Prefect
    const videoDir = getVideoDir(videoId)
    if (!videoDir) {
      throw new Error('Failed to resolve video directory')
    }

    // Get video file
    const { readdirSync } = await import('fs')
    const { resolve } = await import('path')
    const videoFiles = readdirSync(videoDir).filter(
      f => f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.avi') || f.endsWith('.mov')
    )
    const videoFile = videoFiles[0]
    if (!videoFile) {
      throw new Error('Video file not found')
    }

    const videoFilePath = resolve(videoDir, videoFile)

    await queueCropFramesProcessing({
      videoId,
      videoPath: videoFilePath,
      dbPath,
      outputDir: resolve(videoDir, 'crop_frames'),
      cropBounds: {
        left: layoutConfig.crop_left,
        top: layoutConfig.crop_top,
        right: layoutConfig.crop_right,
        bottom: layoutConfig.crop_bottom,
      },
    })

    console.log(`[Prefect] Queued crop frames retry for ${videoId}`)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Crop frames queued for reprocessing',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Video-Touched': videoId,
        },
      }
    )
  } catch (error) {
    console.error(`[RetryCropFrames] Error retrying ${videoId}:`, error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
