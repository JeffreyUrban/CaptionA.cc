import { type LoaderFunctionArgs } from 'react-router'
import { getVideoStats } from '~/utils/video-stats'

export async function loader({ params }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId } = params

  if (!encodedVideoId) {
    return new Response(
      JSON.stringify({ error: 'Missing videoId' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    const stats = await getVideoStats(videoId)
    return new Response(
      JSON.stringify(stats),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error(`Error reading annotations for ${videoId}:`, error)
    return new Response(
      JSON.stringify({ error: 'Failed to read annotations' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
