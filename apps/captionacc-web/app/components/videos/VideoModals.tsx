/**
 * Consolidated modal components for the Videos page.
 * Includes modals for folder and video operations (create, rename, delete, move)
 * as well as the error details modal.
 */

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/20/solid'

import type {
  CreateFolderModalState,
  RenameFolderModalState,
  DeleteFolderModalState,
  RenameVideoModalState,
  DeleteVideoModalState,
  ErrorModalState,
  MoveModalState,
  FolderItem,
} from '~/types/videos'

// =============================================================================
// Create Folder Modal
// =============================================================================

interface CreateFolderModalProps {
  state: CreateFolderModalState
  onClose: () => void
  folderName: string
  onFolderNameChange: (name: string) => void
  error: string | null
  loading: boolean
  onSubmit: () => void
}

export function CreateFolderModal({
  state,
  onClose,
  folderName,
  onFolderNameChange,
  error,
  loading,
  onSubmit,
}: CreateFolderModalProps) {
  return (
    <Dialog open={state.open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30 dark:bg-black/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
          <DialogTitle className="text-lg font-medium text-gray-900 dark:text-gray-200">
            {state.parentPath ? 'Create Subfolder' : 'Create New Folder'}
          </DialogTitle>
          <div className="mt-4">
            {state.parentPath && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Parent: <span className="font-mono">{state.parentPath}/</span>
              </p>
            )}
            <label
              htmlFor="folder-name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Folder name
            </label>
            <input
              type="text"
              id="folder-name"
              value={folderName}
              onChange={e => onFolderNameChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !loading) onSubmit()
              }}
              placeholder="e.g., season_1"
              className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              autoFocus
            />
            {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={!folderName.trim() || loading}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

// =============================================================================
// Rename Folder Modal
// =============================================================================

interface RenameFolderModalProps {
  state: RenameFolderModalState
  onClose: () => void
  newName: string
  onNewNameChange: (name: string) => void
  error: string | null
  loading: boolean
  onSubmit: () => void
}

export function RenameFolderModal({
  state,
  onClose,
  newName,
  onNewNameChange,
  error,
  loading,
  onSubmit,
}: RenameFolderModalProps) {
  return (
    <Dialog open={state.open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30 dark:bg-black/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
          <DialogTitle className="text-lg font-medium text-gray-900 dark:text-gray-200">
            Rename Folder
          </DialogTitle>
          <div className="mt-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Folder: <span className="font-mono">{state.folderPath}</span>
            </p>
            <label
              htmlFor="renamed-folder-name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              New name
            </label>
            <input
              type="text"
              id="renamed-folder-name"
              value={newName}
              onChange={e => onNewNameChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !loading) onSubmit()
              }}
              className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              autoFocus
            />
            {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={!newName.trim() || loading}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Renaming...' : 'Rename'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

// =============================================================================
// Delete Folder Modal
// =============================================================================

interface DeleteFolderModalProps {
  state: DeleteFolderModalState
  onClose: () => void
  error: string | null
  loading: boolean
  onSubmit: () => void
}

export function DeleteFolderModal({
  state,
  onClose,
  error,
  loading,
  onSubmit,
}: DeleteFolderModalProps) {
  return (
    <Dialog open={state.open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30 dark:bg-black/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
          <DialogTitle className="text-lg font-medium text-gray-900 dark:text-gray-200">
            Delete Folder
          </DialogTitle>
          <div className="mt-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Are you sure you want to delete the folder{' '}
              <span className="font-mono font-medium">{state.folderName}</span>?
            </p>

            {state.videoCount !== undefined && state.videoCount > 0 && (
              <div className="mt-4 rounded-md bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800 dark:text-red-300">
                      This will permanently delete {state.videoCount}{' '}
                      {state.videoCount === 1 ? 'video' : 'videos'}
                    </h3>
                    <div className="mt-2 text-sm text-red-700 dark:text-red-400">
                      <p>
                        All annotation data, frames, and video files in this folder will be lost
                        forever.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {state.videoCount === 0 && (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">This folder is empty.</p>
            )}

            <p className="mt-3 text-sm font-medium text-gray-900 dark:text-gray-200">
              This action cannot be undone.
            </p>

            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading
                ? 'Deleting...'
                : state.videoCount && state.videoCount > 0
                  ? `Delete ${state.videoCount} ${state.videoCount === 1 ? 'Video' : 'Videos'}`
                  : 'Delete Folder'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

// =============================================================================
// Rename Video Modal
// =============================================================================

interface RenameVideoModalProps {
  state: RenameVideoModalState
  onClose: () => void
  newName: string
  onNewNameChange: (name: string) => void
  error: string | null
  loading: boolean
  onSubmit: () => void
}

export function RenameVideoModal({
  state,
  onClose,
  newName,
  onNewNameChange,
  error,
  loading,
  onSubmit,
}: RenameVideoModalProps) {
  return (
    <Dialog open={state.open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30 dark:bg-black/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
          <DialogTitle className="text-lg font-medium text-gray-900 dark:text-gray-200">
            Rename Video
          </DialogTitle>
          <div className="mt-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Video: <span className="font-mono">{state.videoPath}</span>
            </p>
            <label
              htmlFor="renamed-video-name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              New name
            </label>
            <input
              type="text"
              id="renamed-video-name"
              value={newName}
              onChange={e => onNewNameChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !loading) onSubmit()
              }}
              className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              autoFocus
            />
            {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={!newName.trim() || loading}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Renaming...' : 'Rename'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

// =============================================================================
// Delete Video Modal
// =============================================================================

interface DeleteVideoModalProps {
  state: DeleteVideoModalState
  onClose: () => void
  error: string | null
  loading: boolean
  onSubmit: () => void
}

export function DeleteVideoModal({
  state,
  onClose,
  error,
  loading,
  onSubmit,
}: DeleteVideoModalProps) {
  return (
    <Dialog open={state.open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30 dark:bg-black/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
          <DialogTitle className="text-lg font-medium text-red-600 dark:text-red-400">
            Delete Video
          </DialogTitle>
          <div className="mt-4">
            <p className="text-sm text-gray-900 dark:text-gray-200 mb-2">
              Are you sure you want to delete this video?
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Video: <span className="font-mono font-semibold">{state.videoName}</span>
            </p>
            <p className="text-sm text-red-600 dark:text-red-400 font-medium">
              This will permanently delete the video, database, and all annotation data. This action
              cannot be undone.
            </p>
            {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Deleting...' : 'Delete Video'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

// =============================================================================
// Error Details Modal
// =============================================================================

interface ErrorDetailsModalProps {
  state: ErrorModalState
  onClose: () => void
}

export function ErrorDetailsModal({ state, onClose }: ErrorDetailsModalProps) {
  return (
    <Dialog open={state.open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30 dark:bg-black/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-2xl rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
          <div className="flex items-start justify-between">
            <DialogTitle className="text-lg font-medium text-red-600 dark:text-red-400">
              Error Details
            </DialogTitle>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-4">
            {state.videoId && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Video: <span className="font-mono font-semibold">{state.videoId}</span>
              </p>
            )}

            {state.errorDetails && (
              <div className="space-y-4">
                {/* Error Message */}
                <div>
                  <h3 className="text-sm font-medium text-gray-900 dark:text-gray-200 mb-1">
                    Message
                  </h3>
                  <p className="text-sm text-red-600 dark:text-red-400 font-mono bg-red-50 dark:bg-red-900/20 p-3 rounded-md border border-red-200 dark:border-red-800">
                    {state.errorDetails.message}
                  </p>
                </div>

                {/* Context */}
                {state.errorDetails.context &&
                  Object.keys(state.errorDetails.context).length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-200 mb-1">
                        Context
                      </h3>
                      <pre className="text-xs text-gray-700 dark:text-gray-300 font-mono bg-gray-50 dark:bg-gray-900 p-3 rounded-md border border-gray-200 dark:border-gray-700 overflow-x-auto">
                        {JSON.stringify(state.errorDetails.context, null, 2)}
                      </pre>
                    </div>
                  )}

                {/* Stack Trace */}
                {state.errorDetails.stack && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-200 mb-1">
                      Stack Trace
                    </h3>
                    <pre className="text-xs text-gray-700 dark:text-gray-300 font-mono bg-gray-50 dark:bg-gray-900 p-3 rounded-md border border-gray-200 dark:border-gray-700 overflow-x-auto max-h-64 overflow-y-auto">
                      {state.errorDetails.stack}
                    </pre>
                  </div>
                )}

                {/* Help Text */}
                <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 p-4 border border-blue-200 dark:border-blue-800">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg
                        className="h-5 w-5 text-blue-400"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-blue-800 dark:text-blue-300">
                        Development Error
                      </h3>
                      <div className="mt-2 text-sm text-blue-700 dark:text-blue-400">
                        <p>
                          This error typically indicates a schema mismatch or missing database
                          migration. Check the error message and context for details about which
                          column or table is missing.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Close
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

// =============================================================================
// Move Item Modal
// =============================================================================

interface MoveItemModalProps {
  state: MoveModalState
  onClose: () => void
  allFolders: FolderItem[]
  selectedFolder: string
  onFolderSelect: (folder: string) => void
  error: string | null
  loading: boolean
  onSubmit: () => void
}

export function MoveItemModal({
  state,
  onClose,
  allFolders,
  selectedFolder,
  onFolderSelect,
  error,
  loading,
  onSubmit,
}: MoveItemModalProps) {
  // Filter folders based on move constraints
  const availableFolders = allFolders.filter(f => {
    // Exclude current folder (for folders being moved)
    if (state.itemType === 'folder' && f.path === state.itemPath) {
      return false
    }
    // Exclude descendants of the folder being moved
    if (state.itemType === 'folder' && f.path.startsWith(`${state.itemPath}/`)) {
      return false
    }
    // Exclude current parent folder (for both videos and folders)
    const itemPathParts = state.itemPath?.split('/') ?? []
    const currentParent = itemPathParts.length > 1 ? itemPathParts.slice(0, -1).join('/') : ''
    if (f.path === currentParent) {
      return false
    }
    return true
  })

  return (
    <Dialog open={state.open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30 dark:bg-black/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
          <DialogTitle className="text-lg font-medium text-gray-900 dark:text-gray-200">
            Move {state.itemType === 'video' ? 'Video' : 'Folder'}
          </DialogTitle>
          <div className="mt-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {state.itemType === 'video' ? 'Video' : 'Folder'}:{' '}
              <span className="font-mono font-semibold">{state.itemName}</span>
            </p>
            <label
              htmlFor="target-folder"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Move to folder
            </label>
            <select
              id="target-folder"
              value={selectedFolder}
              onChange={e => onFolderSelect(e.target.value)}
              className="block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            >
              <option value="">Root (no folder)</option>
              {availableFolders.map(folder => (
                <option key={folder.path} value={folder.path}>
                  {folder.name}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
              Select a destination folder or choose &ldquo;Root&rdquo; to move to the top level.
            </p>
            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Moving...' : 'Move'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

// =============================================================================
// Error Alert Modal
// =============================================================================

interface ErrorAlertModalProps {
  open: boolean
  title: string
  message: string
  onClose: () => void
}

export function ErrorAlertModal({ open, title, message, onClose }: ErrorAlertModalProps) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30 dark:bg-black/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
          <DialogTitle className="text-lg font-medium text-red-600 dark:text-red-400">
            {title}
          </DialogTitle>
          <div className="mt-4">
            <p className="text-sm text-gray-900 dark:text-gray-200">{message}</p>
          </div>
          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-500"
            >
              OK
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

// =============================================================================
// Export all modal components
// =============================================================================

export {
  type CreateFolderModalProps,
  type RenameFolderModalProps,
  type DeleteFolderModalProps,
  type RenameVideoModalProps,
  type DeleteVideoModalProps,
  type ErrorDetailsModalProps,
  type MoveItemModalProps,
  type ErrorAlertModalProps,
}
