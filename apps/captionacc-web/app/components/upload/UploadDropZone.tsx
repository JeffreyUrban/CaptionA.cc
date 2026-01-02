/**
 * Drop zone component for the upload workflow.
 * Displays the drag-and-drop area and file/folder selection buttons.
 */

import { CloudArrowUpIcon } from '@heroicons/react/20/solid'
import { FolderIcon, DocumentIcon } from '@heroicons/react/24/outline'
import { useRef } from 'react'

interface UploadDropZoneProps {
  dragActive: boolean
  onDragEnter: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
}

/**
 * Drop zone with file/folder selection buttons for video uploads.
 */
export function UploadDropZone({
  dragActive,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileSelect,
}: UploadDropZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      {/* Drop Zone */}
      <div
        className={`
          relative border-2 border-dashed rounded-lg p-12 text-center
          transition-colors
          ${
            dragActive
              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
              : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'
          }
        `}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
        <div className="mt-4">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-200">
            Drag folder or videos here
          </p>
        </div>
        <div className="mt-4 text-xs text-gray-500 dark:text-gray-500">
          Supports: MP4, MKV, AVI, MOV, WebM
        </div>

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*"
          onChange={onFileSelect}
          className="hidden"
        />
        <input
          ref={folderInputRef}
          type="file"
          {...({
            webkitdirectory: '',
            directory: '',
          } as React.InputHTMLAttributes<HTMLInputElement>)}
          onChange={onFileSelect}
          className="hidden"
        />
      </div>

      {/* Action Buttons */}
      <div className="mt-6 space-y-3">
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => folderInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <FolderIcon className="h-5 w-5" />
            Upload Folder
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <DocumentIcon className="h-5 w-5" />
            Upload Files
          </button>
        </div>
        <p className="text-xs text-center text-gray-500 dark:text-gray-400">
          Note: Your browser may ask for permission to access folders
        </p>
      </div>
    </>
  )
}
