/**
 * Upload Preview & Configure Modal
 *
 * Shows preview of files to be uploaded with folder structure options
 * User must confirm before upload starts
 */

import { useState, useEffect, useMemo } from 'react'
import { XMarkIcon } from '@heroicons/react/20/solid'

import {
  type UploadFile,
  type UploadOptions,
  type FolderStructureMode,
  processUploadFiles,
  getFolderStructurePreview,
} from '~/utils/upload-folder-structure'
import { formatBytes } from '~/utils/upload-helpers'

interface UploadPreviewModalProps {
  files: UploadFile[]
  availableFolders: Array<{ path: string; name: string }>
  defaultTargetFolder: string | null
  onConfirm: (files: UploadFile[], options: UploadOptions) => void
  onCancel: () => void
}

export function UploadPreviewModal({
  files,
  availableFolders,
  defaultTargetFolder,
  onConfirm,
  onCancel,
}: UploadPreviewModalProps) {
  const [mode, setMode] = useState<FolderStructureMode>('preserve')
  const [collapseSingles, setCollapseSingles] = useState(true)
  const [targetFolder, setTargetFolder] = useState<string | null>(defaultTargetFolder)
  const [processing, setProcessing] = useState(false)

  // Process files whenever options change
  const [preview, setPreview] = useState<{
    folders: string[]
    files: Array<{ path: string; size: number }>
    totalSize: number
  } | null>(null)

  useEffect(() => {
    async function process() {
      setProcessing(true)
      try {
        const options: UploadOptions = { mode, collapseSingles, targetFolder }
        const processed = await processUploadFiles(files, options)
        const previewData = getFolderStructurePreview(processed)
        setPreview(previewData)
      } catch (error) {
        console.error('[UploadPreviewModal] Error processing files:', error)
      } finally {
        setProcessing(false)
      }
    }
    void process()
  }, [files, mode, collapseSingles, targetFolder])

  const handleConfirm = () => {
    const options: UploadOptions = { mode, collapseSingles, targetFolder }
    onConfirm(files, options)
  }

  const totalCount = files.length
  const totalSize = useMemo(() => files.reduce((sum, f) => sum + f.file.size, 0), [files])

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={onCancel} />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Upload Videos
            </h2>
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {/* File Count Summary */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3">
              <p className="text-sm text-blue-900 dark:text-blue-100">
                Found <span className="font-semibold">{totalCount} video files</span>
                {files[0] && files[0].relativePath.includes('/') && (
                  <span> in folder structure</span>
                )}
              </p>
            </div>

            {/* Folder Structure Options */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Folder Structure
              </label>

              <div className="space-y-2">
                <label className="flex items-start space-x-3 cursor-pointer group">
                  <input
                    type="radio"
                    checked={mode === 'preserve'}
                    onChange={() => setMode('preserve')}
                    className="mt-1 text-teal-600 focus:ring-teal-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-teal-600 dark:group-hover:text-teal-400">
                      Preserve folder structure{' '}
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        (recommended)
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Maintain the original folder organization
                    </div>
                  </div>
                </label>

                <label className="flex items-start space-x-3 cursor-pointer group">
                  <input
                    type="radio"
                    checked={mode === 'flatten'}
                    onChange={() => setMode('flatten')}
                    className="mt-1 text-teal-600 focus:ring-teal-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-teal-600 dark:group-hover:text-teal-400">
                      Flatten
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Place all files directly in target folder
                    </div>
                  </div>
                </label>
              </div>

              {/* Collapse Singles Option (only for preserve mode) */}
              {mode === 'preserve' && (
                <label className="flex items-start space-x-3 cursor-pointer group mt-3 pl-6">
                  <input
                    type="checkbox"
                    checked={collapseSingles}
                    onChange={e => setCollapseSingles(e.target.checked)}
                    className="mt-1 text-teal-600 focus:ring-teal-500 rounded"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-teal-600 dark:group-hover:text-teal-400">
                      Collapse single-file folders
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Remove folders that contain only one video file
                    </div>
                  </div>
                </label>
              )}
            </div>

            {/* Target Folder */}
            <div className="space-y-2">
              <label
                htmlFor="target-folder"
                className="text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Upload to folder (optional)
              </label>
              <select
                id="target-folder"
                value={targetFolder || ''}
                onChange={e => setTargetFolder(e.target.value || null)}
                className="block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm focus:border-teal-500 focus:ring-teal-500 sm:text-sm"
              >
                <option value="">Root (no folder)</option>
                {availableFolders.map(folder => (
                  <option key={folder.path} value={folder.path}>
                    {folder.path}
                  </option>
                ))}
              </select>
            </div>

            {/* Preview */}
            {processing ? (
              <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
                Processing folder structure...
              </div>
            ) : (
              preview && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Preview
                    </label>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {preview.files.length} files, {formatBytes(preview.totalSize)}
                    </span>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 max-h-60 overflow-y-auto">
                    <div className="font-mono text-xs space-y-1">
                      {preview.files.slice(0, 20).map((file, idx) => (
                        <div key={idx} className="text-gray-700 dark:text-gray-300">
                          📄 {file.path}{' '}
                          <span className="text-gray-400 dark:text-gray-500">
                            ({formatBytes(file.size)})
                          </span>
                        </div>
                      ))}
                      {preview.files.length > 20 && (
                        <div className="text-gray-500 dark:text-gray-400 italic">
                          ... and {preview.files.length - 20} more files
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={processing}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-md hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Upload {totalCount} {totalCount === 1 ? 'Video' : 'Videos'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
