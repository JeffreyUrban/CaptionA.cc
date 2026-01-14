import { useState, useEffect } from 'react'

import { generateSignedUrl, isS3Url } from '~/utils/s3-image-url-helper'

interface FrameInfo {
  frameIndex: number
  imageUrl: string
  minConfidence: number
}

type ViewMode = 'analysis' | 'frame'

interface LayoutThumbnailGridProps {
  videoId: string
  frames: FrameInfo[]
  viewMode: ViewMode
  selectedFrameIndex: number | null
  analysisThumbnailUrl: string | null
  loading: boolean
  onThumbnailClick: (frameIndexOrMode: number | 'analysis') => void
}

/**
 * Thumbnail image component that handles S3 URL conversion
 */
function ThumbnailImage({
  videoId,
  imageUrl,
  alt,
}: {
  videoId: string
  imageUrl: string
  alt: string
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function convertUrl() {
      if (isS3Url(imageUrl)) {
        setLoading(true)
        const url = await generateSignedUrl(videoId, imageUrl)
        setSignedUrl(url)
        setLoading(false)
      } else {
        setSignedUrl(imageUrl)
      }
    }
    void convertUrl()
  }, [videoId, imageUrl])

  if (loading || !signedUrl) {
    return (
      <div className="h-full w-full bg-gray-300 animate-pulse flex items-center justify-center">
        <span className="text-xs text-gray-500">Loading...</span>
      </div>
    )
  }

  return <img src={signedUrl} alt={alt} className="h-full w-full object-contain" />
}

export function LayoutThumbnailGrid({
  videoId,
  frames,
  viewMode,
  selectedFrameIndex,
  analysisThumbnailUrl,
  loading,
  onThumbnailClick,
}: LayoutThumbnailGridProps) {
  return (
    <div
      className="grid w-full h-0 flex-1 auto-rows-min gap-3 overflow-y-auto rounded-lg border border-gray-300 bg-gray-200 p-3 dark:border-gray-600 dark:bg-gray-700"
      style={{
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      }}
    >
      {/* Subtitle analysis thumbnail */}
      <button
        onClick={() => onThumbnailClick('analysis')}
        className={`flex w-full flex-col overflow-hidden rounded border-2 ${
          viewMode === 'analysis' ? 'border-teal-600' : 'border-gray-300 dark:border-gray-700'
        }`}
      >
        <div className="aspect-video w-full bg-black">
          {analysisThumbnailUrl ? (
            <img
              src={analysisThumbnailUrl}
              alt="Analysis view"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-gray-500">
              Loading...
            </div>
          )}
        </div>
        <div className="flex h-11 flex-col items-center justify-center bg-gray-100 px-2 py-1 text-xs text-gray-900 dark:bg-gray-800 dark:text-gray-100">
          Analysis
        </div>
      </button>

      {/* Loading indicator while frames load */}
      {loading && frames.length === 0 && (
        <div className="col-span-full flex items-center justify-center py-8 text-gray-500 dark:text-gray-400">
          Loading frames...
        </div>
      )}

      {/* Frame thumbnails */}
      {frames.map(frame => (
        <button
          key={frame.frameIndex}
          onClick={() => onThumbnailClick(frame.frameIndex)}
          className={`flex w-full flex-col overflow-hidden rounded border-2 ${
            viewMode === 'frame' && selectedFrameIndex === frame.frameIndex
              ? 'border-teal-600'
              : 'border-gray-300 dark:border-gray-700'
          }`}
        >
          <div className="aspect-video w-full bg-black">
            <ThumbnailImage
              videoId={videoId}
              imageUrl={frame.imageUrl}
              alt={`Frame ${frame.frameIndex}`}
            />
          </div>
          <div className="flex h-11 flex-col items-center justify-center bg-gray-100 px-2 py-1 text-xs text-gray-900 dark:bg-gray-800 dark:text-gray-100">
            Frame {frame.frameIndex}
            <br />
            Min conf: {frame.minConfidence?.toFixed(2) ?? 'N/A'}
          </div>
        </button>
      ))}
    </div>
  )
}
