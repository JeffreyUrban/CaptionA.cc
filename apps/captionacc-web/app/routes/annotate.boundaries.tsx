import { useSearchParams, useNavigate } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { BoundaryControlsPanel } from '~/components/annotation/BoundaryControlsPanel'
import { BoundaryFrameStack } from '~/components/annotation/BoundaryFrameStack'
import { BoundaryHelpModal } from '~/components/annotation/BoundaryHelpModal'
import { CompletionBanner } from '~/components/annotation/CompletionBanner'
import { useBoundaryWorkflowState } from '~/hooks/useBoundaryWorkflowState'
import { getAnnotationBorderColor, getEffectiveState } from '~/utils/boundary-helpers'

// Loader function to expose environment variables
export async function loader() {
  return {
    defaultVideoId: process.env['DEFAULT_VIDEO_ID'] ?? '',
  }
}

export default function BoundaryWorkflow() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const videoId = searchParams.get('videoId') ?? ''

  const workflow = useBoundaryWorkflowState({ videoId })

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
            frameSpacing={workflow.frameSpacing}
            onFrameSpacingChange={workflow.setFrameSpacing}
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
