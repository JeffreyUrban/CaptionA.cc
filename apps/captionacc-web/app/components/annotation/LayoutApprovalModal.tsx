/**
 * Approval confirmation modal for Layout annotation workflow.
 * Confirms layout completion and triggers frame re-cropping.
 */

interface LayoutApprovalModalProps {
  videoId: string
  onClose: () => void
  onConfirm: () => void
  showAlert?: (title: string, message: string, type: 'info' | 'error' | 'success') => void
}

export function LayoutApprovalModal({
  videoId,
  onClose,
  onConfirm,
  showAlert,
}: LayoutApprovalModalProps) {
  const handleConfirm = async () => {
    onClose()

    try {
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(videoId)}/layout-complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ complete: true }),
        }
      )
      if (!response.ok) throw new Error('Failed to mark layout complete')

      onConfirm()

      // Trigger frame re-cropping in background
      fetch(`/api/annotations/${encodeURIComponent(videoId)}/recrop-frames`, {
        method: 'POST',
      }).catch(err => console.error('Frame re-cropping failed:', err))
    } catch (err) {
      console.error('Error marking layout complete:', err)
      showAlert?.('Approval Failed', 'Failed to mark layout complete', 'error')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white px-6 py-5 shadow-xl dark:bg-gray-800"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Approve Layout</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            x
          </button>
        </div>

        <div className="mb-6 space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p>This will perform the following actions:</p>
          <ul className="list-inside list-disc space-y-2 pl-2">
            <li>Mark layout annotation as complete</li>
            <li>Enable boundary annotation for this video</li>
            <li>Start frame re-cropping in the background</li>
          </ul>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Frame re-cropping will run in the background and may take several minutes to complete.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleConfirm()}
            className="flex-1 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:bg-green-600 dark:hover:bg-green-700"
          >
            Approve & Continue
          </button>
        </div>
      </div>
    </div>
  )
}
