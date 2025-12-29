#!/usr/bin/env tsx
/**
 * Cleanup script for stale uploads
 *
 * Automatically clears incomplete uploads older than 24 hours.
 * Run this periodically via cron or systemd timer.
 *
 * Usage:
 *   npx tsx scripts/cleanup-stale-uploads.ts
 *
 * Recommended cron schedule (daily at 2am):
 *   0 2 * * * cd /path/to/captionacc-web && npx tsx scripts/cleanup-stale-uploads.ts
 */

import { readdirSync, unlinkSync, existsSync, statSync, readFileSync } from 'fs'
import { resolve } from 'path'

import Database from 'better-sqlite3'

const STALE_THRESHOLD_HOURS = 24

function cleanupStaleUploads() {
  const uploadsDir = resolve(process.cwd(), '..', '..', 'local', 'uploads')

  if (!existsSync(uploadsDir)) {
    console.log('[Cleanup] Uploads directory does not exist')
    return
  }

  console.log('[Cleanup] Scanning for stale uploads...')

  const now = Date.now()
  const staleThreshold = STALE_THRESHOLD_HOURS * 60 * 60 * 1000
  let scanned = 0
  let cleared = 0

  // Find all .json metadata files
  const files = readdirSync(uploadsDir).filter(f => f.endsWith('.json'))
  scanned = files.length

  for (const jsonFile of files) {
    const uploadId = jsonFile.replace('.json', '')
    const metadataPath = resolve(uploadsDir, jsonFile)
    const uploadPath = resolve(uploadsDir, uploadId)

    try {
      // Check file age
      const stats = statSync(metadataPath)
      const ageMs = now - stats.mtimeMs

      if (ageMs > staleThreshold) {
        // Read metadata before deleting
        let metadata: unknown = null
        if (existsSync(metadataPath)) {
          metadata = JSON.parse(readFileSync(metadataPath, 'utf-8')) as unknown
        }

        const metadataObj = metadata as {
          metadata?: { videoPath?: string; storagePath?: string }
          uploadLength?: number
        } | null
        const videoPath = metadataObj?.metadata?.videoPath || uploadId
        const progress =
          metadataObj && existsSync(uploadPath) && metadataObj.uploadLength
            ? Math.round((statSync(uploadPath).size / metadataObj.uploadLength) * 100)
            : 0

        console.log(
          `[Cleanup] Clearing stale upload: ${videoPath} (${progress}% complete, ${Math.round(ageMs / (60 * 60 * 1000))}h old)`
        )

        // Delete partial upload file
        if (existsSync(uploadPath)) {
          unlinkSync(uploadPath)
        }

        // Delete metadata file
        if (existsSync(metadataPath)) {
          unlinkSync(metadataPath)
        }

        // Mark database as error if it exists
        if (metadataObj?.metadata?.storagePath) {
          const dbPath = resolve(
            process.cwd(),
            '..',
            '..',
            'local',
            'data',
            ...metadataObj.metadata.storagePath.split('/'),
            'annotations.db'
          )

          if (existsSync(dbPath)) {
            try {
              const db = new Database(dbPath)
              try {
                db.prepare(
                  `
                  UPDATE processing_status
                  SET status = 'error',
                      error_message = 'Upload stalled and automatically cleared after 24h',
                      deleted = 1,
                      deleted_at = datetime('now')
                  WHERE id = 1
                `
                ).run()
              } finally {
                db.close()
              }
            } catch (error) {
              console.error(`[Cleanup] Failed to update database for ${videoPath}:`, error)
            }
          }
        }

        cleared++
      }
    } catch (error) {
      console.error(`[Cleanup] Error processing ${jsonFile}:`, error)
    }
  }

  console.log(`[Cleanup] Scanned ${scanned} uploads, cleared ${cleared} stale uploads`)
}

// Run cleanup
cleanupStaleUploads()
