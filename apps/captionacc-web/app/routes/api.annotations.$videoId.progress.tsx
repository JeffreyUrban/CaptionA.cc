import { type LoaderFunctionArgs } from 'react-router'

import { getVideoStats } from '~/utils/video-stats'

// GET - Calculate workflow progress (percentage of frames that are confirmed or predicted and not pending)
export async function loader({ params }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId } = params
  if (!encodedVideoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    const stats = await getVideoStats(videoId)

    return new Response(
      JSON.stringify({
        completed_frames: stats.coveredFrames,
        total_frames: stats.totalFrames,
        progress_percent: stats.progress,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
