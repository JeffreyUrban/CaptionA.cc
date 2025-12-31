import type { LayoutConfig } from '~/types/review-labels'

interface ReviewLabelsParametersDisplayProps {
  layoutConfig: LayoutConfig
}

/**
 * Displays layout parameters in the Review Labels workflow.
 * Shows read-only configuration values.
 */
export function ReviewLabelsParametersDisplay({
  layoutConfig,
}: ReviewLabelsParametersDisplayProps) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Layout Parameters
      </div>
      <div className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-400">
        <div>
          Vertical Position: {layoutConfig.verticalPosition ?? 'N/A'}
          px ({'\u00B1'}
          {layoutConfig.verticalStd ?? 'N/A'})
        </div>
        <div>
          Box Height: {layoutConfig.boxHeight ?? 'N/A'}px ({'\u00B1'}
          {layoutConfig.boxHeightStd ?? 'N/A'})
        </div>
        <div>
          Anchor: {layoutConfig.anchorType ?? 'N/A'} ({layoutConfig.anchorPosition ?? 'N/A'}px)
        </div>
        <div>
          Crop: [{layoutConfig.cropLeft}, {layoutConfig.cropTop}] - [{layoutConfig.cropRight},{' '}
          {layoutConfig.cropBottom}]
        </div>
      </div>
    </div>
  )
}
