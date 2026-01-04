/**
 * Generic confirmation modal for Layout annotation workflow.
 * Displays a confirmation dialog with cancel and confirm actions.
 */

interface LayoutConfirmModalProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  confirmType?: 'danger' | 'primary'
  onClose: () => void
  onConfirm: () => void
}

export function LayoutConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmType = 'primary',
  onClose,
  onConfirm,
}: LayoutConfirmModalProps) {
  const getConfirmColorClasses = () => {
    switch (confirmType) {
      case 'danger':
        return 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
      default:
        return 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
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
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            ×
          </button>
        </div>

        <div className="mb-6 text-sm text-gray-700 dark:text-gray-300">
          <p className="whitespace-pre-line">{message}</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => {
              onConfirm()
              onClose()
            }}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 ${getConfirmColorClasses()}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
