/**
 * API endpoint to get incomplete uploads from local/uploads directory
 * Returns uploads that have metadata files but are not yet complete
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

interface IncompleteUpload {
  uploadId: string
  videoId: string
  videoPath: string
  filename: string
  uploadLength: number
  currentSize: number
  progress: number
  createdAt: string
}

export async function loader() {
  try {
    const uploadsDir = resolve(process.cwd(), '..', '..', 'local', 'uploads')
    const incompleteUploads: IncompleteUpload[] = []

    // Find all .json metadata files
    const files = readdirSync(uploadsDir).filter(f => f.endsWith('.json'))

    for (const jsonFile of files) {
      const uploadId = jsonFile.replace('.json', '')
      const metadataPath = resolve(uploadsDir, jsonFile)
      const uploadPath = resolve(uploadsDir, uploadId)

      try {
        const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'))

        // Check if upload file exists and get current size
        const currentSize = existsSync(uploadPath) ? statSync(uploadPath).size : 0
        const uploadLength = metadata.uploadLength ?? 0
        const progress = uploadLength > 0 ? currentSize / uploadLength : 0

        // Only include if not complete
        if (progress < 1.0) {
          incompleteUploads.push({
            uploadId,
            videoId: metadata.metadata?.videoId ?? uploadId,
            videoPath: metadata.metadata?.videoPath ?? 'Unknown',
            filename: metadata.metadata?.filename ?? 'Unknown',
            uploadLength,
            currentSize,
            progress,
            createdAt: metadata.createdAt ?? new Date().toISOString(),
          })
        }
      } catch (error) {
        console.error(`[IncompleteUploads] Error processing ${jsonFile}:`, error)
      }
    }

    return new Response(JSON.stringify({ uploads: incompleteUploads }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[IncompleteUploads] Error:', error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
