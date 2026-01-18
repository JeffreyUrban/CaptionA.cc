import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { LayoutColorLegend } from '~/components/annotation/LayoutColorLegend'
import { ReviewLabelsCurrentFrameInfo } from '~/components/annotation/ReviewLabelsCurrentFrameInfo'
import { ReviewLabelsInstructionsPanel } from '~/components/annotation/ReviewLabelsInstructionsPanel'
import { ReviewLabelsParametersDisplay } from '~/components/annotation/ReviewLabelsParametersDisplay'
import { useReviewLabelsCanvas } from '~/hooks/useReviewLabelsCanvas'
import { useReviewLabelsData } from '~/hooks/useReviewLabelsData'
import { useReviewLabelsKeyboardShortcuts } from '~/hooks/useReviewLabelsKeyboardShortcuts'
import type { FrameInfo, LayoutConfig, FrameBoxesData, ViewMode } from '~/types/review-labels'

export default function ReviewLabels() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const videoId = searchParams.get('videoId')!

  // VideoId is REQUIRED # TODO: Replace with our error modal.
  if (!videoId) {
    return (
      <AppLayout>
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-red-600">Missing Video ID</h1>
            <p className="mt-2 text-gray-600">This page requires a videoId parameter in the URL.</p>
            <button
              onClick={() => navigate('/videos')}
              className="mt-4 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              Go to Videos
            </button>
          </div>
        </div>
      </AppLayout>
    )
  }

  // Layout config (not currently loaded, but preserved for future use)
  const [layoutConfig] = useState<LayoutConfig | null>(null)

  // Data management
  const {
    frames,
    loading,
    error,
    setError,
    viewMode,
    selectedFrameIndex,
    currentFrameBoxes,
    loadingFrame,
    frameBoxesCache,
    loadMislabels,
    handleThumbnailClick,
    handleBoxClick,
    setCurrentFrameBoxes,
    setHasUnsyncedAnnotations,
    setLoading,
  } = useReviewLabelsData({ videoId })

  // Canvas interactions
  const {
    imageRef,
    canvasRef,
    hoveredBoxIndex,
    isSelecting,
    cancelSelection,
    handleCanvasClick,
    handleCanvasMouseMove,
    handleCanvasContextMenu,
  } = useReviewLabelsCanvas({
    viewMode,
    currentFrameBoxes,
    layoutConfig,
    videoId,
    selectedFrameIndex,
    frameBoxesCache,
    setCurrentFrameBoxes,
    setHasUnsyncedAnnotations,
    handleBoxClick,
  })

  // Keyboard shortcuts
  useReviewLabelsKeyboardShortcuts({
    viewMode,
    selectedFrameIndex,
    frames,
    hoveredBoxIndex,
    currentFrameBoxes,
    isSelecting,
    handleThumbnailClick,
    handleBoxClick,
    cancelSelection,
  })

  // Error display
  if (error) {
    return (
      <ErrorDisplay
        error={error}
        onRetry={() => {
          setError(null)
          setLoading(true)
          void loadMislabels(true)
        }}
      />
    )
  }

  return (
    <AppLayout fullScreen={true}>
      <div
        className="flex flex-col gap-4 p-4 overflow-hidden"
        style={{ height: 'calc(100vh - 4rem)' }}
      >
        <Header videoId={videoId} />

        <div className="flex flex-1 min-h-0 gap-4 overflow-hidden">
          {/* Left: Canvas + Thumbnails (2/3 width) */}
          <div className="flex min-h-0 w-2/3 flex-col gap-4">
            <CanvasSection
              currentFrameBoxes={currentFrameBoxes}
              loadingFrame={loadingFrame}
              imageRef={imageRef}
              canvasRef={canvasRef}
              handleCanvasClick={handleCanvasClick}
              handleCanvasMouseMove={handleCanvasMouseMove}
              handleCanvasContextMenu={handleCanvasContextMenu}
            />

            <ThumbnailSection
              loading={loading}
              frames={frames}
              viewMode={viewMode}
              selectedFrameIndex={selectedFrameIndex}
              handleThumbnailClick={handleThumbnailClick}
            />
          </div>

          {/* Right: Controls (1/3 width) */}
          <ControlsPanel
            videoId={videoId}
            viewMode={viewMode}
            currentFrameBoxes={currentFrameBoxes}
            layoutConfig={layoutConfig}
            navigate={navigate}
          />
        </div>
      </div>
    </AppLayout>
  )
}

// --- Presentational Components ---

interface HeaderProps {
  videoId: string
}

function Header({ videoId }: HeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Review Potential Mislabels
        </h1>
        <div className="text-sm text-gray-600 dark:text-gray-400">Video: {videoId}</div>
      </div>
    </div>
  )
}

interface CanvasSectionProps {
  currentFrameBoxes: FrameBoxesData | null
  loadingFrame: boolean
  imageRef: React.RefObject<HTMLImageElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  handleCanvasClick: (e: React.MouseEvent<HTMLCanvasElement>) => void
  handleCanvasMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void
  handleCanvasContextMenu: (e: React.MouseEvent<HTMLCanvasElement>) => void
}

