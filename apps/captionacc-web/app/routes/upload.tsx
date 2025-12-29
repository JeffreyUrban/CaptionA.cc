import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Dialog,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react'
import { CloudArrowUpIcon } from '@heroicons/react/20/solid'
import { FolderIcon, DocumentIcon, XMarkIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useLoaderData, useSearchParams } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'
import * as tus from 'tus-js-client'

import { AppLayout } from '~/components/AppLayout'

// Extend File to include webkitRelativePath (non-standard but widely supported)
interface FileWithPath extends Omit<File, 'webkitRelativePath'> {
  webkitRelativePath?: string
}

interface FolderItem {
  path: string
  name: string
}

// Incomplete upload metadata from /api/uploads/incomplete
interface IncompleteUpload {
  uploadId: string
  videoId: string
  videoPath: string
  filename: string
  uploadLength: number
  currentSize: number
  progress: number
  createdAt: string
}

// FileSystem API types (non-standard but widely supported)
interface FileSystemEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath: string
}

interface FileSystemFileEntry extends FileSystemEntry {
  isFile: true
  file(callback: (file: File) => void): void
}

interface FileSystemDirectoryEntry extends FileSystemEntry {
  isDirectory: true
  createReader(): FileSystemDirectoryReader
}

interface FileSystemDirectoryReader {
  readEntries(callback: (entries: FileSystemEntry[]) => void): void
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const preselectedFolder = url.searchParams.get('folder')

  return new Response(JSON.stringify({ preselectedFolder }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

interface VideoFilePreview {
  file: File
  relativePath: string
  size: number
  type: string
  selected: boolean
  uploadProgress: number
  uploadStatus:
    | 'pending'
    | 'queued'
    | 'uploading'
    | 'complete'
    | 'error'
    | 'paused'
    | 'stalled'
    | 'retrying'
  uploadId?: string
  uploadUrl?: string // TUS upload URL for resumability
  error?: string
  isDuplicate?: boolean
  existingUploadedAt?: string
  retryCount?: number
  lastActivityAt?: number // Timestamp for stall detection
}

const CONCURRENT_UPLOADS = 3
const CHUNK_SIZE = 8 * 1024 * 1024 // 8MB chunks
const RETRY_DELAYS = [0, 3000, 5000, 10000, 20000, 60000] // Exponential backoff (ms)
const MAX_RETRIES = 5
const STALL_TIMEOUT = 60000 // 60s without progress = stalled
const SESSION_BUFFER = 6 // Create sessions for active + next batch (2x concurrent limit)

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
async function collapseSingleVideoFolders(
  videos: VideoFilePreview[],
  preview: boolean = false
): Promise<number> {
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
          if (!filename) continue
          const newPathParts = pathParts.slice(0, -2).concat(filename)
          const newRelativePath = newPathParts.length > 0 ? newPathParts.join('/') : filename

          console.log(
            `[collapseSingleVideoFolders] Collapsing: ${video.relativePath} -> ${newRelativePath}`
          )
          video.relativePath = newRelativePath
          changed = true // Only continue looping if we actually modified paths
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
  const [incompleteUploads, setIncompleteUploads] = useState<IncompleteUpload[]>([])
  const [showIncompletePrompt, setShowIncompletePrompt] = useState(false)
  const [showStopQueuedModal, setShowStopQueuedModal] = useState(false)
  const [showAbortAllModal, setShowAbortAllModal] = useState(false)

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

  // Detect and auto-clear incomplete uploads from previous session
  useEffect(() => {
    fetch('/api/uploads/incomplete')
      .then(res => res.json())
      .then(async data => {
        if (data.uploads && data.uploads.length > 0) {
          console.log(
            `[Upload] Found ${data.uploads.length} incomplete upload(s) from previous session - auto-clearing`
          )

          // Store the list before clearing
          setIncompleteUploads(data.uploads)

          // Auto-clear stalled uploads
          await fetch('/api/uploads/clear-incomplete', { method: 'POST' })

          // Show notification
          setShowIncompletePrompt(true)
        }
      })
      .catch(err => {
        console.error('[Upload] Failed to check for incomplete uploads:', err)
      })
  }, [])

  const processFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return

      // Prevent starting new upload while one is in progress
      if (uploading) {
        console.log('[processFiles] Upload already in progress, ignoring new files')
        alert(
          'An upload is already in progress. Please wait for it to complete before starting a new upload.'
        )
        return
      }

      console.log(`[processFiles] Processing ${fileList.length} files`)
      const videos: VideoFilePreview[] = []
      const skipped: File[] = []

      for (const file of Array.from(fileList)) {
        if (file.type.startsWith('video/')) {
          const relativePath = (file as FileWithPath).webkitRelativePath || file.name
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
          if (!filename) return ''
          return pathParts
            .slice(0, -1)
            .concat(filename.replace(/\.\w+$/, ''))
            .join('/')
        })

        try {
          console.log('[processFiles] Checking for duplicates:', videoPaths)
          const response = await fetch(
            `/api/annotations/check-duplicates?paths=${encodeURIComponent(videoPaths.join(','))}`
          )
          const duplicates = await response.json()
          console.log('[processFiles] Duplicate check results:', duplicates)

          for (let i = 0; i < videos.length; i++) {
            const videoPath = videoPaths[i]
            if (!videoPath) continue
            if (duplicates[videoPath]?.exists) {
              console.log(`[processFiles] Found duplicate: ${videoPath}`)
              const video = videos[i]
              if (!video) continue
              video.isDuplicate = true
              video.existingUploadedAt = duplicates[videoPath].uploadedAt
            }
          }
        } catch (error) {
          console.error('Failed to check duplicates:', error)
        }
      }

      setVideoFiles(videos)
      setSkippedFiles(skipped)
      setShowConfirmation(true)
    },
    [uploading]
  )

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
    const entries: (FileSystemEntry | null)[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item) continue
      console.log(`[handleDrop] Item ${i}: kind="${item.kind}", type="${item.type}"`)
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry()
        console.log(`[handleDrop] Item ${i}: webkitGetAsEntry() returned`, entry)
        if (entry) {
          console.log(
            `[handleDrop] Item ${i}: isFile=${entry.isFile}, isDirectory=${entry.isDirectory}`
          )
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
      if (!entry) continue
      await traverseFileTree(entry, '', files)
    }

