/**
 * Layout Annotation Page
 *
 * Main coordinator component for the layout annotation workflow.
 * Uses extracted hooks for data/canvas management and extracted components for UI.
 */

import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { LayoutApprovalModal } from '~/components/annotation/LayoutApprovalModal'
import { LayoutControlPanel } from '~/components/annotation/LayoutControlPanel'
import { LayoutErrorScreen } from '~/components/annotation/LayoutErrorScreen'
import { LayoutMainCanvas } from '~/components/annotation/LayoutMainCanvas'
import { LayoutThumbnailGrid } from '~/components/annotation/LayoutThumbnailGrid'
import { ProcessingIndicator } from '~/components/ProcessingIndicator'
import { useKeyboardShortcuts } from '~/hooks/useKeyboardShortcuts'
import { useLayoutCanvas, SELECTION_PADDING } from '~/hooks/useLayoutCanvas'
import { useLayoutData } from '~/hooks/useLayoutData'
import { useProcessingStatus } from '~/hooks/useProcessingStatus'
import { useVideoTouched } from '~/hooks/useVideoTouched'
import { RECALC_THRESHOLD, type KeyboardShortcutContext } from '~/types/layout'
import { generateAnalysisThumbnail } from '~/utils/layout-canvas-helpers'
import { dispatchKeyboardShortcut } from '~/utils/layout-keyboard-handlers'

// Loader function to expose environment variables
export async function loader() {
  return {
    defaultVideoId: process.env['DEFAULT_VIDEO_ID'] ?? '',
  }
}

