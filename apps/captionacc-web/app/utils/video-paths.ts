/**
 * Video path utilities for UUID-based storage
 *
 * Maps between:
 * - display_path: User-facing path like "level1/video"
 * - storage_path: Hash-bucketed UUID path like "a4/a4f2b8c3-..."
 * - videoId: UUID for the video
 */

import { resolve } from 'path'
import { existsSync } from 'fs'
import Database from 'better-sqlite3'

const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')

export interface VideoMetadata {
  videoId: string
  videoHash: string
  storagePath: string
  displayPath: string
  originalFilename: string
}

/**
 * Resolve display_path to storage_path by querying databases
 *
 * Strategy: Scan all video databases to find one with matching display_path
 */
export function resolveDisplayPath(displayPath: string): string | null {
  // Scan all video directories for matching display_path
  const scanDir = (dir: string): string | null => {
    if (!existsSync(dir)) return null

    const { readdirSync, statSync } = require('fs')
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = resolve(dir, entry.name)

        // Check if this is a video directory (has annotations.db)
        const dbPath = resolve(fullPath, 'annotations.db')
        if (existsSync(dbPath)) {
          try {
            const db = new Database(dbPath, { readonly: true })
            try {
              const result = db.prepare(`
                SELECT storage_path FROM video_metadata WHERE id = 1 AND display_path = ?
              `).get(displayPath) as { storage_path: string } | undefined

              if (result) {
                return result.storage_path
              }
            } finally {
              db.close()
            }
          } catch (error) {
            // Ignore DB errors, continue scanning
          }
        } else {
          // Not a video directory, recurse
          const found = scanDir(fullPath)
          if (found) return found
        }
      }
    }

    return null
  }

  return scanDir(dataDir)
}

/**
 * Resolve videoId to storage_path
 * Uses hash-bucketing: first 2 chars of UUID
 */
export function resolveVideoId(videoId: string): string {
  return `${videoId.slice(0, 2)}/${videoId}`
}

/**
 * Get video directory path from display_path or videoId
 */
export function getVideoDir(pathOrId: string): string | null {
  // Check if it's a UUID (contains hyphens in UUID format)
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pathOrId)

  let storagePath: string | null

  if (isUUID) {
    // It's a videoId - resolve directly
    storagePath = resolveVideoId(pathOrId)
  } else {
    // It's a display_path - resolve via database query
    storagePath = resolveDisplayPath(pathOrId)
  }

  if (!storagePath) return null

  const videoDir = resolve(dataDir, ...storagePath.split('/'))
  return existsSync(videoDir) ? videoDir : null
}

/**
 * Get database path from display_path or videoId
 */
export function getDbPath(pathOrId: string): string | null {
  const videoDir = getVideoDir(pathOrId)
  if (!videoDir) return null

  const dbPath = resolve(videoDir, 'annotations.db')
  return existsSync(dbPath) ? dbPath : null
}

/**
 * Get video metadata from database
 */
export function getVideoMetadata(pathOrId: string): VideoMetadata | null {
  const dbPath = getDbPath(pathOrId)
  if (!dbPath) return null

  try {
    const db = new Database(dbPath, { readonly: true })
    try {
      const result = db.prepare(`
        SELECT video_id, video_hash, storage_path, display_path, original_filename
        FROM video_metadata
        WHERE id = 1
      `).get() as {
        video_id: string
        video_hash: string
        storage_path: string
        display_path: string
        original_filename: string
      } | undefined

      if (!result) return null

      return {
        videoId: result.video_id,
        videoHash: result.video_hash,
        storagePath: result.storage_path,
        displayPath: result.display_path,
        originalFilename: result.original_filename,
      }
    } finally {
      db.close()
    }
  } catch (error) {
    console.error(`[VideoResolution] Error reading metadata for ${pathOrId}:`, error)
    return null
  }
}

/**
 * Get all videos with their metadata
 * Scans all video databases in the data directory
 */
export function getAllVideos(): VideoMetadata[] {
  const videos: VideoMetadata[] = []

  const scanDir = (dir: string) => {
    if (!existsSync(dir)) return

    const { readdirSync } = require('fs')
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = resolve(dir, entry.name)

        // Check if this is a video directory
        const dbPath = resolve(fullPath, 'annotations.db')
        if (existsSync(dbPath)) {
          try {
            const db = new Database(dbPath, { readonly: true })
            try {
              const result = db.prepare(`
                SELECT video_id, video_hash, storage_path, display_path, original_filename
                FROM video_metadata
                WHERE id = 1
              `).get() as {
                video_id: string
                video_hash: string
                storage_path: string
                display_path: string
                original_filename: string
              } | undefined

              if (result) {
                videos.push({
                  videoId: result.video_id,
                  videoHash: result.video_hash,
                  storagePath: result.storage_path,
                  displayPath: result.display_path,
                  originalFilename: result.original_filename,
                })
              }
            } finally {
              db.close()
            }
          } catch (error) {
            // Ignore DB errors
          }
        } else {
          // Not a video directory, recurse
          scanDir(fullPath)
        }
      }
    }
  }

  scanDir(dataDir)
  return videos
}
