/**
 * S3 Infrastructure Usage Examples
 *
 * This file demonstrates how to use the new S3 direct access infrastructure.
 * Delete this file after integration is complete.
 */

import { useEffect } from 'react'

import { S3Image } from '~/components/S3Image'
import { S3Video } from '~/components/S3Video'
import {
  getFrame,
  setFrame,
  pinFrame,
  unpinFrame,
  createBlobUrl,
  estimateBlobSize,
  getFrameCacheStats,
} from '~/services/frame-cache'
import { getVideoResourceUrl, buildS3Path, getCurrentTenantId } from '~/services/s3-client'
import { useS3CredentialsStore, initializeS3CredentialsStore } from '~/stores/s3-credentials-store'

// ============================================================================
// Example 1: Initialize S3 credentials store (in root component)
// ============================================================================

export function AppRoot() {
  useEffect(() => {
    // Initialize S3 credentials store once when app starts
    initializeS3CredentialsStore()
  }, [])

  return <div>Your app content</div>
}

// ============================================================================
// Example 2: Use S3Image component
// ============================================================================

export function FrameThumbnail({
  tenantId,
  videoId,
  frameIndex,
}: {
  tenantId: string
  videoId: string
  frameIndex: number
}) {
  const filename = `frame_${String(frameIndex).padStart(4, '0')}.jpg`

  return (
    <S3Image
      tenantId={tenantId}
      videoId={videoId}
      path={`full_frames/${filename}`}
      alt={`Frame ${frameIndex}`}
      className="w-32 h-32 object-cover"
      onLoad={() => console.log('Frame loaded')}
      onError={error => console.error('Frame load error:', error)}
    />
  )
}

// ============================================================================
// Example 3: Use S3Video component
// ============================================================================

export function VideoPlayer({ tenantId, videoId }: { tenantId: string; videoId: string }) {
  return (
    <S3Video
      tenantId={tenantId}
      videoId={videoId}
      path="video.mp4"
      className="w-full"
      controls
      onLoad={() => console.log('Video loaded')}
      onError={error => console.error('Video load error:', error)}
    />
  )
}

// ============================================================================
// Example 4: Manually fetch S3 credentials
// ============================================================================

export function CredentialsStatus() {
  const { credentials, loading, error, fetchCredentials } = useS3CredentialsStore()

  useEffect(() => {
    void fetchCredentials()
  }, [fetchCredentials])

  if (loading) return <div>Loading credentials...</div>
  if (error) return <div>Error: {error}</div>
  if (!credentials) return <div>No credentials</div>

  return (
    <div>
      <p>Bucket: {credentials.bucket}</p>
      <p>Region: {credentials.region}</p>
      <p>Expires: {new Date(credentials.expiration).toLocaleString()}</p>
    </div>
  )
}

// ============================================================================
// Example 5: Generate signed URL programmatically
// ============================================================================

export async function getFrameUrl(
  tenantId: string,
  videoId: string,
  frameIndex: number
): Promise<string> {
  const filename = `frame_${String(frameIndex).padStart(4, '0')}.jpg`

  const url = await getVideoResourceUrl(
    tenantId,
    videoId,
    'full_frames',
    { filename },
    3600 // Expires in 1 hour
  )

  return url
}

// ============================================================================
// Example 6: Build S3 path manually
// ============================================================================

export async function buildFramePath(videoId: string, frameIndex: number): Promise<string> {
  const tenantId = await getCurrentTenantId()
  const filename = `frame_${String(frameIndex).padStart(4, '0')}.jpg`

  const path = buildS3Path({
    tenantId,
    videoId,
    type: 'full_frames',
    filename,
  })

  return path
}

// ============================================================================
// Example 7: Use frame cache
// ============================================================================

export async function cacheFrame(
  tenantId: string,
  videoId: string,
  frameIndex: number
): Promise<void> {
  // Check if already cached
  const cached = getFrame(frameIndex)
  if (cached) {
    console.log('Frame already cached:', cached.imageUrl)
    return
  }

  // Fetch frame from S3
  const filename = `frame_${String(frameIndex).padStart(4, '0')}.jpg`
  const url = await getVideoResourceUrl(tenantId, videoId, 'full_frames', { filename })

  // Download image as bytes
  const response = await fetch(url)
  const bytes = new Uint8Array(await response.arrayBuffer())

  // Create blob URL
  const blobUrl = createBlobUrl(bytes, 'image/jpeg')
  const size = estimateBlobSize(bytes)

  // Cache the frame
  setFrame(frameIndex, blobUrl, 1, size)

  // Pin frame to prevent eviction (e.g., for current annotation frame)
  pinFrame(frameIndex)

  console.log('Frame cached:', blobUrl, 'Size:', size, 'bytes')
}

// ============================================================================
// Example 8: Monitor cache stats
// ============================================================================

export function CacheStats() {
  const stats = getFrameCacheStats()

  return (
    <div>
      <p>Total Entries: {stats.totalEntries}</p>
      <p>Pinned Entries: {stats.pinnedEntries}</p>
      <p>
        Size: {(stats.totalSizeBytes / 1024 / 1024).toFixed(2)} MB /{' '}
        {(stats.maxSizeBytes / 1024 / 1024).toFixed(2)} MB
      </p>
    </div>
  )
}

// ============================================================================
// Example 9: Cropped frames (WebM chunks)
// ============================================================================

export function CroppedFrameChunk({
  tenantId,
  videoId,
  chunkIndex,
  modulo,
}: {
  tenantId: string
  videoId: string
  chunkIndex: number
  modulo: number
}) {
  return (
    <S3Image
      tenantId={tenantId}
      videoId={videoId}
      path={{
        type: 'cropped_frames',
        croppedFramesVersion: 2,
        modulo,
        chunkIndex,
      }}
      alt={`Chunk ${chunkIndex}`}
      className="w-full"
    />
  )
}

// ============================================================================
// Example 10: Unpin frame when done (allow eviction)
// ============================================================================

export function unpinFrameWhenDone(frameIndex: number): void {
  unpinFrame(frameIndex)
  console.log('Frame unpinned:', frameIndex)
}
