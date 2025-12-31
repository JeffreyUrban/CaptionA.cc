import { useState, useEffect } from 'react'

interface VideoMetadata {
  totalFrames: number
  cropWidth: number
  cropHeight: number
}

interface UseVideoMetadataResult {
  metadata: VideoMetadata | null
  loading: boolean
  error: string | null
}

/**
 * Loads video metadata from the API.
 * Returns totalFrames, cropWidth, and cropHeight.
 *
 * @param videoId - The ID of the video to load metadata for
 * @returns Object containing metadata, loading state, and error
 */
export function useVideoMetadata(videoId: string | null | undefined): UseVideoMetadataResult {
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!videoId) {
      setLoading(false)
      return
    }

    const loadMetadata = async () => {
      try {
        setLoading(true)
        setError(null)

        const encodedVideoId = encodeURIComponent(videoId)
        const response = await fetch(`/api/videos/${encodedVideoId}/metadata`)

        if (!response.ok) {
          throw new Error('Failed to load video metadata')
        }

        const data = await response.json()

        setMetadata({
          totalFrames: data.totalFrames ?? 0,
          cropWidth: data.cropWidth ?? 0,
          cropHeight: data.cropHeight ?? 0,
        })
        setLoading(false)
      } catch (err) {
        console.error('Failed to load video metadata:', err)
        setError((err as Error).message)
        setLoading(false)
      }
    }

    void loadMetadata()
  }, [videoId])

  return { metadata, loading, error }
}
