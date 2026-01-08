/**
 * Admin endpoint to list all videos with failed crop_frames processing
 *
 * GET /api/admin/failed-crop-frames
 *
 * Returns a list of all videos where crop_frames processing has failed.
 * Used by the admin dashboard to show failed videos and enable retry.
 */

import { existsSync } from 'fs'

import Database from 'better-sqlite3'

import { getAllVideos } from '~/utils/video-paths'

interface FailedVideo {
  videoId: string
  displayPath: string
  errorMessage: string
  errorContext?: Record<string, unknown>
  processingStartedAt: string | null
}

/**
 * Check a single video database for crop_frames errors
 */
function checkVideoForErrors(video: {
  videoId: string
  displayPath: string
  storagePath: string
}): FailedVideo | null {
  const dbPath = `${process.cwd()}/../../local/processing/${video.storagePath}/captions.db`

  // Skip if database doesn't exist
  if (!existsSync(dbPath)) {
    return null
  }

  try {
    const db = new Database(dbPath)

    // Check crop_frames_status for errors
    const status = db
      .prepare(
        `
      SELECT
        status,
        error_message,
        error_details,
        processing_started_at
      FROM crop_frames_status
      WHERE id = 1
    `
      )
      .get() as
      | {
          status: string
          error_message: string | null
          error_details: string | null
          processing_started_at: string | null
        }
      | undefined

    db.close()

    // If status is not 'error', return null
    if (status?.status !== 'error') {
      return null
    }

    // Parse error details if available
    let errorContext: Record<string, unknown> | undefined
    if (status.error_details) {
      try {
        errorContext = JSON.parse(status.error_details)
      } catch {
        // If error_details is not valid JSON, ignore it
      }
    }

    return {
      videoId: video.videoId,
      displayPath: video.displayPath,
      errorMessage: status.error_message ?? 'Unknown error',
      errorContext,
      processingStartedAt: status.processing_started_at,
    }
  } catch (error) {
    // Log database errors but continue scanning
    console.error(`[AdminAPI] Error checking ${video.displayPath}:`, error)
    return null
  }
}

export async function loader({ request }: { request: Request }) {
  try {
    // Require platform admin access
    const { requirePlatformAdmin } = await import('~/services/platform-admin')
    await requirePlatformAdmin(request)

    console.log('[AdminAPI] Scanning for failed crop_frames videos...')

    const videos = await getAllVideos()
    const failedVideos: FailedVideo[] = []

    for (const video of videos) {
      const failedVideo = checkVideoForErrors(video)
      if (failedVideo) {
        failedVideos.push(failedVideo)
      }
    }

    console.log(`[AdminAPI] Found ${failedVideos.length} failed videos`)

    return new Response(
      JSON.stringify({
        success: true,
        videos: failedVideos,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('[AdminAPI] Failed to scan for failed videos:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        videos: [],
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
