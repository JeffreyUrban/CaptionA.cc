/**
 * Control panel component for Layout annotation workflow.
 * Contains mode toggle, controls, action buttons, and info displays.
 */

import { useNavigate } from 'react-router'

import { LayoutActionButtons } from '~/components/annotation/LayoutActionButtons'
import { LayoutAnnotationProgress } from '~/components/annotation/LayoutAnnotationProgress'
import { LayoutColorLegend } from '~/components/annotation/LayoutColorLegend'
import { LayoutCurrentFrameInfo } from '~/components/annotation/LayoutCurrentFrameInfo'
import { LayoutInstructionsPanel } from '~/components/annotation/LayoutInstructionsPanel'
import { LayoutParametersDisplay } from '~/components/annotation/LayoutParametersDisplay'
import type {
  LayoutConfig,
  FrameBoxesData,
  ViewMode,
  BoxStats,
  CropRegionEdit,
} from '~/types/layout'

interface LayoutControlPanelProps {
  videoId: string
  viewMode: ViewMode
  layoutApproved: boolean
  layoutConfig: LayoutConfig | null
  cropRegionEdit: CropRegionEdit | null
  currentFrameBoxes: FrameBoxesData | null
  boxStats: BoxStats | null
  annotationsSinceRecalc: number
  isRecalculating: boolean
  recalcThreshold: number
  showCropRegionInFrame: boolean
  onToggleCropRegion: (show: boolean) => void
  onApprove: () => void
  onClearAll: () => void
}

export function LayoutControlPanel({
  videoId,
  viewMode,
  layoutApproved,
  layoutConfig,
  cropRegionEdit,
  currentFrameBoxes,
  boxStats,
  annotationsSinceRecalc,
  isRecalculating,
  recalcThreshold,
  showCropRegionInFrame,
  onToggleCropRegion,
  onApprove,
  onClearAll,
}: LayoutControlPanelProps) {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-0 w-1/3 flex-col gap-4 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      {/* Mode toggle */}
      <div className="flex gap-2 rounded-md border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
        <button className="flex-1 rounded py-2 text-sm font-semibold bg-teal-600 text-white">
          Layout
        </button>
        <button
          onClick={() => {
            void navigate(`/annotate/review-labels?videoId=${encodeURIComponent(videoId)}`)
          }}
          className="flex-1 rounded py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          Review Labels
        </button>
      </div>

      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Layout Controls</h2>

      {/* Instructions */}
      <LayoutInstructionsPanel viewMode={viewMode} />

      {/* Annotation Progress Indicator */}
      <LayoutAnnotationProgress
        boxStats={boxStats}
        annotationsSinceRecalc={annotationsSinceRecalc}
        recalcThreshold={recalcThreshold}
      />

      {/* Layout Action Buttons */}
      <LayoutActionButtons
        layoutApproved={layoutApproved}
        layoutConfig={layoutConfig}
        cropRegionEdit={cropRegionEdit}
        isRecalculating={isRecalculating}
        onApprove={onApprove}
        onClearAll={onClearAll}
      />

      {/* Crop Region Toggle (Frame view only) */}
      {viewMode === 'frame' && (
        <div className="rounded-md bg-gray-50 p-3 dark:bg-gray-900">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={showCropRegionInFrame}
              onChange={e => onToggleCropRegion(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Show crop region overlay
            </span>
          </label>
        </div>
      )}

      {/* Current view info */}
      {viewMode === 'frame' && <LayoutCurrentFrameInfo currentFrameBoxes={currentFrameBoxes} />}

      {/* Color legend */}
      <LayoutColorLegend />

      {/* Layout parameters (read-only for now) */}
      <LayoutParametersDisplay layoutConfig={layoutConfig} />
    </div>
  )
}
