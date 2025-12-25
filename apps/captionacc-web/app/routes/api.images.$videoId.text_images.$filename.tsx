import { type LoaderFunctionArgs } from 'react-router'
import { resolve } from 'path'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'

export async function loader({ params }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId, filename } = params

  if (!encodedVideoId || !filename) {
    return new Response('Missing videoId or filename', { status: 400 })
  }

  // Decode the URL-encoded videoId
  const videoId = decodeURIComponent(encodedVideoId)

  // Validate filename to prevent directory traversal
  if (filename.includes('..') || filename.includes('/')) {
    return new Response('Invalid filename', { status: 400 })
  }

  // Construct path to text image
  // Format: /local/data/{content_name}/{video_id}/text_images/{filename}
  const imagePath = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'text_images',
    filename
  )

  // Check if file exists
  if (!existsSync(imagePath)) {
    return new Response('Image not found', { status: 404 })
  }

  // Read and return the image file
  const imageBuffer = await readFile(imagePath)

  return new Response(imageBuffer, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
