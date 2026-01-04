/**
 * Resolve a duplicate video upload
 * Handles user decision: keep both, replace existing, or cancel upload
 */
import { resolve } from 'path'

import Database from 'better-sqlite3'
import type { ActionFunctionArgs } from 'react-router'

import { getDbPath } from '~/utils/video-paths'

export async function action({ request, params }: ActionFunctionArgs) {
  const { videoId } = params
  if (!videoId) {
    return Response.json({ error: 'Missing videoId' }, { status: 400 })
  }

  const formData = await request.formData()
  const decision = formData.get('decision') as 'keep_both' | 'replace_existing' | 'cancel_upload'

  if (!decision || !['keep_both', 'replace_existing', 'cancel_upload'].includes(decision)) {
    return Response.json({ error: 'Invalid decision' }, { status: 400 })
  }

  // Get database path for this video
  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    return Response.json({ error: 'Video not found' }, { status: 404 })
  }

  const db = new Database(dbPath)
  try {
    // Get duplicate info
    const duplicateInfo = db
      .prepare(
        `
      SELECT duplicate_of_video_id, duplicate_of_display_path
      FROM duplicate_resolution
      WHERE id = 1
    `
      )
      .get() as { duplicate_of_video_id: string; duplicate_of_display_path: string } | undefined

    if (!duplicateInfo) {
      return Response.json({ error: 'No duplicate resolution pending' }, { status: 400 })
    }

    // Update duplicate resolution with user's decision
    db.prepare(
      `
      UPDATE duplicate_resolution
      SET user_decision = ?, resolved_at = datetime('now')
      WHERE id = 1
    `
    ).run(decision)

    if (decision === 'keep_both') {
      // Keep both videos - finalize this upload and start processing
      db.prepare(
        `
        UPDATE processing_status
        SET status = 'upload_complete'
        WHERE id = 1
      `
      ).run()

      // Queue for background processing
      const videoMetadata = db
        .prepare(
          `
        SELECT video_id, display_path, storage_path, original_filename
        FROM video_metadata
        WHERE id = 1
      `
        )
        .get() as {
        video_id: string
        display_path: string
        storage_path: string
        original_filename: string
      }

      const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')
      const videoDir = resolve(dataDir, ...videoMetadata.storage_path.split('/'))
      const videoFile = resolve(videoDir, videoMetadata.original_filename)

      const { queueFullFramesProcessing } = await import('~/services/prefect')
      await queueFullFramesProcessing({
        videoId: videoMetadata.video_id,
        videoPath: videoFile,
        dbPath,
        outputDir: resolve(videoDir, 'full_frames'),
        frameRate: 0.1,
      })

      console.log(`[DuplicateResolution] Keeping both: ${videoMetadata.display_path}`)
    } else if (decision === 'replace_existing') {
      // Hard delete the existing video and finalize this one
      const duplicateDbPath = getDbPath(duplicateInfo.duplicate_of_video_id)
      if (duplicateDbPath) {
        const duplicateDb = new Database(duplicateDbPath)

        // Get storage path before deleting
        const existingMetadata = duplicateDb
          .prepare(
            `
          SELECT storage_path
          FROM video_metadata
          WHERE id = 1
        `
          )
          .get() as { storage_path: string } | undefined

        duplicateDb.close()

        if (existingMetadata) {
          const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')
          const existingVideoDir = resolve(dataDir, ...existingMetadata.storage_path.split('/'))

          // Hard delete the existing video directory
          const { rmSync } = await import('fs')
          rmSync(existingVideoDir, { recursive: true, force: true })

          console.log(
            `[DuplicateResolution] Hard deleted existing video: ${duplicateInfo.duplicate_of_display_path} (${existingVideoDir})`
          )
        }
      }

      // Finalize this upload
      db.prepare(
        `
        UPDATE processing_status
        SET status = 'upload_complete'
        WHERE id = 1
      `
      ).run()

      // Queue for background processing
      const videoMetadata = db
        .prepare(
          `
        SELECT video_id, display_path, storage_path, original_filename
        FROM video_metadata
        WHERE id = 1
      `
        )
        .get() as {
        video_id: string
        display_path: string
        storage_path: string
        original_filename: string
      }

      const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')
      const videoDir = resolve(dataDir, ...videoMetadata.storage_path.split('/'))
      const videoFile = resolve(videoDir, videoMetadata.original_filename)

      const { queueFullFramesProcessing } = await import('~/services/prefect')
      await queueFullFramesProcessing({
        videoId: videoMetadata.video_id,
        videoPath: videoFile,
        dbPath,
        outputDir: resolve(videoDir, 'full_frames'),
        frameRate: 0.1,
      })

      console.log(`[DuplicateResolution] Replacing existing with: ${videoMetadata.display_path}`)
    } else if (decision === 'cancel_upload') {
      // Hard delete this upload - remove from disk entirely
      const videoMetadata = db
        .prepare(
          `
        SELECT storage_path
        FROM video_metadata
        WHERE id = 1
      `
        )
        .get() as { storage_path: string } | undefined

      if (videoMetadata) {
        const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')
        const videoDir = resolve(dataDir, ...videoMetadata.storage_path.split('/'))

        // Close database before deleting
        db.close()

        // Delete entire video directory from disk
        const { rmSync } = await import('fs')
        rmSync(videoDir, { recursive: true, force: true })

        console.log(`[DuplicateResolution] Hard deleted cancelled upload: ${videoDir}`)
      } else {
        console.warn(`[DuplicateResolution] No metadata found for cancelled upload`)
      }

      // Return early since we already closed the db
      return Response.json({ success: true, decision })
    }

    return Response.json({ success: true, decision })
  } finally {
    db.close()
  }
}
