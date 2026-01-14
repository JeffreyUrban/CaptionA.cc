/**
 * S3Video - S3-backed video component with loading states
 *
 * Provides:
 * - Automatic signed URL generation from S3
 * - Loading/error states with fallback support
 * - Support for autoplay, loop, muted, controls
 * - Multiple source format support
 * - TypeScript type safety
 */

import { useState, useEffect, useRef } from 'react'
import type { VideoHTMLAttributes } from 'react'

import { getVideoResourceUrl } from '~/services/s3-client'
import type { S3PathParams } from '~/services/s3-client'

// ============================================================================
// Types
// ============================================================================

export interface S3VideoProps extends Omit<
  VideoHTMLAttributes<HTMLVideoElement>,
  'src' | 'onLoad' | 'onError' | 'autoPlay' | 'loop' | 'muted' | 'controls'
> {
  /** Video ID */
  videoId: string

  /** S3 path (relative to video directory) or full path params */
  path: string | Omit<S3PathParams, 'tenantId' | 'videoId'>

  /** Optional CSS class name */
  className?: string

  /** Callback when video loads */
  onLoad?: () => void

  /** Callback when video fails to load */
  onError?: (error: Error) => void

  /** Fallback video URL (shown on error) */
  fallbackSrc?: string

  /** URL expiration in seconds (default: 1 hour) */
  expiresIn?: number

  /** Autoplay video */
  autoPlay?: boolean

  /** Loop video */
  loop?: boolean

  /** Muted video */
  muted?: boolean

  /** Show controls */
  controls?: boolean
}

// ============================================================================
// Component
// ============================================================================

export function S3Video({
  videoId,
  path,
  className,
  onLoad,
  onError,
  fallbackSrc,
  expiresIn = 3600,
  autoPlay = false,
  loop = false,
  muted = false,
  controls = true,
  ...videoProps
}: S3VideoProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // ============================================================================
  // Fetch signed URL
  // ============================================================================

  useEffect(() => {
    let cancelled = false

    async function fetchUrl() {
      try {
        setLoading(true)
        setError(null)

        // Build path params
        let pathParams: Omit<S3PathParams, 'tenantId'>

        if (typeof path === 'string') {
          // Simple path string - assume it's the video file
          if (path === 'video.mp4' || path.includes('video.mp4')) {
            pathParams = {
              videoId,
              type: 'video',
            }
          } else {
            throw new Error(`Unsupported video path format: ${path}`)
          }
        } else {
          // Path params object
          pathParams = {
            videoId,
            ...path,
          }
        }

        // Get signed URL
        const url = await getVideoResourceUrl(videoId, pathParams.type, pathParams, expiresIn)

        if (!cancelled) {
          setSignedUrl(url)
          setLoading(false)
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))

        if (!cancelled) {
          setError(error)
          setLoading(false)
          onError?.(error)
        }
      }
    }

    void fetchUrl()

    return () => {
      cancelled = true
    }
  }, [videoId, path, expiresIn, onError])

  // ============================================================================
  // Loading state
  // ============================================================================

  if (loading) {
    return (
      <div
        className={`bg-gray-200 animate-pulse ${className ?? ''}`}
        role="video"
        aria-label="Loading video"
        style={videoProps.style}
      />
    )
  }

  // ============================================================================
  // Error state
  // ============================================================================

  if (error || !signedUrl) {
    if (fallbackSrc) {
      return (
        <video
          ref={videoRef}
          src={fallbackSrc}
          className={className}
          autoPlay={autoPlay}
          loop={loop}
          muted={muted}
          controls={controls}
          onLoadedData={() => {
            onLoad?.()
          }}
          {...videoProps}
        />
      )
    }

    return (
      <div
        className={`bg-red-100 flex items-center justify-center ${className ?? ''}`}
        role="video"
        aria-label="Failed to load video"
        style={videoProps.style}
      >
        <span className="text-red-600 text-sm">Failed to load video</span>
      </div>
    )
  }

  // ============================================================================
  // Success state
  // ============================================================================

  return (
    <video
      ref={videoRef}
      src={signedUrl}
      className={className}
      autoPlay={autoPlay}
      loop={loop}
      muted={muted}
      controls={controls}
      onLoadedData={() => {
        onLoad?.()
      }}
      onError={() => {
        const error = new Error('Video failed to load from signed URL')
        setError(error)
        onError?.(error)
      }}
      {...videoProps}
    />
  )
}

// ============================================================================
// Preload Helper
// ============================================================================

/**
 * Preload S3 video (fetch signed URL without rendering)
 *
 * Useful for preloading videos before they're needed
 */
export async function preloadS3Video(
  videoId: string,
  path: string | Omit<S3PathParams, 'tenantId' | 'videoId'>,
  expiresIn = 3600
): Promise<string> {
  // Build path params
  let pathParams: Omit<S3PathParams, 'tenantId'>

  if (typeof path === 'string') {
    if (path === 'video.mp4' || path.includes('video.mp4')) {
      pathParams = {
        videoId,
        type: 'video',
      }
    } else {
      throw new Error(`Unsupported video path format: ${path}`)
    }
  } else {
    pathParams = {
      videoId,
      ...path,
    }
  }

  // Get signed URL
  const url = await getVideoResourceUrl(videoId, pathParams.type, pathParams, expiresIn)

  // Preload video metadata
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => resolve(url)
    video.onerror = () => reject(new Error('Failed to preload video'))
    video.src = url
  })
}
