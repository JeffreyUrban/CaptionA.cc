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
 * @deprecated Local databases are deprecated. Use Supabase queries instead.
 * Video data is now stored in Wasabi and accessed via the orchestrator service.
 * See services/orchestrator/flows/ for the new architecture.
 */
export async function resolveDisplayPath(displayPath: string): Promise<string | null> {
  throw new Error(
    `[DEPRECATED] resolveDisplayPath() called for ${displayPath}. ` +
      `Local databases are deprecated. Video data is now stored in Wasabi. ` +
      `This code path needs to be migrated to use the cloud-based architecture.`
  )
}

/**
 * Resolve videoId to storage_path
 * Uses hash-bucketing: first 2 chars of UUID
 */
export function resolveVideoId(videoId: string): string {
  return `${videoId.slice(0, 2)}/${videoId}`
}

/**
 * @deprecated Local filesystem storage is deprecated. Use Wasabi cloud storage instead.
 * Video data is now stored in Wasabi and accessed via the orchestrator service.
 * See services/orchestrator/flows/ for the new architecture.
 */
export async function getVideoDir(pathOrId: string): Promise<string | null> {
  throw new Error(
    `[DEPRECATED] getVideoDir() called for ${pathOrId}. ` +
      `Local filesystem storage is deprecated. Video data is now stored in Wasabi. ` +
      `This code path needs to be migrated to use the cloud-based architecture.`
  )
}

/**
 * @deprecated Local databases are deprecated. Use Wasabi cloud storage instead.
 * Video data is now stored in Wasabi and accessed via the orchestrator service.
 * See services/orchestrator/flows/ for the new architecture.
 */
export async function getDbPath(pathOrId: string): Promise<string | null> {
  throw new Error(
    `[DEPRECATED] getDbPath() called for ${pathOrId}. ` +
      `Local databases are deprecated. Video data is now stored in Wasabi. ` +
      `This code path needs to be migrated to use the cloud-based architecture.`
  )
}

/**
 * @deprecated Local databases are deprecated. Use Wasabi cloud storage instead.
 * Video data is now stored in Wasabi and accessed via the orchestrator service.
 * See services/orchestrator/flows/ for the new architecture.
 */
export async function getVideoMetadata(pathOrId: string): Promise<VideoMetadata | null> {
  throw new Error(
    `[DEPRECATED] getVideoMetadata() called for ${pathOrId}. ` +
      `Local databases are deprecated. Video data is now stored in Wasabi. ` +
      `This code path needs to be migrated to use the cloud-based architecture.`
  )
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
