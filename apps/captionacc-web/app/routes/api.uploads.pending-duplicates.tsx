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

interface VideoInfo {
  videoId: string
  displayPath: string
}

async function checkPendingDuplicate(video: VideoInfo): Promise<PendingDuplicate | null> {
  const dbPath = await getDbPath(video.videoId)
  if (!dbPath) return null

  try {
    const db = new Database(dbPath, { readonly: true })
    try {
      const status = db.prepare(`SELECT status FROM processing_status WHERE id = 1`).get() as
        | { status: string }
        | undefined

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
          return {
            videoId: video.videoId,
            displayPath: video.displayPath,
            duplicateOfVideoId: duplicateInfo.duplicate_of_video_id,
            duplicateOfDisplayPath: duplicateInfo.duplicate_of_display_path,
            detectedAt: duplicateInfo.detected_at,
          }
        }
      }
    } finally {
      db.close()
    }
  } catch (error) {
    console.error(`[PendingDuplicates] Error checking ${video.videoId}:`, error)
  }

  return null
}

export async function loader({ request: _request }: LoaderFunctionArgs) {
  const allVideos = await getAllVideos()
  const pendingDuplicates: PendingDuplicate[] = []

  for (const video of allVideos) {
    const duplicate = await checkPendingDuplicate(video)
    if (duplicate) {
      pendingDuplicates.push(duplicate)
    }
  }

  return Response.json({ pendingDuplicates })
}
