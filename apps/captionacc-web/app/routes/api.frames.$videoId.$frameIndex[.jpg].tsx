import { type LoaderFunctionArgs } from 'react-router'
import { resolve } from 'path'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'

export async function loader({ params }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId, frameIndex } = params

  if (!encodedVideoId || !frameIndex) {
    return new Response('Missing videoId or frameIndex', { status: 400 })
  }

  // Decode the URL-encoded videoId
  const videoId = decodeURIComponent(encodedVideoId)

  // Convert frameIndex to 10-digit padded string
  const paddedIndex = frameIndex.padStart(10, '0')

  // Construct path to frame image
  // Format: /local/data/{content_name}/{video_id}/caption_frames/frame_{index}.jpg
  const framePath = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'caption_frames',
    `frame_${paddedIndex}.jpg`
  )

  // Check if file exists
  if (!existsSync(framePath)) {
    return new Response('Frame not found', { status: 404 })
  }

  // Read and return the image file
  const imageBuffer = await readFile(framePath)

  return new Response(imageBuffer, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
