/**
 * Check if video paths already exist (duplicate detection)
 * Checks by display_path in video_metadata table
 */
import type { LoaderFunctionArgs } from 'react-router'

import { getAllVideos } from '~/utils/video-paths'

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const pathsParam = url.searchParams.get('paths')

  if (!pathsParam) {
    return Response.json({ error: 'Missing paths parameter' }, { status: 400 })
  }

  const videoPaths = pathsParam.split(',')
  const results: Record<string, { exists: boolean; filename?: string; uploadedAt?: string }> = {}

  // Get all videos and build a lookup map by display_path
  const allVideos = await getAllVideos()
  const videoMap = new Map(allVideos.map(v => [v.displayPath, v]))

  for (const videoPath of videoPaths) {
    const video = videoMap.get(videoPath)

    if (video) {
      // Video exists with this display_path
      results[videoPath] = {
        exists: true,
        filename: video.originalFilename,
        // Note: uploadedAt not in VideoMetadata interface, would need to query DB
        // For now, just return exists=true
      }
    } else {
      results[videoPath] = { exists: false }
    }
  }

  return Response.json(results)
}
