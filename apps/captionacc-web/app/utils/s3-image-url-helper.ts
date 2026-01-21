/**
 * S3 Image URL Helper - Utilities for converting S3 paths to signed URLs
 *
 * Provides helper functions for frontend components to convert s3:// URLs
 * returned from backend services into actual signed S3 URLs.
 */

import { getVideoResourceUrl } from '~/services/s3-client'

/**
 * Parse s3:// URL to extract path components
 *
 * Format: s3://full_frames/frame_0001.jpg
 */
export function parseS3Url(url: string): {
  type: 'full_frames' | 'cropped_frames' | null
  filename: string | null
} {
  if (!url.startsWith('s3://')) {
    return { type: null, filename: null }
  }

  const path = url.substring(5) // Remove 's3://'
  const parts = path.split('/')

  if (parts[0] === 'full_frames' && parts[1]) {
    return {
      type: 'full_frames',
      filename: parts[1],
    }
  }

  return { type: null, filename: null }
}

/**
 * Generate signed S3 URL from s3:// URL
 *
 * @param tenantId - Tenant identifier
 * @param videoId - Video identifier
 * @param s3Url - S3 URL (e.g., "s3://full_frames/frame_0001.jpg")
 * @param expiresIn - URL expiration in seconds (default: 1 hour)
 * @returns Signed S3 URL or null if parsing failed
 */
export async function generateSignedUrl(
  tenantId: string,
  videoId: string,
  s3Url: string,
  expiresIn = 3600
): Promise<string | null> {
  const parsed = parseS3Url(s3Url)

  if (!parsed.type || !parsed.filename) {
    console.warn(`Failed to parse S3 URL: ${s3Url}`)
    return null
  }

  try {
    const url = await getVideoResourceUrl(
      tenantId,
      videoId,
      parsed.type,
      { filename: parsed.filename },
      expiresIn
    )
    return url
  } catch (error) {
    console.error(`Failed to generate signed URL for ${s3Url}:`, error)
    return null
  }
}

/**
 * Check if URL is an S3 URL that needs conversion
 */
export function isS3Url(url: string | null | undefined): boolean {
  return !!url && url.startsWith('s3://')
}
