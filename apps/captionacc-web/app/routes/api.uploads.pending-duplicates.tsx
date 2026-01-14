/**
 * Get all uploads with pending duplicate resolution
 * Returns videoId and duplicate info for each pending duplicate
 */
import Database from 'better-sqlite3'
import type { LoaderFunctionArgs } from 'react-router'

import { getAllVideos, getDbPath } from '~/utils/video-paths'

interface PendingDuplicate {
  videoId: string
  displayPath: string
  duplicateOfVideoId: string
  duplicateOfDisplayPath: string
  detectedAt: string
}

export async function loader({ request: _request }: LoaderFunctionArgs) {
  const allVideos = await getAllVideos()
  const pendingDuplicates: PendingDuplicate[] = []

  for (const video of allVideos) {
    const dbPath = await getDbPath(video.videoId)
    if (!dbPath) continue

    try {
      const db = new Database(dbPath, { readonly: true })
      try {
        // Check if this video has pending duplicate resolution
        const status = db
          .prepare(
            `
          SELECT status FROM processing_status WHERE id = 1
        `
          )
          .get() as { status: string } | undefined

        if (status?.status === 'pending_duplicate_resolution') {
          const duplicateInfo = db
            .prepare(
              `
            SELECT duplicate_of_video_id, duplicate_of_display_path, detected_at
            FROM duplicate_resolution
            WHERE id = 1
          `
            )
            .get() as
            | {
                duplicate_of_video_id: string
                duplicate_of_display_path: string
                detected_at: string
              }
            | undefined

          if (duplicateInfo) {
            pendingDuplicates.push({
              videoId: video.videoId,
              displayPath: video.displayPath,
              duplicateOfVideoId: duplicateInfo.duplicate_of_video_id,
              duplicateOfDisplayPath: duplicateInfo.duplicate_of_display_path,
              detectedAt: duplicateInfo.detected_at,
            })
          }
        }
      } finally {
        db.close()
      }
    } catch (error) {
      console.error(`[PendingDuplicates] Error checking ${video.videoId}:`, error)
    }
  }

  return Response.json({ pendingDuplicates })
}
