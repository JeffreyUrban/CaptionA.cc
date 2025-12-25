import { type LoaderFunctionArgs } from 'react-router'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile, writeFile, mkdir } from 'fs/promises'

const execAsync = promisify(exec)

export async function loader({ params }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId, frameIndex } = params

  if (!encodedVideoId || !frameIndex) {
    return new Response('Missing videoId or frameIndex', { status: 400 })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  // caption_layout frames are at 10Hz, matching database frame_index 1:1
  const paddedIndex = frameIndex.padStart(10, '0')

  const framePath = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'caption_layout',
    'full_frames',
    `frame_${paddedIndex}.jpg`
  )

  // Check if frame exists
  if (!existsSync(framePath)) {
    return new Response(`Frame ${frameIndex} not found`, { status: 404 })
  }

  // Read and return the frame
  const imageBuffer = await readFile(framePath)
  return new Response(imageBuffer, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
