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
  const frameNum = parseInt(frameIndex)

  // Get level2 name (last part of videoId)
  const level2 = videoId.split('/').pop()
  if (!level2) {
    return new Response('Invalid videoId', { status: 400 })
  }

  // Path to video file
  const videoPath = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    `${level2}.mp4`
  )

  if (!existsSync(videoPath)) {
    return new Response('Video file not found', { status: 404 })
  }

  // Cache directory for extracted frames
  const cacheDir = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'full_frames'
  )

  // Cached frame path
  const paddedIndex = frameIndex.padStart(10, '0')
  const cachedFramePath = resolve(cacheDir, `frame_${paddedIndex}.jpg`)

  // Check if frame is already cached
  if (existsSync(cachedFramePath)) {
    const imageBuffer = await readFile(cachedFramePath)
    return new Response(imageBuffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  }

  // Extract frame using ffmpeg
  try {
    // Create cache directory if it doesn't exist
    await mkdir(cacheDir, { recursive: true })

    // Extract specific frame using ffmpeg
    // Frame number starts at 0, select_eq(n,frameNum) selects the specific frame
    const command = `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,${frameNum})" -frames:v 1 -y "${cachedFramePath}"`

    await execAsync(command)

    // Read and return the extracted frame
    if (existsSync(cachedFramePath)) {
      const imageBuffer = await readFile(cachedFramePath)
      return new Response(imageBuffer, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    } else {
      return new Response('Failed to extract frame', { status: 500 })
    }
  } catch (error) {
    console.error('Error extracting frame:', error)
    return new Response('Failed to extract frame: ' + (error instanceof Error ? error.message : 'Unknown error'), {
      status: 500
    })
  }
}
