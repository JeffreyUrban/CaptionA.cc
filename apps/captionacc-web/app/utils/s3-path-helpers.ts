/**
 * S3 Path Helpers - Utility functions for building S3 paths
 *
 * Provides helper functions for constructing S3 paths for various video resources.
 * These functions encapsulate the S3 path structure knowledge.
 */

/**
 * Build S3 path for a full frame image
 *
 * @param tenantId - Tenant identifier
 * @param videoId - Video identifier
 * @param filename - Frame filename (e.g., "frame_0001.jpg")
 * @returns S3 path string
 *
 * @example
 * buildFullFramePath("tenant123", "video456", "frame_0001.jpg")
 * // => "tenant123/client/videos/video456/full_frames/frame_0001.jpg"
 */
export function buildFullFramePath(tenantId: string, videoId: string, filename: string): string {
  return `${tenantId}/client/videos/${videoId}/full_frames/${filename}`
}

/**
 * Build S3 path for a cropped frame chunk (VP9 WebM)
 *
 * @param tenantId - Tenant identifier
 * @param videoId - Video identifier
 * @param version - Cropped frames version (e.g., 2)
 * @param modulo - Modulo level (e.g., 1, 4, 16)
 * @param chunkIndex - Chunk index (aligned to chunk boundaries)
 * @returns S3 path string
 *
 * @example
 * buildChunkPath("tenant123", "video456", 2, 16, 0)
 * // => "tenant123/client/videos/video456/cropped_frames_v2/modulo_16/chunk_0000.webm"
 */
export function buildChunkPath(
  tenantId: string,
  videoId: string,
  version: number,
  modulo: number,
  chunkIndex: number
): string {
  const chunkFilename = `chunk_${String(chunkIndex).padStart(4, '0')}.webm`
  return `${tenantId}/client/videos/${videoId}/cropped_frames_v${version}/modulo_${modulo}/${chunkFilename}`
}

/**
 * Build S3 path for a database file
 *
 * @param tenantId - Tenant identifier
 * @param videoId - Video identifier
 * @param dbName - Database name (e.g., "layout", "captions")
 * @returns S3 path string
 *
 * @example
 * buildDatabasePath("tenant123", "video456", "layout")
 * // => "tenant123/client/videos/video456/layout.db.gz"
 */
export function buildDatabasePath(tenantId: string, videoId: string, dbName: string): string {
  return `${tenantId}/client/videos/${videoId}/${dbName}.db.gz`
}

/**
 * Build S3 path for the video file
 *
 * @param tenantId - Tenant identifier
 * @param videoId - Video identifier
 * @returns S3 path string
 *
 * @example
 * buildVideoPath("tenant123", "video456")
 * // => "tenant123/client/videos/video456/video.mp4"
 */
export function buildVideoPath(tenantId: string, videoId: string): string {
  return `${tenantId}/client/videos/${videoId}/video.mp4`
}
