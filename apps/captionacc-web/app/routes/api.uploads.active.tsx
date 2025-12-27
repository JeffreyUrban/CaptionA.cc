/**
 * API endpoint to get all currently active uploads
 * Returns list of videos with status='uploading'
 */

import { resolve } from 'path'
import { readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import Database from 'better-sqlite3'

interface ActiveUpload {
  videoId: string
  originalFilename: string
  uploadProgress: number
  uploadStartedAt: string
}

export async function loader() {
  try {
    const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')
    
    if (!existsSync(dataDir)) {
      return new Response(JSON.stringify({ uploads: [] }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const activeUploads: ActiveUpload[] = []

    // Scan all video directories for active uploads
    async function scanDirectory(dirPath: string, relativePath: string = ''): Promise<void> {
      const entries = await readdir(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = resolve(dirPath, entry.name)
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name

        if (entry.isDirectory()) {
          // Check if this directory has an annotations.db
          const dbPath = resolve(fullPath, 'annotations.db')
          if (existsSync(dbPath)) {
            // This is a video directory - check upload status
            try {
              const db = new Database(dbPath)
              const status = db.prepare(`
                SELECT status, upload_progress, upload_started_at
                FROM processing_status
                WHERE id = 1 AND status = 'uploading'
              `).get() as { status: string; upload_progress: number; upload_started_at: string } | undefined

              if (status) {
                // Get video metadata
                const metadata = db.prepare(`
                  SELECT original_filename
                  FROM video_metadata
                  WHERE id = 1
                `).get() as { original_filename: string } | undefined

                if (metadata) {
                  activeUploads.push({
                    videoId: relPath,
                    originalFilename: metadata.original_filename,
                    uploadProgress: status.upload_progress || 0,
                    uploadStartedAt: status.upload_started_at
                  })
                }
              }
              db.close()
            } catch (error) {
              // Ignore database errors for individual videos
              console.error(`[ActiveUploads] Error checking ${relPath}:`, error)
            }
          } else {
            // Not a video directory, scan recursively
            await scanDirectory(fullPath, relPath)
          }
        }
      }
    }

    await scanDirectory(dataDir)

    return new Response(JSON.stringify({ uploads: activeUploads }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('[ActiveUploads] Error:', error)
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
