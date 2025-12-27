import { type LoaderFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'

function getDatabase(videoId: string) {
  const dbPath = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'annotations.db'
  )

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found for video: ${videoId}`)
  }

  return new Database(dbPath)
}

// GET - Calculate workflow progress (percentage of frames that are confirmed or predicted and not pending)
export async function loader({ params }: LoaderFunctionArgs) {
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

    // Calculate total frames in annotations that are not gaps and not pending
    const result = db.prepare(`
      SELECT SUM(end_frame_index - start_frame_index + 1) as completed_frames
      FROM captions
      WHERE boundary_state != 'gap' AND boundary_pending = 0
    `).get() as { completed_frames: number | null }

    // Get total frames from all annotations (should equal video total)
    const totalResult = db.prepare(`
      SELECT SUM(end_frame_index - start_frame_index + 1) as total_frames
      FROM captions
    `).get() as { total_frames: number }

    db.close()

    const completedFrames = result.completed_frames || 0
    const totalFrames = totalResult.total_frames
    const progress = totalFrames > 0 ? (completedFrames / totalFrames) * 100 : 0

    return new Response(JSON.stringify({
      completed_frames: completedFrames,
      total_frames: totalFrames,
      progress_percent: progress
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
