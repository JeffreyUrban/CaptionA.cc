/**
 * Generic alert modal for Layout annotation workflow.
 * Displays informational or error messages.
 */

interface LayoutAlertModalProps {
  title: string
  message: string
  type?: 'info' | 'error' | 'success'
  onClose: () => void
}

export function LayoutAlertModal({
  title,
  message,
  type = 'info',
  onClose,
}: LayoutAlertModalProps) {
  const getColorClasses = () => {
    switch (type) {
      case 'error':
        return 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
      case 'success':
        return 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
      default:
        return 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
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

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 ${getColorClasses()}`}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
