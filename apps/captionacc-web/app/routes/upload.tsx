import { useState, useRef, useCallback, useEffect } from 'react'
import { useLoaderData, useSearchParams } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'
import { AppLayout } from '~/components/AppLayout'
import { FolderIcon, DocumentIcon, XMarkIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import { CloudArrowUpIcon } from '@heroicons/react/20/solid'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import * as tus from 'tus-js-client'

interface FolderItem {
  path: string
  name: string
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const preselectedFolder = url.searchParams.get('folder')

  return new Response(
    JSON.stringify({ preselectedFolder }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}

interface VideoFilePreview {
  file: File
  relativePath: string
  size: number
  type: string
  selected: boolean
  uploadProgress: number
  uploadStatus: 'queued' | 'uploading' | 'complete' | 'error' | 'paused'
  uploadId?: string
  error?: string
  isDuplicate?: boolean
  existingUploadedAt?: string
}

const CONCURRENT_UPLOADS = 3
const CHUNK_SIZE = 8 * 1024 * 1024 // 8MB chunks

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hrs > 0) return `${hrs}h ${mins}m`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

/**
 * Collapse single-video folders to avoid unnecessary nesting
 * Only collapses if the target folder doesn't already exist in local/data
 * Stops collapsing when reaching an existing folder
 * Example: "level1/level2/video.mp4" where level2 only has one video
 * and doesn't exist → becomes: "show/video.mp4" (if show exists or is root)
 *
 * @param videos - Array of video files to process
 * @param preview - If true, don't modify videos, just check if collapses would happen
 * @returns Number of collapses that were (or would be) performed
 */
async function collapseSingleVideoFolders(videos: VideoFilePreview[], preview: boolean = false): Promise<number> {
  if (videos.length === 0) return 0

  // Fetch existing folders from the server
  let existingFolders = new Set<string>()
  try {
    const response = await fetch('/api/folders')
    const data = await response.json()
    existingFolders = new Set((data.folders || []).map((f: { path: string }) => f.path))
    console.log(`[collapseSingleVideoFolders] Found ${existingFolders.size} existing folders`)
  } catch (error) {
    console.error('[collapseSingleVideoFolders] Failed to fetch existing folders:', error)
    return 0 // Don't collapse if we can't check existing folders
  }

  let totalCollapses = 0
  let changed = true

  while (changed) {
    changed = false

    // Build a map of folder paths to their video counts
    const folderCounts = new Map<string, number>()

    for (const video of videos) {
      const pathParts = video.relativePath.split('/')
      // Count videos in each folder level
      for (let i = 1; i < pathParts.length; i++) {
        const folderPath = pathParts.slice(0, i).join('/')
        folderCounts.set(folderPath, (folderCounts.get(folderPath) || 0) + 1)
      }
    }

    // Check each video for single-video parent folders
    for (const video of videos) {
      const pathParts = video.relativePath.split('/')

      // Need at least 2 parts (folder/file) to collapse
      if (pathParts.length < 2) continue

      // Check if the immediate parent folder only has this one video
      const parentFolder = pathParts.slice(0, -1).join('/')

      // Collapse if the parent folder:
      // 1. Would only have this one video (from current upload batch)
      // 2. Doesn't already exist in local/data
      if (folderCounts.get(parentFolder) === 1 && !existingFolders.has(parentFolder)) {
        totalCollapses++

        if (!preview) {
          const filename = pathParts[pathParts.length - 1]
          const newPathParts = pathParts.slice(0, -2).concat(filename)
          const newRelativePath = newPathParts.length > 0 ? newPathParts.join('/') : filename

          console.log(`[collapseSingleVideoFolders] Collapsing: ${video.relativePath} -> ${newRelativePath}`)
          video.relativePath = newRelativePath
          changed = true  // Only continue looping if we actually modified paths
        }
      }
    }
  }

  return totalCollapses
}

export default function UploadPage() {
  const loaderData = useLoaderData() as { preselectedFolder: string | null }
  const [searchParams] = useSearchParams()

  const [dragActive, setDragActive] = useState(false)
  const [videoFiles, setVideoFiles] = useState<VideoFilePreview[]>([])
  const [skippedFiles, setSkippedFiles] = useState<File[]>([])
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [showSkipped, setShowSkipped] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadQueue, setUploadQueue] = useState<string[]>([])
  const [activeUploads, setActiveUploads] = useState<Map<string, tus.Upload>>(new Map())
  const [selectedFolder, setSelectedFolder] = useState<string>('')
  const [availableFolders, setAvailableFolders] = useState<FolderItem[]>([])
  const [collapseEnabled, setCollapseEnabled] = useState(true)
  const [collapsesAvailable, setCollapsesAvailable] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

  // Load folders and handle preselected folder
  useEffect(() => {
    fetch('/api/folders')
      .then(res => res.json())
      .then(data => {
        setAvailableFolders(data.folders || [])
      })
      .catch(err => {
        console.error('Failed to load folders:', err)
      })

    // Set preselected folder from URL
    if (loaderData.preselectedFolder) {
      setSelectedFolder(loaderData.preselectedFolder)
    }
  }, [loaderData.preselectedFolder])

  // Restore active uploads from server on mount
  useEffect(() => {
    fetch('/api/uploads/active')
      .then(res => res.json())
      .then(data => {
        if (data.uploads && data.uploads.length > 0) {
          console.log(`[Upload] Found ${data.uploads.length} active upload(s) from server`)

          // Convert server uploads to VideoFilePreview format
          const restoredVideos: VideoFilePreview[] = data.uploads.map((upload: any) => ({
            file: new File([], upload.originalFilename), // Placeholder File object
            relativePath: upload.videoId,
            size: 0, // Unknown - file is on server
            type: 'video/*',
            selected: true,
            uploadProgress: upload.uploadProgress * 100,
            uploadStatus: 'uploading' as const,
            uploadId: upload.videoId,
          }))

          setVideoFiles(restoredVideos)
          setUploading(true)

          // Poll for progress updates
          const pollInterval = setInterval(() => {
            fetch('/api/uploads/active')
              .then(res => res.json())
              .then(pollData => {
                if (pollData.uploads && pollData.uploads.length > 0) {
                  // Update progress for each video
                  setVideoFiles(prev => prev.map(v => {
                    const serverUpload = pollData.uploads.find((u: any) => u.videoId === v.uploadId)
                    if (serverUpload) {
                      return {
                        ...v,
                        uploadProgress: serverUpload.uploadProgress * 100,
                        uploadStatus: serverUpload.uploadProgress >= 1.0 ? 'complete' as const : 'uploading' as const,
                      }
                    }
                    return v
                  }))

                  // Check if all uploads complete
                  const allComplete = pollData.uploads.every((u: any) => u.uploadProgress >= 1.0)
                  if (allComplete) {
                    clearInterval(pollInterval)
                    setUploading(false)
                  }
                } else {
                  // No more active uploads - stop polling
                  clearInterval(pollInterval)
                  setUploading(false)
                }
              })
              .catch(err => {
                console.error('[Upload] Failed to poll upload progress:', err)
              })
          }, 2000) // Poll every 2 seconds

          // Cleanup on unmount
          return () => clearInterval(pollInterval)
        }
      })
      .catch(err => {
        console.error('[Upload] Failed to restore active uploads:', err)
      })
  }, [])

  const processFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return

    // Prevent starting new upload while one is in progress
    if (uploading) {
      console.log('[processFiles] Upload already in progress, ignoring new files')
      alert('An upload is already in progress. Please wait for it to complete before starting a new upload.')
      return
    }

    console.log(`[processFiles] Processing ${fileList.length} files`)
    const videos: VideoFilePreview[] = []
    const skipped: File[] = []

    for (const file of Array.from(fileList)) {
      if (file.type.startsWith('video/')) {
        const relativePath = (file as any).webkitRelativePath || file.name
        console.log(`[processFiles] Found video: ${relativePath} (${file.type})`)
        videos.push({
          file,
          relativePath,
          size: file.size,
          type: file.type,
          selected: true,
          uploadProgress: 0,
          uploadStatus: 'queued',
        })
      } else {
        skipped.push(file)
      }
    }

    console.log(`[processFiles] Result: ${videos.length} videos, ${skipped.length} skipped`)

    // Check if collapses are available (preview mode)
    const collapseCount = await collapseSingleVideoFolders(videos, true)
    setCollapsesAvailable(collapseCount > 0)
    console.log(`[processFiles] ${collapseCount} collapse(s) available`)

    // Apply collapse immediately if available (so preview shows collapsed paths)
    if (collapseCount > 0) {
      await collapseSingleVideoFolders(videos, false)
      console.log('[processFiles] Applied folder collapse to preview')
    }

    // Check for duplicates
    if (videos.length > 0) {
      const videoPaths = videos.map(v => {
        const pathParts = v.relativePath.split('/')
        const filename = pathParts[pathParts.length - 1]
        return pathParts.slice(0, -1).concat(filename.replace(/\.\w+$/, '')).join('/')
      })

      try {
        console.log('[processFiles] Checking for duplicates:', videoPaths)
        const response = await fetch(`/api/annotations/check-duplicates?paths=${encodeURIComponent(videoPaths.join(','))}`)
        const duplicates = await response.json()
        console.log('[processFiles] Duplicate check results:', duplicates)

        for (let i = 0; i < videos.length; i++) {
          const videoPath = videoPaths[i]
          if (duplicates[videoPath]?.exists) {
            console.log(`[processFiles] Found duplicate: ${videoPath}`)
            videos[i].isDuplicate = true
            videos[i].existingUploadedAt = duplicates[videoPath].uploadedAt
          }
        }
      } catch (error) {
        console.error('Failed to check duplicates:', error)
      }
    }

    setVideoFiles(videos)
    setSkippedFiles(skipped)
    setShowConfirmation(true)
  }, [uploading])

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setDragActive(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setDragActive(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setDragActive(false)

    const items = e.dataTransfer.items
    if (!items) return

    console.log(`[handleDrop] Processing ${items.length} items`)

    // CRITICAL: Collect all entries synchronously BEFORE any async operations
    // DataTransferItemList becomes invalid after the event handler yields
    const entries: any[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      console.log(`[handleDrop] Item ${i}: kind="${item.kind}", type="${item.type}"`)
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry()
        console.log(`[handleDrop] Item ${i}: webkitGetAsEntry() returned`, entry)
        if (entry) {
          console.log(`[handleDrop] Item ${i}: isFile=${entry.isFile}, isDirectory=${entry.isDirectory}`)
          entries.push(entry)
        } else {
          console.log(`[handleDrop] Item ${i}: webkitGetAsEntry() returned null/undefined`)
        }
      }
    }

    console.log(`[handleDrop] Collected ${entries.length} entries, now processing asynchronously`)

    // Now process all entries asynchronously
    const files: File[] = []
    for (const entry of entries) {
      await traverseFileTree(entry, '', files)
    }

    console.log(`[handleDrop] Collected ${files.length} files`)
    // Create FileList-like object
    const dt = new DataTransfer()
    files.forEach(file => dt.items.add(file))
    processFiles(dt.files)
  }

  async function traverseFileTree(item: any, path: string, files: File[]) {
    console.log(`[traverseFileTree] Processing: ${path}${item.name}, isFile=${item.isFile}, isDirectory=${item.isDirectory}`)
    if (item.isFile) {
      console.log(`[traverseFileTree] Getting file for: ${item.name}`)
      const file = await new Promise<File>((resolve) => {
        item.file((f: File) => {
          console.log(`[traverseFileTree] Got file: ${f.name}, size=${f.size}, type=${f.type}`)
          Object.defineProperty(f, 'webkitRelativePath', {
            value: path + f.name,
            writable: false
          })
          resolve(f)
        })
      })
      files.push(file)
      console.log(`[traverseFileTree] Pushed file, files.length now = ${files.length}`)
    } else if (item.isDirectory) {
      const dirReader = item.createReader()
      const entries = await new Promise<any[]>((resolve) => {
        dirReader.readEntries((entries: any[]) => resolve(entries))
      })
      for (const entry of entries) {
        await traverseFileTree(entry, path + item.name + '/', files)
      }
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files)
  }

  const toggleFileSelection = (index: number) => {
    setVideoFiles(prev => prev.map((f, i) =>
      i === index ? { ...f, selected: !f.selected } : f
    ))
  }

  const selectedVideos = videoFiles.filter(f => f.selected)
  const totalSize = selectedVideos.reduce((sum, f) => sum + f.size, 0)

  // Estimate upload time (assuming 10 Mbps = 1.25 MB/s)
  const estimatedSeconds = totalSize / (1.25 * 1024 * 1024)

  const handleCollapseToggle = async (enabled: boolean) => {
    setCollapseEnabled(enabled)

    if (enabled && collapsesAvailable) {
      // Re-apply collapse
      console.log('[handleCollapseToggle] Applying collapse...')
      await collapseSingleVideoFolders(videoFiles, false)
      setVideoFiles([...videoFiles])  // Trigger re-render
    } else {
      // Restore original paths
      console.log('[handleCollapseToggle] Restoring original paths...')
      setVideoFiles(prev => prev.map(v => ({
        ...v,
        relativePath: (v.file as any).webkitRelativePath || v.file.name
      })))
    }
  }

  const startUpload = async () => {
    setShowConfirmation(false)
    setUploading(true)

    const selected = videoFiles.filter(f => f.selected)
    console.log(`[startUpload] Starting upload for ${selected.length} videos`)
    console.log(`[startUpload] Video files:`, selected.map(v => v.relativePath))
    const queue = selected.map((_, idx) => `video-${idx}`)
    console.log(`[startUpload] Queue:`, queue)
    setUploadQueue(queue)

    // Start first batch of concurrent uploads
    processUploadQueue(selected, queue)
  }

  const processUploadQueue = (videos: VideoFilePreview[], queue: string[]) => {
    console.log(`[processUploadQueue] Called with ${videos.length} videos, queue length: ${queue.length}`)
    console.log(`[processUploadQueue] Active uploads: ${activeUploads.size}`)
    const newActiveUploads = new Map(activeUploads)

    while (newActiveUploads.size < CONCURRENT_UPLOADS && queue.length > 0) {
      const videoId = queue.shift()!
      const index = parseInt(videoId.split('-')[1])
      const video = videos[index]
      console.log(`[processUploadQueue] Starting upload ${videoId} (index ${index}): ${video.relativePath}`)

      // Extract video path from relative path
      // e.g., "show_name/video_name.mp4" -> videoPath: "show_name/video_name"
      const pathParts = video.relativePath.split('/')
      const filename = pathParts[pathParts.length - 1]
      let videoPath = pathParts.slice(0, -1).concat(filename.replace(/\.\w+$/, '')).join('/')

      // Prepend selected folder if any
      if (selectedFolder) {
        videoPath = selectedFolder + '/' + videoPath
      }

      const upload = new tus.Upload(video.file, {
        endpoint: '/api/upload',
        retryDelays: [0, 3000, 5000, 10000, 20000],
        chunkSize: CHUNK_SIZE,
        metadata: {
          filename,
          filetype: video.file.type,
          videoPath,
        },
        onError: (error) => {
          console.error(`Upload failed for ${video.relativePath}:`, error)
          setVideoFiles(prev => prev.map((v, i) =>
            i === index ? { ...v, uploadStatus: 'error', error: error.message } : v
          ))
          newActiveUploads.delete(videoId)
          setActiveUploads(new Map(newActiveUploads))

          // Continue with next in queue
          if (queue.length > 0) {
            processUploadQueue(videos, queue)
          }
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const progress = (bytesUploaded / bytesTotal) * 100
          setVideoFiles(prev => prev.map((v, i) =>
            i === index ? { ...v, uploadProgress: progress } : v
          ))
        },
        onSuccess: () => {
          console.log(`Upload complete for ${video.relativePath}`)
          setVideoFiles(prev => prev.map((v, i) =>
            i === index ? { ...v, uploadStatus: 'complete', uploadProgress: 100 } : v
          ))
          newActiveUploads.delete(videoId)
          setActiveUploads(new Map(newActiveUploads))

          // Save progress to localStorage
          saveUploadProgress()

          // Continue with next in queue
          if (queue.length > 0) {
            processUploadQueue(videos, queue)
          } else if (newActiveUploads.size === 0) {
            // All uploads complete
            setUploading(false)
          }
        },
      })

      upload.start()
      newActiveUploads.set(videoId, upload)

      setVideoFiles(prev => prev.map((v, i) =>
        i === index ? { ...v, uploadStatus: 'uploading', uploadId: videoId } : v
      ))
    }

    setActiveUploads(new Map(newActiveUploads))
    setUploadQueue(queue)
  }

  const saveUploadProgress = () => {
    const progress = videoFiles.map(v => ({
      relativePath: v.relativePath,
      uploadProgress: v.uploadProgress,
      uploadStatus: v.uploadStatus,
      error: v.error,
    }))
    localStorage.setItem('upload-progress', JSON.stringify(progress))
  }

  const selectedCount = videoFiles.filter(v => v.selected).length
  const completedCount = videoFiles.filter(v => v.selected && v.uploadStatus === 'complete').length
  const overallProgress = selectedCount > 0
    ? (completedCount / selectedCount) * 100
    : 0

  // Calculate target path for a video (showing preview of collapse if enabled)
  const getTargetPath = (video: VideoFilePreview) => {
    // Use current relativePath which may or may not be collapsed yet
    // When collapse is enabled but not yet applied, we show what it WILL be
    // When collapse is disabled, we show the uncollapsed path
    const pathParts = video.relativePath.split('/')
    const filename = pathParts[pathParts.length - 1]
    let videoPath = pathParts.slice(0, -1).concat(filename.replace(/\.\w+$/, '')).join('/')

    // Prepend selected folder if any
    if (selectedFolder) {
      videoPath = selectedFolder + '/' + videoPath
    }

    return videoPath
  }

  // Get original file path (before collapse)
  const getOriginalPath = (video: VideoFilePreview) => {
    return (video.file as any).webkitRelativePath || video.file.name
  }

  return (
    <AppLayout>
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <h1 className="text-base font-semibold text-gray-900 dark:text-gray-200">
              Upload Videos
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Upload video files for caption annotation. Drag folders to preserve directory structure.
            </p>
          </div>
        </div>

        {!showConfirmation && !uploading && videoFiles.length === 0 && (
          <div className="mt-8">
            {/* Folder Selection */}
            <div className="mb-6">
              <label htmlFor="folder-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Upload to folder (optional)
              </label>
              <Menu as="div" className="relative w-full sm:w-96">
                <MenuButton className="relative w-full cursor-pointer rounded-md bg-white dark:bg-gray-800 py-2 pl-3 pr-10 text-left shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm">
                  <span className="block truncate text-gray-900 dark:text-gray-200">
                    {selectedFolder || 'Root (no folder)'}
                  </span>
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                    <ChevronDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                  </span>
                </MenuButton>

                <MenuItems className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white dark:bg-gray-800 py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                  <MenuItem>
                    <button
                      onClick={() => setSelectedFolder('')}
                      className="w-full text-left px-3 py-2 text-sm text-gray-900 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:outline-none"
                    >
                      Root (no folder)
                    </button>
                  </MenuItem>
                  {availableFolders.map(folder => (
                    <MenuItem key={folder.path}>
                      <button
                        onClick={() => setSelectedFolder(folder.path)}
                        className="w-full text-left px-3 py-2 text-sm text-gray-900 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:outline-none"
                      >
                        {folder.path}
                      </button>
                    </MenuItem>
                  ))}
                  {availableFolders.length === 0 && (
                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 italic">
                      No folders available
                    </div>
                  )}
                </MenuItems>
              </Menu>
              {selectedFolder && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                  Videos will be uploaded to: <span className="font-medium">{selectedFolder}/</span>
                </p>
              )}
            </div>

            {/* Drop Zone */}
            <div
              className={`
                relative border-2 border-dashed rounded-lg p-12 text-center
                transition-colors
                ${dragActive
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                  : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'
                }
              `}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
              <div className="mt-4">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-200">
                  Drag folder or videos here
                </p>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  or click to browse
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
                onChange={handleFileSelect}
                className="hidden"
              />
              <input
                ref={folderInputRef}
                type="file"
                {...({ webkitdirectory: '', directory: '' } as any)}
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {/* Action Buttons */}
            <div className="mt-6 flex gap-3 justify-center">
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
          </div>
        )}

        {/* Confirmation Modal */}
        {showConfirmation && !uploading && (
          <div className="mt-8 bg-white dark:bg-gray-800 shadow sm:rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-200">
                Confirm Video Upload
              </h3>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Found {videoFiles.length} video{videoFiles.length !== 1 ? 's' : ''}
                {skippedFiles.length > 0 && ` (${skippedFiles.length} non-video files skipped)`}
              </div>

              {/* Duplicate Warning */}
              {videoFiles.some(v => v.isDuplicate) && (
                <div className="mt-4 rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-4 border border-yellow-200 dark:border-yellow-800">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3 flex-1">
                      <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                        Path conflict detected
                      </h3>
                      <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-400">
                        <p>
                          {videoFiles.filter(v => v.isDuplicate).length} video{videoFiles.filter(v => v.isDuplicate).length !== 1 ? 's target' : ' targets'} the same path as existing {videoFiles.filter(v => v.isDuplicate).length !== 1 ? 'videos' : 'video'}.
                          Uploading will overwrite the existing video and all annotation data at {videoFiles.filter(v => v.isDuplicate).length !== 1 ? 'these paths' : 'this path'}.
                        </p>
                      </div>
                      <div className="mt-3">
                        <button
                          onClick={() => {
                            setVideoFiles(prev => prev.map(f =>
                              f.isDuplicate ? { ...f, selected: false } : f
                            ))
                          }}
                          className="text-sm font-medium text-yellow-800 dark:text-yellow-300 hover:text-yellow-700 dark:hover:text-yellow-200 underline"
                        >
                          Deselect all duplicates
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Folder Collapse Toggle */}
              {collapsesAvailable && (
                <div className="mt-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={collapseEnabled}
                      onChange={(e) => handleCollapseToggle(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Collapse single-video folders
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-500">
                      (simplifies folder structure)
                    </span>
                  </label>
                </div>
              )}

              {/* Stats */}
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="bg-gray-50 dark:bg-gray-900 px-4 py-3 rounded-md">
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    Selected Videos
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-200">
                    {selectedVideos.length}
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-900 px-4 py-3 rounded-md">
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    Total Size
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-200">
                    {formatBytes(totalSize)}
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-900 px-4 py-3 rounded-md">
                  <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    Est. Time
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-200">
                    ~{formatDuration(estimatedSeconds)}
                  </div>
                </div>
              </div>

              {/* File List */}
              <div className="mt-6">
                <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 dark:ring-white dark:ring-opacity-10 rounded-lg max-h-96 overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                      <tr>
                        <th className="py-3 pl-4 pr-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 sm:pl-6">
                          <input
                            type="checkbox"
                            checked={selectedVideos.length === videoFiles.length}
                            onChange={(e) => {
                              const checked = e.target.checked
                              setVideoFiles(prev => prev.map(f => ({ ...f, selected: checked })))
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                          />
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                          Original Path
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                          Target Path
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                          Size
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-950">
                      {videoFiles.map((video, index) => (
                        <tr key={index} className={`hover:bg-gray-50 dark:hover:bg-gray-900 ${video.isDuplicate ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''}`}>
                          <td className="py-3 pl-4 pr-3 sm:pl-6">
                            <input
                              type="checkbox"
                              checked={video.selected}
                              onChange={() => toggleFileSelection(index)}
                              className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                            />
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-600 dark:text-gray-400">
                            {getOriginalPath(video)}
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-900 dark:text-gray-200 font-medium">
                            {getTargetPath(video)}
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-600 dark:text-gray-400">
                            {formatBytes(video.size)}
                          </td>
                          <td className="px-3 py-3 text-sm">
                            {video.isDuplicate ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                                ⚠️ Path exists
                              </span>
                            ) : (
                              <span className="text-gray-400 dark:text-gray-600">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Skipped Files */}
              {skippedFiles.length > 0 && (
                <button
                  onClick={() => setShowSkipped(!showSkipped)}
                  className="mt-4 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-500"
                >
                  {showSkipped ? 'Hide' : 'View'} skipped files ({skippedFiles.length})
                </button>
              )}

              {showSkipped && (
                <div className="mt-4 bg-gray-50 dark:bg-gray-900 rounded-md p-4">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-gray-200 mb-2">
                    Skipped Files
                  </h4>
                  <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    {skippedFiles.map((file, index) => (
                      <li key={index} className="flex items-center gap-2">
                        <XMarkIcon className="h-4 w-4 text-gray-400" />
                        {(file as any).webkitRelativePath || file.name} ({file.type || 'unknown'})
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Actions */}
              <div className="mt-6 flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setShowConfirmation(false)
                    setVideoFiles([])
                    setSkippedFiles([])
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={startUpload}
                  disabled={selectedVideos.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Upload {selectedVideos.length} Video{selectedVideos.length !== 1 ? 's' : ''}
                </button>
              </div>

              {/* Info */}
              <div className="mt-4 text-xs text-gray-500 dark:text-gray-500">
                ⚡ Uploads are resumable - you can close this page and continue later
              </div>
            </div>
          </div>
        )}

        {/* Upload Progress */}
        {(uploading || videoFiles.length > 0) && !showConfirmation && (
          <div className="mt-8 bg-white dark:bg-gray-800 shadow sm:rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-200">
                  {uploading ? `Uploading ${selectedCount} video${selectedCount !== 1 ? 's' : ''}...` : 'Upload Complete'}
                </h3>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {completedCount} of {selectedCount} complete ({Math.round(overallProgress)}%)
                </div>
              </div>

              {/* Overall Progress Bar */}
              <div className="mt-4 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>

              {/* File List */}
              <div className="mt-6 space-y-4 max-h-96 overflow-y-auto">
                {videoFiles.filter(v => v.selected).map((video, index) => (
                  <div key={index} className="border border-gray-200 dark:border-gray-700 rounded-md p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-200 truncate">
                          {video.relativePath}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                          {formatBytes(video.size)} • {video.type}
                        </p>
                      </div>
                      <div className="ml-4">
                        {video.uploadStatus === 'complete' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                            ✓ Complete
                          </span>
                        )}
                        {video.uploadStatus === 'uploading' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                            Uploading {Math.round(video.uploadProgress)}%
                          </span>
                        )}
                        {video.uploadStatus === 'queued' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400">
                            Queued
                          </span>
                        )}
                        {video.uploadStatus === 'error' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                            Error
                          </span>
                        )}
                      </div>
                    </div>

                    {video.uploadStatus === 'uploading' && (
                      <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                        <div
                          className="bg-indigo-600 h-1.5 rounded-full transition-all"
                          style={{ width: `${video.uploadProgress}%` }}
                        />
                      </div>
                    )}

                    {video.error && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                        {video.error}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {completedCount === selectedCount && completedCount > 0 && (
                <div className="mt-6 rounded-lg bg-green-50 dark:bg-green-900/20 p-6 border border-green-200 dark:border-green-800">
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <svg className="h-6 w-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="ml-3 flex-1">
                      <h3 className="text-sm font-medium text-green-800 dark:text-green-300">
                        Upload complete!
                      </h3>
                      <div className="mt-2 text-sm text-green-700 dark:text-green-400">
                        <p>
                          Successfully uploaded {selectedVideos.length} video{selectedVideos.length !== 1 ? 's' : ''}.
                          Background processing (frame extraction and OCR) has started automatically.
                        </p>
                      </div>
                      <div className="mt-4 flex gap-3">
                        <a
                          href="/videos"
                          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                        >
                          View Videos & Processing Status
                        </a>
                        <button
                          onClick={() => {
                            setVideoFiles([])
                            setSkippedFiles([])
                            setUploading(false)
                            setShowConfirmation(false)
                          }}
                          className="inline-flex items-center px-4 py-2 border border-green-300 dark:border-green-700 text-sm font-medium rounded-md text-green-700 dark:text-green-300 bg-white dark:bg-gray-800 hover:bg-green-50 dark:hover:bg-green-900/30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                        >
                          Upload More Videos
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
