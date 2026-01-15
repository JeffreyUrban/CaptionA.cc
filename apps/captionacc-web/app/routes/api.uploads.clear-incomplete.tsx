/**
 * API endpoint to clear incomplete uploads
 * Deletes partial upload files and metadata from local/uploads
 */

import { readdirSync, unlinkSync, existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

import Database from 'better-sqlite3'

interface UploadMetadata {
  videoPath: string
  filename: string
  storagePath?: string
}

interface UploadMetadataFile {
  uploadId: string
  uploadLength: number
  metadata: UploadMetadata
  createdAt: string
  offset: number
}

function markDatabaseAsDeleted(dbPath: string): void {
  if (!existsSync(dbPath)) return

  const db = new Database(dbPath)
  try {
    db.prepare(
      `
      UPDATE processing_status
      SET status = 'error',
          error_message = 'Upload interrupted and cleared',
          deleted = 1,
          deleted_at = datetime('now')
      WHERE id = 1
    `
    ).run()
  } finally {
    db.close()
  }
}

function clearUploadFiles(
  uploadId: string,
  uploadsDir: string,
  metadata: UploadMetadataFile | null
): void {
  const metadataPath = resolve(uploadsDir, `${uploadId}.json`)
  const uploadPath = resolve(uploadsDir, uploadId)

  // Delete partial upload file
  if (existsSync(uploadPath)) {
    unlinkSync(uploadPath)
  }

  // Delete metadata file
  if (existsSync(metadataPath)) {
    unlinkSync(metadataPath)
  }

  // Also delete the database if it exists
  if (metadata?.metadata?.storagePath) {
    const dbPath = resolve(
      process.cwd(),
      '..',
      '..',
      'local',
      'data',
      ...metadata.metadata.storagePath.split('/'),
      'captions.db'
    )
    markDatabaseAsDeleted(dbPath)
  }
}

export async function action() {
  try {
    const uploadsDir = resolve(process.cwd(), '..', '..', 'local', 'uploads')
    let cleared = 0

    // Find all .json metadata files
    const files = readdirSync(uploadsDir).filter(f => f.endsWith('.json'))

    for (const jsonFile of files) {
      const uploadId = jsonFile.replace('.json', '')
      const metadataPath = resolve(uploadsDir, jsonFile)

      try {
        // Read metadata first before deleting
        let metadata: UploadMetadataFile | null = null
        if (existsSync(metadataPath)) {
          metadata = JSON.parse(readFileSync(metadataPath, 'utf-8')) as UploadMetadataFile
        }

        clearUploadFiles(uploadId, uploadsDir, metadata)
        cleared++
      } catch (error) {
        console.error(`[ClearIncomplete] Error clearing ${jsonFile}:`, error)
      }
    }

    console.log(`[ClearIncomplete] Cleared ${cleared} incomplete upload(s)`)

    return new Response(JSON.stringify({ cleared }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[ClearIncomplete] Error:', error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
