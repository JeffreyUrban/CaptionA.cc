/**
 * Video Paths Utility - Client-side stub
 * Server-side file system functionality removed for SPA mode
 */

/**
 * Get database path for a video (stub - not functional in browser)
 */
export function getDbPath(videoId: string): string {
  throw new Error('getDbPath is not available in SPA mode - server-side only')
}

/**
 * Get video directory path (stub - not functional in browser)
 */
export function getVideoDir(videoId: string): string {
  throw new Error('getVideoDir is not available in SPA mode - server-side only')
}

/**
 * Get all videos (stub - not functional in browser)
 */
export function getAllVideos(): string[] {
  throw new Error('getAllVideos is not available in SPA mode - server-side only')
}
