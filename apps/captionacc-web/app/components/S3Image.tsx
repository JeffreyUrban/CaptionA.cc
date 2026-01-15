/**
 * S3Image - S3-backed image component with loading states
 *
 * Provides:
 * - Automatic signed URL generation from S3
 * - Loading/error states with fallback support
 * - Preloading support for performance
 * - Frame cache integration
 * - TypeScript type safety
 */

import { useState, useEffect, type ImgHTMLAttributes } from 'react'

import { getVideoResourceUrl, type S3PathParams } from '~/services/s3-client'

// ============================================================================
// Types
// ============================================================================

export interface S3ImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'alt' | 'onLoad' | 'onError'
> {
  /** Video ID */
  videoId: string

  /** S3 path (relative to video directory) or full path params */
  path: string | Omit<S3PathParams, 'tenantId' | 'videoId'>

  /** Alt text for image */
  alt: string

  /** Optional CSS class name */
  className?: string

  /** Callback when image loads */
  onLoad?: () => void

  /** Callback when image fails to load */
  onError?: (error: Error) => void

  /** Fallback image URL (shown on error) */
  fallbackSrc?: string

  /** Preload image (fetch URL without rendering) */
  preload?: boolean

  /** URL expiration in seconds (default: 1 hour) */
  expiresIn?: number
}

// ============================================================================
// Component
// ============================================================================

export function S3Image({
  videoId,
  path,
  alt,
  className,
  onLoad,
  onError,
  fallbackSrc,
  preload = false,
  expiresIn = 3600,
  ...imgProps
}: S3ImageProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

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
          // Simple path string - parse to determine type
          if (path.includes('full_frames/')) {
            const filename = path.split('full_frames/')[1]
            pathParams = {
              videoId,
              type: 'full_frames',
              filename,
            }
          } else if (path.includes('cropped_frames')) {
            // Parse cropped frames path
            // Example: cropped_frames_v2/modulo_16/chunk_0001.webm
            const match = path.match(/cropped_frames_v(\d+)\/modulo_(\d+)\/chunk_(\d+)\.webm/)
            if (match?.[1] && match[2] && match[3]) {
              pathParams = {
                videoId,
                type: 'cropped_frames',
                croppedFramesVersion: parseInt(match[1]),
                modulo: parseInt(match[2]),
                chunkIndex: parseInt(match[3]),
              }
            } else {
              throw new Error(`Invalid cropped frames path: ${path}`)
            }
          } else {
            throw new Error(`Unsupported path format: ${path}`)
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
  // Preload mode
  // ============================================================================

  if (preload) {
    // In preload mode, don't render anything
    return null
  }

  // ============================================================================
  // Loading state
  // ============================================================================

  if (loading) {
    return (
      <div
        className={`bg-gray-200 animate-pulse ${className ?? ''}`}
        role="img"
        aria-label={`Loading ${alt}`}
        style={imgProps.style}
      />
    )
  }

  // ============================================================================
  // Error state
  // ============================================================================

  if (error || !signedUrl) {
    if (fallbackSrc) {
      return <img src={fallbackSrc} alt={alt} className={className} {...imgProps} />
    }

    return (
      <div
        className={`bg-red-100 flex items-center justify-center ${className ?? ''}`}
        role="img"
        aria-label={`Failed to load ${alt}`}
        style={imgProps.style}
      >
        <span className="text-red-600 text-sm">Failed to load image</span>
      </div>
    )
  }

  // ============================================================================
  // Success state
  // ============================================================================

  return (
    <img
      src={signedUrl}
      alt={alt}
      className={className}
      onLoad={() => {
        onLoad?.()
      }}
      onError={() => {
        const error = new Error('Image failed to load from signed URL')
        setError(error)
        onError?.(error)
      }}
      {...imgProps}
    />
  )
}

// ============================================================================
// Preload Helper
// ============================================================================

/**
 * Preload S3 image (fetch signed URL without rendering)
 *
 * Useful for preloading images before they're needed
 */
export async function preloadS3Image(
  videoId: string,
  path: string | Omit<S3PathParams, 'tenantId' | 'videoId'>,
  expiresIn = 3600
): Promise<string> {
  // Build path params
  let pathParams: Omit<S3PathParams, 'tenantId'>

  if (typeof path === 'string') {
    if (path.includes('full_frames/')) {
      const filename = path.split('full_frames/')[1]
      pathParams = {
        videoId,
        type: 'full_frames',
        filename,
      }
    } else if (path.includes('cropped_frames')) {
      const match = path.match(/cropped_frames_v(\d+)\/modulo_(\d+)\/chunk_(\d+)\.webm/)
      if (match?.[1] && match[2] && match[3]) {
        pathParams = {
          videoId,
          type: 'cropped_frames',
          croppedFramesVersion: parseInt(match[1]),
          modulo: parseInt(match[2]),
          chunkIndex: parseInt(match[3]),
        }
      } else {
        throw new Error(`Invalid cropped frames path: ${path}`)
      }
    } else {
      throw new Error(`Unsupported path format: ${path}`)
    }
  } else {
    pathParams = {
      videoId,
      ...path,
    }
  }

  // Get signed URL
  const url = await getVideoResourceUrl(videoId, pathParams.type, pathParams, expiresIn)

  // Preload image
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(url)
    img.onerror = () => reject(new Error('Failed to preload image'))
    img.src = url
  })
}
