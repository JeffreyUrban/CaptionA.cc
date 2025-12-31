interface LayoutConfig {
  cropLeft: number
  cropTop: number
  cropRight: number
  cropBottom: number
}

interface CropBoundsEdit {
  left: number
  top: number
  right: number
  bottom: number
}

interface LayoutActionButtonsProps {
  layoutApproved: boolean
  layoutConfig: LayoutConfig | null
  cropBoundsEdit: CropBoundsEdit | null
  onApprove: () => void
  onClearAll: () => void
}

export function LayoutActionButtons({
  layoutApproved,
  layoutConfig,
  cropBoundsEdit,
  onApprove,
  onClearAll,
}: LayoutActionButtonsProps) {
  const boundsUnchanged =
    layoutApproved &&
    layoutConfig &&
    cropBoundsEdit &&
    layoutConfig.cropLeft === cropBoundsEdit.left &&
    layoutConfig.cropTop === cropBoundsEdit.top &&
    layoutConfig.cropRight === cropBoundsEdit.right &&
    layoutConfig.cropBottom === cropBoundsEdit.bottom

  return (
    <>
      {/* Mark Layout Complete Button */}
      <button
        onClick={onApprove}
        disabled={!!boundsUnchanged}
        className={`w-full px-4 py-2 text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 ${
          boundsUnchanged
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500'
            : 'text-white bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 focus:ring-green-500'
        }`}
      >
        {layoutApproved ? 'Update Layout & Re-crop' : 'Approve Layout'}
      </button>

      {/* Clear All Annotations Button */}
      <button
        onClick={onClearAll}
        className="w-full px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
      >
        Clear All Annotations
      </button>
    </>
  )
}
