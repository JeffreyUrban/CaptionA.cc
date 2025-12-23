import { type LoaderFunctionArgs } from 'react-router'
import { resolve } from 'path'
import { readdir } from 'fs/promises'
import { existsSync } from 'fs'

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

  // Decode the URL-encoded videoId
  const videoId = decodeURIComponent(encodedVideoId)

  // Construct path to cropped frames directory
  const croppedDir = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'caption_frames',
    'cropped'
  )

  // Check if directory exists
  if (!existsSync(croppedDir)) {
    return new Response(
      JSON.stringify({ error: 'Video not found' }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }

  // Count frame files
  const files = await readdir(croppedDir)
  const frameFiles = files.filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))
  const totalFrames = frameFiles.length

  return new Response(
    JSON.stringify({
      videoId,
      totalFrames,
      firstFrame: 0,
      lastFrame: totalFrames - 1,
    }),
    {
      headers: { 'Content-Type': 'application/json' }
    }
  )
}
