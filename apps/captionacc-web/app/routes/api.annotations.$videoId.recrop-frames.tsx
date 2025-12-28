import { type ActionFunctionArgs } from 'react-router'
import { getDbPath, getVideoDir } from '~/utils/video-paths'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { exec } from 'child_process'

function getDatabase(videoId: string) {
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
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    const db = getDatabase(videoId)

    // Get current crop bounds from video_layout_config
    const layoutConfig = db.prepare(`
      SELECT crop_left, crop_top, crop_right, crop_bottom
      FROM video_layout_config
      WHERE id = 1
    `).get() as {
      crop_left: number
      crop_top: number
      crop_right: number
      crop_bottom: number
    } | undefined

    db.close()

    if (!layoutConfig) {
      return new Response(JSON.stringify({
        error: 'No layout configuration found. Cannot re-crop frames.'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get paths
    const videoDataPath = getVideoDir(videoId)
    if (!videoDataPath) {
      return new Response(JSON.stringify({
        error: 'Video directory not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Find video file in the data directory
    const { readdirSync } = await import('fs')
    const videoFiles = readdirSync(videoDataPath).filter(f =>
      f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.avi') || f.endsWith('.mov')
    )

    if (videoFiles.length === 0) {
      return new Response(JSON.stringify({
        error: 'No video file found in data directory'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const videoPath = resolve(videoDataPath, videoFiles[0])
    const outputDir = resolve(videoDataPath, 'crop_frames')

    // Get path to crop_frames pipeline
    const pipelinePath = resolve(
      process.cwd(),
      '..',
      '..',
      'data-pipelines',
      'crop_frames'
    )

    // Format crop bounds as "left,top,right,bottom"
    const cropBounds = `${layoutConfig.crop_left},${layoutConfig.crop_top},${layoutConfig.crop_right},${layoutConfig.crop_bottom}`

    // Trigger frame re-cropping using crop_frames CLI
    // Run in background - don't wait for completion
    const command = `uv run crop_frames extract-frames "${videoPath}" "${outputDir}" --crop "${cropBounds}" --rate 10.0`

    console.log(`[Recrop Frames] Starting background frame re-cropping for ${videoId}`)
    console.log(`[Recrop Frames] Video: ${videoPath}`)
    console.log(`[Recrop Frames] Output: ${outputDir}`)
    console.log(`[Recrop Frames] Crop bounds: ${cropBounds}`)
    console.log(`[Recrop Frames] Command: ${command}`)

    exec(command, { cwd: pipelinePath }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[Recrop Frames] Failed for ${videoId}:`, error)
        console.error(`[Recrop Frames] stderr:`, stderr)
      } else {
        console.log(`[Recrop Frames] Completed for ${videoId}`)
        console.log(`[Recrop Frames] stdout:`, stdout)
      }
    })

    return new Response(JSON.stringify({
      success: true,
      message: 'Frame re-cropping started in background',
      cropBounds: {
        left: layoutConfig.crop_left,
        top: layoutConfig.crop_top,
        right: layoutConfig.crop_right,
        bottom: layoutConfig.crop_bottom
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error triggering frame re-cropping:', error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
