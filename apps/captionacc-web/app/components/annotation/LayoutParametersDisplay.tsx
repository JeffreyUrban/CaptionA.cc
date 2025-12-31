interface LayoutConfig {
  verticalPosition: number | null
  verticalStd: number | null
  boxHeight: number | null
  boxHeightStd: number | null
  anchorType: 'left' | 'center' | 'right' | null
  anchorPosition: number | null
  cropLeft: number
  cropTop: number
  cropRight: number
  cropBottom: number
}

interface LayoutParametersDisplayProps {
  layoutConfig: LayoutConfig | null
}

export function LayoutParametersDisplay({ layoutConfig }: LayoutParametersDisplayProps) {
  if (!layoutConfig) return null

  return (
    <div>
      <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Layout Parameters
      </div>
      <div className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-400">
        <div>
          Vertical Position: {layoutConfig.verticalPosition ?? 'N/A'}px (±
          {layoutConfig.verticalStd ?? 'N/A'})
        </div>
        <div>
          Box Height: {layoutConfig.boxHeight ?? 'N/A'}px (±{layoutConfig.boxHeightStd ?? 'N/A'})
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