export default function AnnotateLayout() {
  const [searchParams] = useSearchParams()
  const videoId = searchParams.get('videoId') ?? ''

  // Mark video as being worked on
  useVideoTouched(videoId)

  // Track background processing status
  const processingStatus = useProcessingStatus(videoId)

  // Modal state
  const [showApproveModal, setShowApproveModal] = useState(false)

  // Data management hook
  const {
    frames,
    layoutConfig,
    layoutApproved,
    loading,
    error,
    setError,
    setLoading,
    viewMode,
    selectedFrameIndex,
    currentFrameBoxes,
    loadingFrame,
    analysisBoxes,
    annotationsSinceRecalc,
    analysisThumbnailUrl,
    setAnalysisThumbnailUrl,
    cropBoundsEdit,
    boxStats,
    pulseStartTime,
    frameBoxesCache,
    loadQueue,
    loadAnalysisBoxes,
    recalculateCropBounds,
    handleThumbnailClick,
    handleBoxClick,
    setCurrentFrameBoxes,
    setHasUnsyncedAnnotations,
    setAnnotationsSinceRecalc,
    setLayoutApproved,
    handleClearAll,
  } = useLayoutData({ videoId })

  // Canvas interaction hook
  const {
    imageRef,
    canvasRef,
    interactionAreaRef,
    hoveredBoxIndex,
    isSelecting,
    cancelSelection,
    handleCanvasClick,
    handleCanvasMouseMove,
    handleCanvasContextMenu,
  } = useLayoutCanvas({
    viewMode,
    currentFrameBoxes,
    layoutConfig,
    analysisBoxes,
    videoId,
    selectedFrameIndex,
    annotationsSinceRecalc,
    pulseStartTime,
    frameBoxesCache,
    setCurrentFrameBoxes,
    setHasUnsyncedAnnotations,
    setAnnotationsSinceRecalc,
    handleBoxClick,
    recalculateCropBounds,
    loadAnalysisBoxes,
  })

  // Generate analysis thumbnail when boxes or config change
  useEffect(() => {
    if (!analysisBoxes || !layoutConfig) {
      setAnalysisThumbnailUrl(null)
      return
    }

    const thumbnailUrl = generateAnalysisThumbnail(analysisBoxes, layoutConfig)
    setAnalysisThumbnailUrl(thumbnailUrl)
  }, [analysisBoxes, layoutConfig, setAnalysisThumbnailUrl])

  // Keyboard shortcut context
  const keyboardContext: KeyboardShortcutContext = useMemo(
    () => ({
      viewMode,
      selectedFrameIndex,
      frames,
      hoveredBoxIndex,
      currentFrameBoxes,
      isSelecting,
      handleThumbnailClick,
      handleBoxClick,
      cancelSelection,
    }),
    [
      viewMode,
      selectedFrameIndex,
      frames,
      hoveredBoxIndex,
      currentFrameBoxes,
      isSelecting,
      handleThumbnailClick,
      handleBoxClick,
      cancelSelection,
    ]
  )

  // Keyboard shortcuts
  useKeyboardShortcuts(
    e => {
      if (dispatchKeyboardShortcut(e.key, keyboardContext)) {
        e.preventDefault()
      }
    },
    [keyboardContext]
  )

  // Handle error retry
  const handleRetry = () => {
    setError(null)
    setLoading(true)
    void loadQueue(true)
  }

  // Handle clear all with confirmation
  const handleClearAllWithConfirmation = () => {
    const confirmMessage =
      'Clear all layout annotations? This will:\n\n' +
      '- Delete all user annotations\n' +
      '- Reset predictions to seed model\n' +
      '- Recalculate crop bounds\n\n' +
      'This action cannot be undone.'

    if (confirm(confirmMessage)) {
      void handleClearAll()
    }
  }

  // Show error screen if there's an error
  if (error) {
    return (
      <AppLayout>
        <LayoutErrorScreen error={error} onRetry={handleRetry} />
      </AppLayout>
    )
  }

  return (
    <AppLayout fullScreen={true}>
      <div
        className="flex flex-col gap-4 p-4 overflow-hidden"
        style={{ height: 'calc(100vh - 4rem)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Caption Layout Annotation
            </h1>
            <div className="text-sm text-gray-600 dark:text-gray-400">Video: {videoId}</div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-1 min-h-0 gap-4 overflow-hidden">
          {/* Left: Canvas (2/3 width) */}
          <div className="flex min-h-0 w-2/3 flex-col gap-4">
            {/* Main canvas */}
            <LayoutMainCanvas
              viewMode={viewMode}
              layoutConfig={layoutConfig}
              currentFrameBoxes={currentFrameBoxes}
              analysisBoxes={analysisBoxes}
              loadingFrame={loadingFrame}
              annotationsSinceRecalc={annotationsSinceRecalc}
              selectionPadding={SELECTION_PADDING}
              imageRef={imageRef}
              canvasRef={canvasRef}
              interactionAreaRef={interactionAreaRef}
              onMouseDown={handleCanvasClick}
              onMouseMove={handleCanvasMouseMove}
              onContextMenu={handleCanvasContextMenu}
            />

            {/* Processing status indicator */}
            <ProcessingIndicator status={processingStatus} />

            {/* Thumbnail panel */}
            <LayoutThumbnailGrid
              frames={frames}
              viewMode={viewMode}
              selectedFrameIndex={selectedFrameIndex}
              analysisThumbnailUrl={analysisThumbnailUrl}
              loading={loading}
              onThumbnailClick={handleThumbnailClick}
            />
          </div>

          {/* Right: Controls (1/3 width) */}
          <LayoutControlPanel
            videoId={videoId}
            viewMode={viewMode}
            layoutApproved={layoutApproved}
            layoutConfig={layoutConfig}
            cropBoundsEdit={cropBoundsEdit}
            currentFrameBoxes={currentFrameBoxes}
            boxStats={boxStats}
            annotationsSinceRecalc={annotationsSinceRecalc}
            recalcThreshold={RECALC_THRESHOLD}
            onApprove={() => setShowApproveModal(true)}
            onClearAll={handleClearAllWithConfirmation}
          />
        </div>
      </div>

      {/* Layout Approval Confirmation Modal */}
      {showApproveModal && (
        <LayoutApprovalModal
          videoId={videoId}
          onClose={() => setShowApproveModal(false)}
          onConfirm={() => setLayoutApproved(true)}
        />
      )}
    </AppLayout>
  )
}
