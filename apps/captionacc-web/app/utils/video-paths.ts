/**
 * Video path utilities for UUID-based storage
 *
 * Maps between:
 * - display_path: User-facing path like "level1/video"
 * - storage_path: Hash-bucketed UUID path like "a4/a4f2b8c3-..."
 * - videoId: UUID for the video
 *
 * NOTE: Legacy filesystem-based functions (resolveDisplayPath, getCaptionsDbPath, etc.)
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

  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'processing')

  let storagePath: string | null

  // It's a videoId - resolve directly
  storagePath = resolveVideoId(pathOrId)

  if (!storagePath) return null

  const videoDir = resolve(dataDir, ...storagePath.split('/'))
  return existsSync(videoDir) ? videoDir : null
}

/**
 * Get database path from display_path or videoId
 * DEPRECATED: Use Supabase queries instead
 * SERVER-SIDE ONLY
 */
export async function getCaptionsDbPath(pathOrId: string): Promise<string | null> {
  if (typeof window !== 'undefined') {
    throw new Error('getCaptionsDbPath is server-side only')
  }

  const { existsSync } = await import('fs')
  const { resolve } = await import('path')

  const videoDir = await getVideoDir(pathOrId)
  if (!videoDir) return null

  const dbPath = resolve(videoDir, 'captions.db')
  return existsSync(dbPath) ? dbPath : null
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
