/**
 * Get count of video files in a specific folder path
 * Used to determine if collapse logic should apply (check existing files)
 */
import type { LoaderFunctionArgs } from 'react-router'

import { getAllVideos } from '~/utils/video-paths'

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const path = url.searchParams.get('path')

  // Handle missing or empty path (treat as root directory)
  const targetPath = path || ''

  // Get all videos and count how many are direct children of this path
  const allVideos = await getAllVideos()
  const fileCount = allVideos.filter(video => {
    // Check if video is a direct child of the path (not in subfolders)
    const videoPath = video.displayPath
    const videoDir = videoPath.substring(0, videoPath.lastIndexOf('/'))

    return videoDir === targetPath
  }).length

  return Response.json({ fileCount })
}
