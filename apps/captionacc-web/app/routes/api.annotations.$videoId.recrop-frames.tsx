import { existsSync } from 'fs'

import Database from 'better-sqlite3'
import { type ActionFunctionArgs } from 'react-router'

import { queueCropFramesProcessing } from '~/services/crop-frames-processing'
import { getDbPath, getVideoDir } from '~/utils/video-paths'

function getDatabase(videoId: string): Database.Database | Response {
  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    return new Response('Video not found', { status: 404 })
  }

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found for video: ${videoId}`)
  }

  return new Database(dbPath)
}

// POST - Trigger frame re-cropping based on current crop bounds
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
    const db = getDatabase(videoId)
    if (db instanceof Response) return db

    // Get current crop bounds from video_layout_config
    const layoutConfig = db
      .prepare(
        `
      SELECT crop_left, crop_top, crop_right, crop_bottom
      FROM video_layout_config
      WHERE id = 1
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

    db.close()

    if (!layoutConfig) {
      return new Response(
        JSON.stringify({
          error: 'No layout configuration found. Cannot re-crop frames.',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Queue the crop_frames job (managed by processing coordinator)
    queueCropFramesProcessing({
      videoId,
      videoPath: videoId, // Use videoId as display path
      cropBounds: {
        left: layoutConfig.crop_left,
        top: layoutConfig.crop_top,
        right: layoutConfig.crop_right,
        bottom: layoutConfig.crop_bottom,
      },
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Frame cropping queued for processing',
        cropBounds: {
          left: layoutConfig.crop_left,
          top: layoutConfig.crop_top,
          right: layoutConfig.crop_right,
          bottom: layoutConfig.crop_bottom,
        },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Error triggering frame re-cropping:', error)
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