    console.log(`[handleDrop] Collected ${files.length} files`)
    // Create FileList-like object
    const dt = new DataTransfer()
    files.forEach(file => dt.items.add(file))
    processFiles(dt.files)
  }

  async function traverseFileTree(item: FileSystemEntry, path: string, files: File[]) {
    console.log(
      `[traverseFileTree] Processing: ${path}${item.name}, isFile=${item.isFile}, isDirectory=${item.isDirectory}`
    )
    if (item.isFile) {
      console.log(`[traverseFileTree] Getting file for: ${item.name}`)
      const fileEntry = item as FileSystemFileEntry
      const file = await new Promise<File>(resolve => {
        fileEntry.file((f: File) => {
          console.log(`[traverseFileTree] Got file: ${f.name}, size=${f.size}, type=${f.type}`)
          Object.defineProperty(f, 'webkitRelativePath', {
            value: path + f.name,
            writable: false,
          })
          resolve(f)
        })
      })
      files.push(file)
      console.log(`[traverseFileTree] Pushed file, files.length now = ${files.length}`)
    } else if (item.isDirectory) {
      const dirEntry = item as FileSystemDirectoryEntry
      const dirReader = dirEntry.createReader()
      const entries = await new Promise<FileSystemEntry[]>(resolve => {
        dirReader.readEntries((entries: FileSystemEntry[]) => resolve(entries))
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
    setVideoFiles(prev => prev.map((f, i) => (i === index ? { ...f, selected: !f.selected } : f)))
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
      setVideoFiles([...videoFiles]) // Trigger re-render
    } else {
      // Restore original paths
      console.log('[handleCollapseToggle] Restoring original paths...')
      setVideoFiles(prev =>
        prev.map(v => ({
          ...v,
          relativePath: (v.file as FileWithPath).webkitRelativePath || v.file.name,
        }))
      )
    }
  }

  const startUpload = async () => {
    setShowConfirmation(false)
    setUploading(true)

    const selected = videoFiles.filter(f => f.selected)
    console.log(`[startUpload] Starting upload for ${selected.length} videos`)

    // Mark all as pending (not queued yet)
    setVideoFiles(prev =>
      prev.map(v => (v.selected ? { ...v, uploadStatus: 'pending' as const, retryCount: 0 } : v))
    )

    // Start processing queue
    processUploadQueue()
  }

  const processUploadQueue = () => {
    setVideoFiles(prev => {
      const newFiles = [...prev]

      // Count active uploads
      const activeCount = newFiles.filter(
        v => v.uploadStatus === 'uploading' || v.uploadStatus === 'retrying'
      ).length

      // Calculate available slots
      const availableSlots = CONCURRENT_UPLOADS - activeCount
      if (availableSlots <= 0) return prev

      // Find videos ready to upload
      const readyToUpload = newFiles
        .map((v, idx) => ({ video: v, index: idx }))
        .filter(
          ({ video }) =>
            video.selected && (video.uploadStatus === 'pending' || video.uploadStatus === 'stalled')
        )
        .slice(0, availableSlots)

      // Start uploads for available slots
      readyToUpload.forEach(({ video, index }) => {
        startSingleUpload(index, video.retryCount || 0)
        newFiles[index] = {
          ...video,
          uploadStatus: 'uploading' as const,
          lastActivityAt: Date.now(),
        }
      })

      return newFiles
    })
  }

  const startSingleUpload = (index: number, retryCount: number = 0) => {
    const video = videoFiles[index]
    if (!video) return

    // Extract video path from relative path
    const pathParts = video.relativePath.split('/')
    const filename = pathParts[pathParts.length - 1]
    if (!filename) {
      console.error(`[Upload] Invalid filename for ${video.relativePath}`)
      return
    }
    let videoPath = pathParts
      .slice(0, -1)
      .concat(filename.replace(/\.\w+$/, ''))
      .join('/')

    // Prepend selected folder if any
    if (selectedFolder) {
      videoPath = selectedFolder + '/' + videoPath
    }

    const videoId = `video-${index}`
    console.log(
      `[Upload] Starting ${video.relativePath} (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`
    )

    const upload = new tus.Upload(video.file, {
      endpoint: '/api/upload',
      retryDelays: RETRY_DELAYS,
      chunkSize: CHUNK_SIZE,
      uploadUrl: video.uploadUrl, // Resume from previous attempt if available (automatic in v2)
      metadata: {
        filename: filename,
        filetype: video.file.type,
        videoPath: videoPath,
      },
      onError: error => {
        console.error(`[Upload] Failed ${video.relativePath}:`, error)

        // Check if we should retry
        if (retryCount < MAX_RETRIES && isRetryableError(error)) {
          const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)]
          console.log(
            `[Upload] Will retry ${video.relativePath} in ${delay}ms (attempt ${retryCount + 1})`
          )

          setVideoFiles(prev =>
            prev.map((v, i) =>
              i === index
                ? {
                    ...v,
                    uploadStatus: 'retrying',
                    error: `Retrying... (attempt ${retryCount + 1}/${MAX_RETRIES})`,
                    retryCount: retryCount + 1,
                  }
                : v
            )
          )

          // Schedule retry
          setTimeout(() => {
            startSingleUpload(index, retryCount + 1)
          }, delay)
        } else {
          // Max retries exceeded or non-retryable error
          setVideoFiles(prev =>
            prev.map((v, i) =>
              i === index
                ? {
                    ...v,
                    uploadStatus: 'error',
                    error: error.message,
                    retryCount: retryCount + 1,
                  }
                : v
            )
          )
          activeUploads.delete(videoId)

          // Process next in queue
          setTimeout(() => processUploadQueue(), 100)
        }
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const progress = (bytesUploaded / bytesTotal) * 100
        setVideoFiles(prev =>
          prev.map((v, i) =>
            i === index
              ? {
                  ...v,
                  uploadProgress: progress,
                  lastActivityAt: Date.now(),
                }
              : v
          )
        )
      },
      onSuccess: () => {
        console.log(`[Upload] Complete ${video.relativePath}`)
        setVideoFiles(prev =>
          prev.map((v, i) =>
            i === index ? { ...v, uploadStatus: 'complete', uploadProgress: 100 } : v
          )
        )
        activeUploads.delete(videoId)
        saveUploadProgress()

        // Process next in queue
        setTimeout(() => processUploadQueue(), 100)

        // Check if all done
        const allSelected = videoFiles.filter(v => v.selected)
        const allComplete = allSelected.every(
          v => v.uploadStatus === 'complete' || v.uploadStatus === 'error'
        )
        if (allComplete) {
          setUploading(false)
        }
      },
      onAfterResponse: (req, res) => {
        // Store upload URL for resumability
        const uploadUrl = res.getHeader('Location')
        if (uploadUrl) {
          setVideoFiles(prev => prev.map((v, i) => (i === index ? { ...v, uploadUrl } : v)))
        }
      },
    })

    upload.start()
    activeUploads.set(videoId, upload)
  }

  // Helper to determine if error is retryable
  const isRetryableError = (error: Error): boolean => {
    const message = error.message.toLowerCase()
    // Retry on network errors, timeouts, 5xx errors
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('aborted') ||
      message.includes('5')
    ) // 5xx status codes
  }

  // Cancel handlers for smart cancel options
  const handleStopQueued = () => {
    console.log('[Upload] Stopping queued uploads...')

    // Mark all pending uploads as cancelled
    setVideoFiles(prev =>
      prev.map(v =>
        v.uploadStatus === 'pending' || v.uploadStatus === 'stalled'
          ? { ...v, uploadStatus: 'error' as const, error: 'Cancelled by user' }
          : v
      )
    )

    setShowStopQueuedModal(false)
  }

  const handleAbortAll = () => {
    console.log('[Upload] Aborting all uploads...')

    // Abort active uploads
    activeUploads.forEach(upload => {
      upload.abort()
    })
    activeUploads.clear()

    // Mark all non-complete uploads as cancelled
    setVideoFiles(prev =>
      prev.map(v =>
        v.uploadStatus !== 'complete'
          ? { ...v, uploadStatus: 'error' as const, error: 'Cancelled by user' }
          : v
      )
    )

    setUploading(false)
    setShowAbortAllModal(false)
  }

  // Stall detection - check for uploads with no progress
  useEffect(() => {
    if (!uploading) return

    const interval = setInterval(() => {
      const now = Date.now()
      setVideoFiles(prev =>
        prev.map(v => {
          if (v.uploadStatus === 'uploading' && v.lastActivityAt) {
            const timeSinceActivity = now - v.lastActivityAt
            if (timeSinceActivity > STALL_TIMEOUT) {
              console.warn(
                `[Upload] Stalled ${v.relativePath} (no activity for ${timeSinceActivity}ms)`
              )
              // Mark as stalled so it can be retried
              return { ...v, uploadStatus: 'stalled' as const, error: 'Upload stalled' }
            }
          }
          return v
        })
      )

      // Trigger queue processing to pick up stalled uploads
      processUploadQueue()
    }, 10000) // Check every 10 seconds

    return () => clearInterval(interval)
  }, [uploading, videoFiles])

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
  const errorCount = videoFiles.filter(v => v.selected && v.uploadStatus === 'error').length
  const uploadingCount = videoFiles.filter(v => v.selected && v.uploadStatus === 'uploading').length
  const retryingCount = videoFiles.filter(v => v.selected && v.uploadStatus === 'retrying').length
  const pendingCount = videoFiles.filter(v => v.selected && v.uploadStatus === 'pending').length
  const stalledCount = videoFiles.filter(v => v.selected && v.uploadStatus === 'stalled').length

  // Check if any uploads are in progress (not just the uploading flag)
  const hasActiveUploads =
    uploadingCount > 0 || retryingCount > 0 || pendingCount > 0 || stalledCount > 0

  // Warn user before closing/navigating during uploads (only if uploads are actually in progress)
  useEffect(() => {
    if (!hasActiveUploads) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasActiveUploads])

  const overallProgress = selectedCount > 0 ? (completedCount / selectedCount) * 100 : 0

  // Calculate target path for a video (showing preview of collapse if enabled)
  const getTargetPath = (video: VideoFilePreview) => {
    // Use current relativePath which may or may not be collapsed yet
    // When collapse is enabled but not yet applied, we show what it WILL be
    // When collapse is disabled, we show the uncollapsed path
    const pathParts = video.relativePath.split('/')
    const filename = pathParts[pathParts.length - 1]
    if (!filename) return ''
    let videoPath = pathParts
      .slice(0, -1)
      .concat(filename.replace(/\.\w+$/, ''))
      .join('/')

    // Prepend selected folder if any
    if (selectedFolder) {
      videoPath = selectedFolder + '/' + videoPath
    }

    return videoPath
  }

  // Get original file path (before collapse)
  const getOriginalPath = (video: VideoFilePreview) => {
    return (video.file as FileWithPath).webkitRelativePath || video.file.name
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
              Upload video files for caption annotation. Drag folders to preserve directory
              structure.
            </p>
          </div>
        </div>

        {/* Interrupted uploads notification */}
        {showIncompletePrompt && incompleteUploads.length > 0 && (
          <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">
                  Cleared {incompleteUploads.length} interrupted upload
                  {incompleteUploads.length !== 1 ? 's' : ''}
                </h3>
                <div className="mt-2 text-sm text-blue-700 dark:text-blue-300">
                  <p className="mb-2">
                    These uploads were interrupted when the page was closed and have been
                    automatically cleared:
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer font-medium hover:text-blue-800 dark:hover:text-blue-200">
                      View list ({incompleteUploads.length} videos)
                    </summary>
                    <ul className="mt-2 space-y-1 ml-4 text-xs max-h-48 overflow-y-auto">
                      {incompleteUploads.map((upload: IncompleteUpload) => (
                        <li key={upload.uploadId} className="flex justify-between">
                          <span className="font-mono">{upload.videoPath}</span>
                          <span className="text-blue-600 dark:text-blue-400 ml-2">
                            {Math.round(upload.progress * 100)}% complete
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
                <div className="mt-4">
                  <button
                    onClick={() => setShowIncompletePrompt(false)}
                    className="text-sm font-semibold text-blue-800 dark:text-blue-200 hover:text-blue-900 dark:hover:text-blue-100"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {!showConfirmation && !uploading && videoFiles.length === 0 && (
          <div className="mt-8">
            {/* Folder Selection */}
            <div className="mb-6">
              <label
                htmlFor="folder-select"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
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
                ${
                  dragActive
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
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">or click to browse</p>
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
                {...({
                  webkitdirectory: '',
                  directory: '',
                } as React.InputHTMLAttributes<HTMLInputElement>)}
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
                      <svg
                        className="h-5 w-5 text-yellow-400"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                    <div className="ml-3 flex-1">
                      <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                        Path conflict detected
                      </h3>
                      <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-400">
                        <p>
                          {videoFiles.filter(v => v.isDuplicate).length} video
                          {videoFiles.filter(v => v.isDuplicate).length !== 1
                            ? 's target'
                            : ' targets'}{' '}
                          the same path as existing{' '}
                          {videoFiles.filter(v => v.isDuplicate).length !== 1 ? 'videos' : 'video'}.
                          Uploading will overwrite the existing video and all annotation data at{' '}
                          {videoFiles.filter(v => v.isDuplicate).length !== 1
                            ? 'these paths'
                            : 'this path'}
                          .
                        </p>
                      </div>
                      <div className="mt-3">
                        <button
                          onClick={() => {
                            setVideoFiles(prev =>
                              prev.map(f => (f.isDuplicate ? { ...f, selected: false } : f))
                            )
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
                      onChange={e => handleCollapseToggle(e.target.checked)}
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
                            onChange={e => {
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
                        <tr
                          key={index}
                          className={`hover:bg-gray-50 dark:hover:bg-gray-900 ${video.isDuplicate ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''}`}
                        >
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
                        {(file as FileWithPath).webkitRelativePath || file.name} (
                        {file.type || 'unknown'})
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
              <div className="mt-4 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-md border border-amber-200 dark:border-amber-800">
                ⚠️ <strong>Keep this page open during uploads.</strong> Closing or navigating away
                will stop uploads. They cannot resume automatically.
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
                  {uploading
                    ? `Uploading ${selectedCount} video${selectedCount !== 1 ? 's' : ''}...`
                    : 'Upload Complete'}
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

              {/* Status breakdown */}
              {uploading &&
                (uploadingCount > 0 ||
                  retryingCount > 0 ||
                  pendingCount > 0 ||
                  stalledCount > 0 ||
                  errorCount > 0) && (
                  <div className="mt-3 flex flex-wrap gap-3 text-xs">
                    {uploadingCount > 0 && (
                      <span className="text-blue-600 dark:text-blue-400">
                        ↑ {uploadingCount} uploading
                      </span>
                    )}
                    {retryingCount > 0 && (
                      <span className="text-yellow-600 dark:text-yellow-400">
                        ⟳ {retryingCount} retrying
                      </span>
                    )}
                    {pendingCount > 0 && (
                      <span className="text-gray-500 dark:text-gray-400">
                        ⋯ {pendingCount} pending
                      </span>
                    )}
                    {stalledCount > 0 && (
                      <span className="text-orange-600 dark:text-orange-400">
                        ⏸ {stalledCount} stalled
                      </span>
                    )}
                    {errorCount > 0 && (
                      <span className="text-red-600 dark:text-red-400">✗ {errorCount} failed</span>
                    )}
                  </div>
                )}

              {/* Cancel buttons */}
              {uploading &&
                (uploadingCount > 0 ||
                  retryingCount > 0 ||
                  pendingCount > 0 ||
                  stalledCount > 0) && (
                  <div className="mt-4 flex flex-wrap gap-3">
                    {(pendingCount > 0 || stalledCount > 0) && (
                      <button
                        onClick={() => setShowStopQueuedModal(true)}
                        className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        Stop Queued ({pendingCount + stalledCount})
                      </button>
                    )}
                    <button
                      onClick={() => setShowAbortAllModal(true)}
                      className="px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 bg-white dark:bg-gray-800 border border-red-300 dark:border-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30"
                    >
                      Abort All Uploads
                    </button>
                  </div>
                )}

              {/* File List - Two Section Layout */}
              <div className="mt-6 space-y-6">
                {(() => {
                  const selectedVideos = videoFiles.filter(v => v.selected)
                  const inProgressVideos = selectedVideos.filter(
                    v =>
                      v.uploadStatus === 'uploading' ||
                      v.uploadStatus === 'retrying' ||
                      v.uploadStatus === 'pending' ||
                      v.uploadStatus === 'stalled'
                  )
                  const finishedVideos = selectedVideos.filter(
                    v => v.uploadStatus === 'complete' || v.uploadStatus === 'error'
                  )

                  return (
                    <>
                      {/* In Progress Section */}
                      {inProgressVideos.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-200 mb-3">
                            In Progress ({inProgressVideos.length})
                          </h4>
                          <div className="space-y-4 max-h-96 overflow-y-auto">
                            {inProgressVideos.map((video, idx) => {
                              const originalIndex = videoFiles.indexOf(video)
                              return (
                                <div
                                  key={originalIndex}
                                  className="border border-gray-200 dark:border-gray-700 rounded-md p-4"
                                >
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
                                      {video.uploadStatus === 'uploading' && (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                                          Uploading {Math.round(video.uploadProgress)}%
                                        </span>
                                      )}
                                      {video.uploadStatus === 'retrying' && (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                                          Retrying...
                                        </span>
                                      )}
                                      {video.uploadStatus === 'stalled' && (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
                                          Stalled
                                        </span>
                                      )}
                                      {video.uploadStatus === 'pending' && (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                                          Pending
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

                                  {video.error && video.uploadStatus !== 'error' && (
                                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                                      {video.error}
                                    </p>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Finished Section */}
                      {finishedVideos.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-200 mb-3">
                            Finished ({finishedVideos.length})
                          </h4>
                          <div className="space-y-4 max-h-96 overflow-y-auto">
                            {finishedVideos.map((video, idx) => {
                              const originalIndex = videoFiles.indexOf(video)
                              return (
                                <div
                                  key={originalIndex}
                                  className="border border-gray-200 dark:border-gray-700 rounded-md p-4"
                                >
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
                                      {video.uploadStatus === 'error' && (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                          {video.error === 'Cancelled by user'
                                            ? 'Cancelled'
                                            : 'Error'}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {video.error && (
                                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                                      {video.error}
                                    </p>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>

              {completedCount === selectedCount && completedCount > 0 && (
                <div className="mt-6 rounded-lg bg-green-50 dark:bg-green-900/20 p-6 border border-green-200 dark:border-green-800">
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <svg
                        className="h-6 w-6 text-green-600 dark:text-green-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                    <div className="ml-3 flex-1">
                      <h3 className="text-sm font-medium text-green-800 dark:text-green-300">
                        Upload complete!
                      </h3>
                      <div className="mt-2 text-sm text-green-700 dark:text-green-400">
                        <p>
                          Successfully uploaded {selectedVideos.length} video
                          {selectedVideos.length !== 1 ? 's' : ''}. Background processing (frame
                          extraction and OCR) has started automatically.
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

        {/* Stop Queued Modal */}
        <Dialog
          open={showStopQueuedModal}
          onClose={() => setShowStopQueuedModal(false)}
          className="relative z-50"
        >
          <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <DialogPanel className="max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
              <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-gray-200">
                Stop Queued Uploads?
              </DialogTitle>
              <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                <p>
                  This will cancel{' '}
                  {(() => {
                    const currentPending = videoFiles.filter(
                      v => v.uploadStatus === 'pending'
                    ).length
                    const currentStalled = videoFiles.filter(
                      v => v.uploadStatus === 'stalled'
                    ).length
                    const total = currentPending + currentStalled
                    return total
                  })()}{' '}
                  queued upload
                  {(() => {
                    const total = videoFiles.filter(
                      v => v.uploadStatus === 'pending' || v.uploadStatus === 'stalled'
                    ).length
                    return total !== 1 ? 's' : ''
                  })()}
                  .
                </p>
                <p className="mt-2">
                  Uploads currently in progress (
                  {
                    videoFiles.filter(
                      v => v.uploadStatus === 'uploading' || v.uploadStatus === 'retrying'
                    ).length
                  }
                  ) will continue.
                </p>
              </div>
              <div className="mt-6 flex gap-3 justify-end">
                <button
                  onClick={() => setShowStopQueuedModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStopQueued}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-500"
                >
                  Stop Queued
                </button>
              </div>
            </DialogPanel>
          </div>
        </Dialog>

        {/* Abort All Modal */}
        <Dialog
          open={showAbortAllModal}
          onClose={() => setShowAbortAllModal(false)}
          className="relative z-50"
        >
          <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <DialogPanel className="max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
              <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-gray-200">
                Abort All Uploads?
              </DialogTitle>
              <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                <p>
                  This will immediately stop all uploads in progress and cancel all queued uploads.
                </p>
                <div className="mt-3 space-y-1 text-xs">
                  <p>
                    • Currently uploading/retrying:{' '}
                    {
                      videoFiles.filter(
                        v => v.uploadStatus === 'uploading' || v.uploadStatus === 'retrying'
                      ).length
                    }
                  </p>
                  <p>
                    • Queued:{' '}
                    {
                      videoFiles.filter(
                        v => v.uploadStatus === 'pending' || v.uploadStatus === 'stalled'
                      ).length
                    }
                  </p>
                  <p>
                    • Already completed:{' '}
                    {videoFiles.filter(v => v.uploadStatus === 'complete').length} (will be kept)
                  </p>
                </div>
              </div>
              <div className="mt-6 flex gap-3 justify-end">
                <button
                  onClick={() => setShowAbortAllModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAbortAll}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-500"
                >
                  Abort All
                </button>
              </div>
            </DialogPanel>
          </div>
        </Dialog>
      </div>
    </AppLayout>
  )
}
