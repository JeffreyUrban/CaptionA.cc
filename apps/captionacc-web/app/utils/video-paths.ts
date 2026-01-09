/**
 * Video path utilities for UUID-based storage
 *
 * Maps between:
 * - display_path: User-facing path like "level1/video"
 * - storage_path: Hash-bucketed UUID path like "a4/a4f2b8c3-..."
 * - videoId: UUID for the video
 *
 * NOTE: Legacy filesystem-based functions (resolveDisplayPath, getDbPath, etc.)
 * are deprecated and only work server-side. getAllVideos() now uses Supabase.
 */

export interface VideoMetadata {
  videoId: string
  videoHash: string
  storagePath: string
  displayPath: string
  originalFilename: string
}

/**
 * Resolve display_path to storage_path by querying databases
 * DEPRECATED: Use Supabase queries instead
 * SERVER-SIDE ONLY
 *
 * Strategy: Scan all video databases to find one with matching display_path
 */
export async function resolveDisplayPath(displayPath: string): Promise<string | null> {
  if (typeof window !== 'undefined') {
    throw new Error('resolveDisplayPath is server-side only')
  }

  const { existsSync, readdirSync } = await import('fs')
  const { resolve } = await import('path')
  const Database = (await import('better-sqlite3')).default

  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')

  // Scan all video directories for matching display_path
  const scanDir = (dir: string): string | null => {
    if (!existsSync(dir)) return null

    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = resolve(dir, entry.name)

        // Check if this is a video directory (has captions.db)
        const dbPath = resolve(fullPath, 'captions.db')
        if (existsSync(dbPath)) {
          try {
            const db = new Database(dbPath, { readonly: true })
            try {
              const result = db
                .prepare(
                  `
                SELECT storage_path FROM video_metadata WHERE id = 1 AND display_path = ?
              `
                )
                .get(displayPath) as { storage_path: string } | undefined

              if (result) {
                return result.storage_path
              }
            } finally {
              db.close()
            }
          } catch {
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
 * DEPRECATED: Use Supabase queries instead
 * SERVER-SIDE ONLY
 */
export async function getVideoDir(pathOrId: string): Promise<string | null> {
  if (typeof window !== 'undefined') {
    throw new Error('getVideoDir is server-side only')
  }

  const { existsSync } = await import('fs')
  const { resolve } = await import('path')

  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')

  // Check if it's a UUID (contains hyphens in UUID format)
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pathOrId)

  let storagePath: string | null

  if (isUUID) {
    // It's a videoId - resolve directly
    storagePath = resolveVideoId(pathOrId)
  } else {
    // It's a display_path - resolve via database query
    storagePath = await resolveDisplayPath(pathOrId)
  }

  if (!storagePath) return null

  const videoDir = resolve(dataDir, ...storagePath.split('/'))
  return existsSync(videoDir) ? videoDir : null
}

/**
 * Get database path from display_path or videoId
 * DEPRECATED: Use Supabase queries instead
 * SERVER-SIDE ONLY
 */
export async function getDbPath(pathOrId: string): Promise<string | null> {
  if (typeof window !== 'undefined') {
    throw new Error('getDbPath is server-side only')
  }

  const { existsSync } = await import('fs')
  const { resolve } = await import('path')

  const videoDir = await getVideoDir(pathOrId)
  if (!videoDir) return null

  const dbPath = resolve(videoDir, 'captions.db')
  return existsSync(dbPath) ? dbPath : null
}

/**
 * Get video metadata from database
 * DEPRECATED: Use Supabase queries instead
 * SERVER-SIDE ONLY
 */
export async function getVideoMetadata(pathOrId: string): Promise<VideoMetadata | null> {
  if (typeof window !== 'undefined') {
    throw new Error('getVideoMetadata is server-side only')
  }

  const Database = (await import('better-sqlite3')).default

  const dbPath = await getDbPath(pathOrId)
  if (!dbPath) return null

  try {
    const db = new Database(dbPath, { readonly: true })
    try {
      const result = db
        .prepare(
          `
        SELECT video_id, video_hash, storage_path, display_path, original_filename
        FROM video_metadata
        WHERE id = 1
      `
        )
        .get() as
        | {
            video_id: string
            video_hash: string
            storage_path: string
            display_path: string
            original_filename: string
          }
        | undefined

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
 * Get all videos with their metadata from Supabase
 * RLS policies automatically filter by tenant
 */
export async function getAllVideos(): Promise<VideoMetadata[]> {
  // Import Supabase client dynamically to avoid bundling issues
  const { supabase } = await import('~/services/supabase-client')

  try {
    // Query videos from Supabase (RLS automatically filters by tenant)
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, video_path, storage_key')
      .is('deleted_at', null)
      .order('video_path')

    if (error) {
      console.error('[getAllVideos] Failed to fetch videos from Supabase:', error)
      return []
    }

    // Map to VideoMetadata format
    return (videos ?? []).map(video => {
      type VideoData = { id: string; video_path: string; storage_key: string }
      const v = video as unknown as VideoData

      // Extract storagePath from storage_key
      // Format: "processing/a4/a4f2b8c3-.../filename.mp4" -> "a4/a4f2b8c3-..."
      const storageKeyParts = v.storage_key.split('/')
      const storagePath =
        storageKeyParts.length >= 3 ? `${storageKeyParts[1]}/${storageKeyParts[2]}` : v.storage_key

      return {
        videoId: v.id,
        videoHash: v.id.slice(0, 2), // First 2 chars of UUID (hash bucket)
        storagePath,
        displayPath: v.video_path,
        originalFilename: v.storage_key.split('/').pop() ?? '',
      }
    })
  } catch (error) {
    console.error('[getAllVideos] Error fetching videos:', error)
    return []
  }
}