function CanvasSection({
  currentFrameBoxes,
  loadingFrame,
  imageRef,
  canvasRef,
  handleCanvasClick,
  handleCanvasMouseMove,
  handleCanvasContextMenu,
}: CanvasSectionProps) {
  return (
    <div className="flex flex-shrink-0 flex-col gap-4">
      <div className="relative flex flex-shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-gray-900 dark:border-gray-600 dark:bg-gray-800 p-4">
        {currentFrameBoxes ? (
          <div className="relative inline-block max-w-full max-h-full">
            <img
              ref={imageRef}
              src={currentFrameBoxes.imageUrl}
              alt={`Frame ${currentFrameBoxes.frameIndex}`}
              className="max-w-full max-h-full object-contain"
            />
            <canvas
              ref={canvasRef}
              className="absolute left-0 top-0 cursor-crosshair"
              style={{ touchAction: 'none' }}
              onMouseDown={handleCanvasClick}
              onMouseMove={handleCanvasMouseMove}
              onContextMenu={handleCanvasContextMenu}
            />
          </div>
        ) : (
          <div className="flex min-h-[400px] items-center justify-center text-gray-500 dark:text-gray-400">
            {loadingFrame ? 'Loading frame...' : 'Select a frame to review'}
          </div>
        )}
      </div>
    </div>
  )
}

interface ThumbnailSectionProps {
  loading: boolean
  frames: FrameInfo[]
  viewMode: ViewMode
  selectedFrameIndex: number | null
  handleThumbnailClick: (frameIndex: number | 'analysis') => void
}

function ThumbnailSection({
  loading,
  frames,
  viewMode,
  selectedFrameIndex,
  handleThumbnailClick,
}: ThumbnailSectionProps) {
  return (
    <div
      className="grid w-full h-0 flex-1 auto-rows-min gap-3 overflow-y-auto rounded-lg border border-gray-300 bg-gray-200 p-3 dark:border-gray-600 dark:bg-gray-700"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
    >
      {loading && frames.length === 0 && (
        <div className="col-span-full flex items-center justify-center py-8 text-gray-500 dark:text-gray-400">
          Loading frames...
        </div>
      )}

      {frames.map(frame => (
        <button
          key={frame.frameIndex}
          onClick={() => handleThumbnailClick(frame.frameIndex)}
          className={`flex w-full flex-col overflow-hidden rounded border-2 ${
            viewMode === 'frame' && selectedFrameIndex === frame.frameIndex
              ? 'border-teal-600'
              : 'border-gray-300 dark:border-gray-700'
          }`}
        >
          <div className="aspect-video w-full bg-black">
            <img
              src={frame.imageUrl}
              alt={`Frame ${frame.frameIndex}`}
              className="h-full w-full object-contain"
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

interface ControlsPanelProps {
  videoId: string
  viewMode: ViewMode
  currentFrameBoxes: FrameBoxesData | null
  layoutConfig: LayoutConfig | null
  navigate: ReturnType<typeof useNavigate>
}

function ControlsPanel({
  videoId,
  viewMode,
  currentFrameBoxes,
  layoutConfig,
  navigate,
}: ControlsPanelProps) {
  return (
    <div className="flex min-h-0 w-1/3 flex-col gap-4 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex gap-2 rounded-md border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
        <button
          onClick={() => {
            void navigate(`/annotate/layout?videoId=${encodeURIComponent(videoId)}`)
          }}
          className="flex-1 rounded py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          Layout
        </button>
        <button className="flex-1 rounded py-2 text-sm font-semibold bg-teal-600 text-white">
          Review Labels
        </button>
      </div>

      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Mislabel Review</h2>

      <ReviewLabelsInstructionsPanel />

      {viewMode === 'frame' && currentFrameBoxes && (
        <ReviewLabelsCurrentFrameInfo currentFrameBoxes={currentFrameBoxes} />
      )}

      <LayoutColorLegend />

      {layoutConfig && <ReviewLabelsParametersDisplay layoutConfig={layoutConfig} />}
    </div>
  )
}

interface ErrorDisplayProps {
  error: string
  onRetry: () => void
}

function ErrorDisplay({ error, onRetry }: ErrorDisplayProps) {
  const isProcessing = error.startsWith('Processing:')

  return (
    <AppLayout>
      <div className="flex h-screen items-center justify-center">
        <div className="max-w-md rounded-lg border border-gray-300 bg-white p-8 dark:border-gray-700 dark:bg-gray-800">
          {isProcessing ? (
            <ProcessingMessage error={error} onRetry={onRetry} />
          ) : (
            <ErrorMessage error={error} onRetry={onRetry} />
          )}
        </div>
      </div>
    </AppLayout>
  )
}

interface ProcessingMessageProps {
  error: string
  onRetry: () => void
}

function ProcessingMessage({ error, onRetry }: ProcessingMessageProps) {
  return (
    <>
      <div className="mb-4 flex items-center justify-center">
        <svg
          className="h-12 w-12 animate-spin text-blue-500"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      </div>
      <h2 className="mb-2 text-center text-xl font-bold text-gray-900 dark:text-white">
        Video Processing
      </h2>
      <p className="mb-4 text-center text-gray-600 dark:text-gray-400">
        {error.replace('Processing: ', '')}
      </p>
      <p className="mb-6 text-center text-sm text-gray-500 dark:text-gray-500">
        The video is being processed. This page will automatically refresh when ready.
      </p>
      <button
        onClick={onRetry}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        Check Again
      </button>
    </>
  )
}

interface ErrorMessageProps {
  error: string
  onRetry: () => void
}

function ErrorMessage({ error, onRetry }: ErrorMessageProps) {
  return (
    <>
      <div className="mb-4 text-center text-red-500">
        <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <h2 className="mb-2 text-center text-xl font-bold text-gray-900 dark:text-white">
        Error Loading Mislabels
      </h2>
      <p className="mb-6 text-center text-gray-600 dark:text-gray-400">{error}</p>
      <button
        onClick={onRetry}
        className="w-full rounded-md bg-gray-600 px-4 py-2 text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
      >
        Try Again
      </button>
    </>
  )
}
