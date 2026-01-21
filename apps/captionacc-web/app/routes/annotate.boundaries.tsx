import { useSearchParams, useNavigate } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { BoundaryControlsPanel } from '~/components/annotation/BoundaryControlsPanel'
import { BoundaryFrameStack } from '~/components/annotation/BoundaryFrameStack'
import { BoundaryHelpModal } from '~/components/annotation/BoundaryHelpModal'
import { CompletionBanner } from '~/components/annotation/CompletionBanner'
import { useBoundaryWorkflowState } from '~/hooks/useBoundaryWorkflowState'
import { useImageRegeneration } from '~/hooks/useImageRegeneration'
import { getAnnotationBorderColor, getEffectiveState } from '~/utils/boundary-helpers'

export default function BoundaryWorkflow() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const videoId = searchParams.get('videoId')

  // Hooks must be called unconditionally at the top
  const workflow = useBoundaryWorkflowState({ videoId: videoId ?? '' })

  // Opportunistically process pending image regenerations during idle time
  useImageRegeneration({ videoId: videoId ?? '', enabled: !!videoId, idleDelay: 3000, maxBatch: 3 })

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

  // Switch to text correction mode
  const switchToText = () => {
    void navigate(`/annotate/text?videoId=${encodeURIComponent(videoId)}`)
  }

  // Loading state - wait for metadata AND initial position
  if (workflow.isLoadingMetadata || !workflow.isInitialized) {
    return (
      <AppLayout fullScreen>
        <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {workflow.isLoadingMetadata ? 'Loading video metadata...' : 'Loading annotations...'}
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{videoId}</div>
          </div>
        </div>
      </AppLayout>
    )
  }

  const { displayState, visibleFramePositions, canSave, totalFrames, cropWidth, cropHeight } =
    workflow

  return (
    <AppLayout fullScreen>
      <div className="flex h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] flex-col overflow-hidden px-4 py-4">
        <CompletionBanner workflowProgress={displayState.workflowProgress || 0} />

        <div className="flex h-full flex-1 gap-6 overflow-hidden">
          <BoundaryFrameStack
            visibleFramePositions={visibleFramePositions}
            frames={displayState.frames}
            currentFrameIndex={displayState.currentFrameIndex}
            totalFrames={totalFrames}
            markedStart={displayState.markedStart}
            markedEnd={displayState.markedEnd}
            activeAnnotation={displayState.activeAnnotation}
            cropWidth={cropWidth}
            cropHeight={cropHeight}
            cursorStyle={displayState.cursorStyle}
            getOpacity={workflow.getOpacity}
            getAnnotationsForFrame={workflow.getAnnotationsForFrame}
            getAnnotationBorderColor={getAnnotationBorderColor}
            onDragStart={workflow.handleDragStart}
            onMarkStart={workflow.markStartAt}
            onMarkEnd={workflow.markEndAt}
          />

          <BoundaryControlsPanel
            videoId={videoId}
            currentFrameIndex={displayState.currentFrameIndex}
            totalFrames={totalFrames}
            workflowProgress={displayState.workflowProgress || 0}
            completedFrames={displayState.completedFrames || 0}
            jumpToFrameInput={workflow.jumpToFrameInput}
            onJumpInputChange={workflow.setJumpToFrameInput}
            onJump={() => void workflow.jumpToFrame()}
            onActivateCurrentFrame={() => void workflow.activateCurrentFrameAnnotation()}
            markedStart={displayState.markedStart}
            markedEnd={displayState.markedEnd}
            onJumpToStart={workflow.jumpToStart}
            onMarkStart={workflow.markStart}
            onJumpToEnd={workflow.jumpToEnd}
            onMarkEnd={workflow.markEnd}
            onClearMarks={workflow.clearMarks}
            activeAnnotation={displayState.activeAnnotation}
            canSave={canSave}
            isSaving={workflow.isSaving}
            hasPrevAnnotation={displayState.hasPrevAnnotation}
            hasNextAnnotation={displayState.hasNextAnnotation}
            onSave={() => void workflow.saveAnnotation()}
            onPrevious={() => void workflow.navigateToAnnotation('prev')}
            onNext={() => void workflow.navigateToAnnotation('next')}
            onDelete={() => void workflow.deleteAnnotation()}
            onMarkAsIssue={() => void workflow.markAsIssue()}
            onShowHelp={() => workflow.setShowHelpModal(true)}
            onSwitchToText={switchToText}
            getEffectiveState={getEffectiveState}
          />
        </div>
      </div>

      <BoundaryHelpModal
        isOpen={workflow.showHelpModal}
        onClose={() => workflow.setShowHelpModal(false)}
      />
    </AppLayout>
  )
}
