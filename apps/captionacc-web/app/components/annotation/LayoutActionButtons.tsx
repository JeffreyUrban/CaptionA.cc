interface LayoutConfig {
  cropLeft: number
  cropTop: number
  cropRight: number
  cropBottom: number
}

interface CropRegionEdit {
  left: number
  top: number
  right: number
  bottom: number
}

interface LayoutActionButtonsProps {
  layoutApproved: boolean
  layoutConfig: LayoutConfig | null
  cropRegionEdit: CropRegionEdit | null
  isRecalculating: boolean
  onApprove: () => void
  onClearAll: () => void
}

export function LayoutActionButtons({
  layoutApproved,
  layoutConfig,
  cropRegionEdit,
  isRecalculating,
  onApprove,
  onClearAll,
}: LayoutActionButtonsProps) {
  const crop_regionUnchanged =
    layoutApproved &&
    layoutConfig &&
    cropRegionEdit &&
    layoutConfig.cropLeft === cropRegionEdit.left &&
    layoutConfig.cropTop === cropRegionEdit.top &&
    layoutConfig.cropRight === cropRegionEdit.right &&
    layoutConfig.cropBottom === cropRegionEdit.bottom

  const approveDisabled = !!crop_regionUnchanged || isRecalculating

  return (
    <>
      {/* Mark Layout Complete Button */}
      <button
        onClick={onApprove}
        disabled={approveDisabled}
        className={`w-full px-4 py-2 text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 ${
          approveDisabled
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500'
            : 'text-white bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 focus:ring-green-500'
        }`}
      >
        {layoutApproved ? 'Update Layout & Re-crop' : 'Approve Layout'}
      </button>

      {/* Clear All Annotations Button */}
      <button
        onClick={onClearAll}
        disabled={isRecalculating}
        className={`w-full px-4 py-2 text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 ${
          isRecalculating
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500'
            : 'text-white bg-red-600 hover:bg-red-700 focus:ring-red-500'
        }`}
      >
        Clear All Annotations
      </button>
    </>
  )
}
