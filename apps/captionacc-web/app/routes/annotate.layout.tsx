/**
 * Layout Annotation Page
 *
 * Main coordinator component for the layout annotation workflow.
 * Uses extracted hooks for data/canvas management and extracted components for UI.
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate, redirect, useLoaderData } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { LayoutAlertModal } from '~/components/annotation/LayoutAlertModal'
import { LayoutApprovalModal } from '~/components/annotation/LayoutApprovalModal'
import { LayoutConfirmModal } from '~/components/annotation/LayoutConfirmModal'
import { LayoutControlPanel } from '~/components/annotation/LayoutControlPanel'
import { LayoutErrorScreen } from '~/components/annotation/LayoutErrorScreen'
import { LayoutMainCanvas } from '~/components/annotation/LayoutMainCanvas'
import { LayoutThumbnailGrid } from '~/components/annotation/LayoutThumbnailGrid'
import { useKeyboardShortcuts } from '~/hooks/useKeyboardShortcuts'
import { useLayoutCanvas, SELECTION_PADDING } from '~/hooks/useLayoutCanvas'
import { useLayoutData } from '~/hooks/useLayoutData'
import { useLayoutDatabase } from '~/hooks/useLayoutDatabase'
import { useVideoTouched } from '~/hooks/useVideoTouched'
import { supabase } from '~/services/supabase-client'
import { RECALC_THRESHOLD, type KeyboardShortcutContext } from '~/types/layout'
import { generateAnalysisThumbnail } from '~/utils/layout-canvas-helpers'
import { dispatchKeyboardShortcut } from '~/utils/layout-keyboard-handlers'

// =============================================================================
// Loader
// =============================================================================

export async function clientLoader({ request }: { request: Request }) {
  // Get videoId from URL
  const url = new URL(request.url)
  const videoId = url.searchParams.get('videoId')

  if (!videoId) {
    throw new Response('Missing videoId parameter', { status: 400 })
  }

  // Get authenticated user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (!user || authError) {
    throw redirect('/login')
  }

  // Fetch video metadata including tenant_id and layout_status
  const { data: video, error: videoError } = await supabase
    .from('videos')
    .select('id, tenant_id, layout_status')
    .eq('id', videoId)
    .single()

  if (videoError || !video) {
    throw new Response('Video not found', { status: 404 })
  }

  // Ensure video has tenant_id (should always exist)
  if (!video.tenant_id) {
    throw new Response('Video is missing tenant ID', { status: 500 })
  }

  // Check if video is ready for layout annotation
  if (video.layout_status === 'wait') {
    throw new Response('Video is still being processed. Please wait.', { status: 425 })
  }

  return {
    videoId: video.id,
    tenantId: video.tenant_id,
    layoutStatus: video.layout_status,
  }
}

// =============================================================================
// Component
// =============================================================================

// Large layout page component with multiple UI sections - acceptable length for annotation page
/* eslint-disable max-lines-per-function */
export default function AnnotateLayout() {
  const loaderData = useLoaderData<typeof clientLoader>()
  const { videoId: loaderVideoId, tenantId } = loaderData
  const navigate = useNavigate()

  // Use videoId from loader (already validated)
  const videoId = loaderVideoId

  // Mark video as being worked on
  useVideoTouched(videoId)

  // Initialize CR-SQLite database (required before useLayoutData)
  const layoutDb = useLayoutDatabase({
    videoId,
    tenantId, // Use actual tenant ID from loader
    autoAcquireLock: true,
    onError: error => {
      console.error('[AnnotateLayout] Layout database error:', error)
    },
  })

  // Modal state
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showClearConfirmModal, setShowClearConfirmModal] = useState(false)
  const [alertModal, setAlertModal] = useState<{
    title: string
    message: string
    type: 'info' | 'error' | 'success'
  } | null>(null)

  // Frame view toggle state
  const [showCropBoundsInFrame, setShowCropBoundsInFrame] = useState(false)

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
    isRecalculating,
    isCalculatingPredictions,
    boundsMismatch,
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
  } = useLayoutData({
    videoId,
    isDbReady: layoutDb.isReady,
    showAlert: (title, message, type) => setAlertModal({ title, message, type }),
  })

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
    showCropBoundsInFrame,
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
    setShowClearConfirmModal(true)
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
              layoutApproved={layoutApproved}
              boundsMismatch={boundsMismatch}
              currentFrameBoxes={currentFrameBoxes}
              analysisBoxes={analysisBoxes}
              loadingFrame={loadingFrame}
              isCalculatingPredictions={isCalculatingPredictions}
              annotationsSinceRecalc={annotationsSinceRecalc}
              selectionPadding={SELECTION_PADDING}
              imageRef={imageRef}
              canvasRef={canvasRef}
              interactionAreaRef={interactionAreaRef}
              onMouseDown={handleCanvasClick}
              onMouseMove={handleCanvasMouseMove}
              onContextMenu={handleCanvasContextMenu}
              tenantId={tenantId}
              videoId={videoId}
            />

            {/* Thumbnail panel */}
            <LayoutThumbnailGrid
              frames={frames}
              viewMode={viewMode}
              selectedFrameIndex={selectedFrameIndex}
              analysisThumbnailUrl={analysisThumbnailUrl}
              loading={loading}
              onThumbnailClick={handleThumbnailClick}
              tenantId={tenantId}
              videoId={videoId}
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
            isRecalculating={isRecalculating}
            recalcThreshold={RECALC_THRESHOLD}
            showCropBoundsInFrame={showCropBoundsInFrame}
            onToggleCropBounds={setShowCropBoundsInFrame}
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
          onConfirm={() => {
            setLayoutApproved(true)
            void navigate('/videos')
          }}
          showAlert={(title, message, type) => setAlertModal({ title, message, type })}
        />
      )}

      {/* Clear All Confirmation Modal */}
      {showClearConfirmModal && (
        <LayoutConfirmModal
          title="Clear All Annotations"
          message={`Clear all layout annotations? This will:\n\n• Delete all user annotations\n• Reset predictions to seed model\n• Recalculate crop bounds\n\nThis action cannot be undone.`}
          confirmLabel="Clear All"
          cancelLabel="Cancel"
          confirmType="danger"
          onClose={() => setShowClearConfirmModal(false)}
          onConfirm={() => void handleClearAll()}
        />
      )}

      {/* Alert Modal */}
      {alertModal && (
        <LayoutAlertModal
          title={alertModal.title}
          message={alertModal.message}
          type={alertModal.type}
          onClose={() => setAlertModal(null)}
        />
      )}
    </AppLayout>
  )
}
