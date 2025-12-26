import { useLoaderData, Link, useRevalidator } from 'react-router'
import { useState, useMemo, useEffect, useCallback } from 'react'
import { MagnifyingGlassIcon, ChevronRightIcon, ChevronDownIcon, EllipsisVerticalIcon, PlusIcon } from '@heroicons/react/20/solid'
import { Menu, MenuButton, MenuItem, MenuItems, Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import { readdir } from 'fs/promises'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { AppLayout } from '~/components/AppLayout'
import {
  buildVideoTree,
  calculateVideoCounts,
  sortTreeNodes,
  type TreeNode,
  type FolderNode,
  type VideoNode,
  type VideoInfo,
  type VideoStats
} from '~/utils/video-tree'

interface DiscoveredItem {
  path: string
  type: 'video' | 'folder'
}

async function findVideosAndFolders(dir: string, baseDir: string): Promise<DiscoveredItem[]> {
  const items: DiscoveredItem[] = []

  try {
    const entries = await readdir(dir, { withFileTypes: true })

    // Check if this directory has an annotations.db file
    const hasAnnotationsDb = entries.some(
      entry => entry.isFile() && entry.name === 'annotations.db'
    )

    if (hasAnnotationsDb) {
      // Found annotations.db - this is a video directory, record it and stop descending
      const relativePath = dir.substring(baseDir.length + 1) // +1 to remove leading slash
      if (relativePath) {
        items.push({ path: relativePath, type: 'video' })
      }
      return items // Don't descend into subdirectories
    }

    // No annotations.db here, so continue recursing into subdirectories
    // Skip directories that are known to contain data, not video folders
    const skipDirs = new Set(['crop_frames', 'full_frames'])

    const subdirs = entries.filter(entry => entry.isDirectory() && !skipDirs.has(entry.name))

    if (subdirs.length > 0) {
      // This directory has subdirectories - recurse into them
      for (const entry of subdirs) {
        const fullPath = resolve(dir, entry.name)
        const subItems = await findVideosAndFolders(fullPath, baseDir)
        items.push(...subItems)
      }
    } else {
      // This is a leaf directory with no subdirectories and no annotations.db
      // It's an empty folder - include it
      const relativePath = dir.substring(baseDir.length + 1)
      if (relativePath) {
        items.push({ path: relativePath, type: 'folder' })
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dir}:`, error)
  }

  return items
}

export async function loader() {
  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')

  if (!existsSync(dataDir)) {
    return new Response(
      JSON.stringify({ tree: [] }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Find all videos and empty folders
  const items = await findVideosAndFolders(dataDir, dataDir)

  // Convert to VideoInfo objects (only videos need stats)
  const videos: VideoInfo[] = items
    .filter(item => item.type === 'video')
    .map(item => ({ videoId: item.path }))

  // Build tree structure (without stats - will be loaded client-side)
  const tree = buildVideoTree(videos)

  // Add empty folders to the tree
  const emptyFolders = items.filter(item => item.type === 'folder')
  for (const folder of emptyFolders) {
    addEmptyFolderToTree(tree, folder.path)
  }

  // Calculate video counts for each folder
  tree.forEach(node => {
    if (node.type === 'folder') {
      calculateVideoCounts(node)
    }
  })

  // Sort tree: folders first, then videos
  const sortedTree = sortTreeNodes(tree)

  return new Response(
    JSON.stringify({ tree: sortedTree }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}

// Add an empty folder to the tree structure
function addEmptyFolderToTree(tree: TreeNode[], folderPath: string) {
  const parts = folderPath.split('/')
  let currentLevel = tree

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    const pathSegments = parts.slice(0, i + 1)
    const newPath: string = pathSegments.join('/')

    let node = currentLevel.find(n => n.type === 'folder' && n.name === part) as FolderNode | undefined

    if (!node) {
      // Create new folder node with default stats
      const newNode: FolderNode = {
        type: 'folder',
        name: part,
        path: newPath,
        children: [],
        stats: {
          totalAnnotations: 0,
          pendingReview: 0,
          confirmedAnnotations: 0,
          predictedAnnotations: 0,
          gapAnnotations: 0,
          progress: 0,
          totalFrames: 0,
          coveredFrames: 0,
          hasOcrData: false,
          layoutComplete: false
        },
        videoCount: 0
      }
      currentLevel.push(newNode)
      node = newNode
    }

    currentLevel = node.children
  }
}

interface TreeRowProps {
  node: TreeNode
  depth: number
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  videoStatsMap: Map<string, VideoStats>
  onStatsUpdate: (videoId: string, stats: VideoStats) => void
  onCreateSubfolder: (parentPath: string) => void
  onRenameFolder: (folderPath: string, currentName: string) => void
  onDeleteFolder: (folderPath: string, folderName: string, videoCount: number) => void
  onRenameVideo: (videoPath: string, currentName: string) => void
  isMounted: boolean
}

// Calculate aggregate stats for a folder from the stats map
function calculateFolderStatsFromMap(node: FolderNode, statsMap: Map<string, VideoStats>): VideoStats | null {
  const collectVideoIds = (n: TreeNode): string[] => {
    if (n.type === 'video') {
      return [n.videoId]
    } else {
      return n.children.flatMap(collectVideoIds)
    }
  }

  const videoIds = collectVideoIds(node)
  const videoStats = videoIds.map(id => statsMap.get(id)).filter((s): s is VideoStats => s !== undefined)

  if (videoStats.length === 0) return null

  const aggregated: VideoStats = {
    totalAnnotations: 0,
    pendingReview: 0,
    confirmedAnnotations: 0,
    predictedAnnotations: 0,
    gapAnnotations: 0,
    progress: 0,
    totalFrames: 0,
    coveredFrames: 0,
    hasOcrData: false,
    layoutComplete: false
  }

  for (const stats of videoStats) {
    aggregated.totalAnnotations += stats.totalAnnotations || 0
    aggregated.pendingReview += stats.pendingReview || 0
    aggregated.confirmedAnnotations += stats.confirmedAnnotations || 0
    aggregated.predictedAnnotations += stats.predictedAnnotations || 0
    aggregated.gapAnnotations += stats.gapAnnotations || 0
    aggregated.totalFrames += stats.totalFrames || 0
    aggregated.coveredFrames += stats.coveredFrames || 0
    // Aggregate hasOcrData and layoutComplete as "any video has it"
    aggregated.hasOcrData = aggregated.hasOcrData || stats.hasOcrData
    aggregated.layoutComplete = aggregated.layoutComplete || stats.layoutComplete
  }

  aggregated.progress = aggregated.totalFrames > 0
    ? Math.round((aggregated.coveredFrames / aggregated.totalFrames) * 100)
    : 0

  return aggregated
}

function TreeRow({ node, depth, expandedPaths, onToggle, videoStatsMap, onStatsUpdate, onCreateSubfolder, onRenameFolder, onDeleteFolder, onRenameVideo, isMounted }: TreeRowProps) {
  const [loading, setLoading] = useState(false)
  const isExpanded = expandedPaths.has(node.path)

  // Load stats for video nodes
  useEffect(() => {
    if (node.type === 'video' && !videoStatsMap.has(node.videoId)) {
      setLoading(true)
      fetch(`/api/videos/${encodeURIComponent(node.videoId)}/stats`)
        .then(res => res.json())
        .then(data => {
          onStatsUpdate(node.videoId, data)
          setLoading(false)
        })
        .catch(err => {
          console.error(`Failed to load stats for ${node.videoId}:`, err)
          setLoading(false)
        })
    }
  }, [node, videoStatsMap, onStatsUpdate])

  // Only use stats after client-side mount to avoid hydration mismatch
  const stats = isMounted
    ? (node.type === 'video'
        ? videoStatsMap.get(node.videoId) || null
        : calculateFolderStatsFromMap(node, videoStatsMap))
    : null

  // Debug logging for video nodes
  if (node.type === 'video' && isMounted) {
    console.log(`[TreeRow] Video ${node.videoId}: stats =`, stats)
  }

  if (node.type === 'folder') {
    return (
      <>
        {/* Folder Row */}
        <tr className="bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800">
          <td
            className="whitespace-nowrap py-3 pl-4 pr-3 text-sm font-medium text-gray-900 dark:text-gray-300 sm:pl-6 cursor-pointer"
            style={{ paddingLeft: `${depth * 1.5 + 1.5}rem` }}
            onClick={() => onToggle(node.path)}
          >
            <div className="flex items-center gap-2">
              {isExpanded ? (
                <ChevronDownIcon className="h-4 w-4 text-gray-500 dark:text-gray-500 flex-shrink-0" />
              ) : (
                <ChevronRightIcon className="h-4 w-4 text-gray-500 dark:text-gray-500 flex-shrink-0" />
              )}
              <span className="font-semibold">{node.name}/</span>
              <span className="text-xs text-gray-500 dark:text-gray-500">({node.videoCount} {node.videoCount === 1 ? 'video' : 'videos'})</span>
            </div>
          </td>
          <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 dark:text-gray-400">
            {stats ? stats.totalAnnotations : '-'}
          </td>
          <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 dark:text-gray-400">
            {stats && stats.totalAnnotations > 0 ? (
              <div className="flex h-2 w-32 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                {stats.confirmedAnnotations > 0 && (
                  <div
                    className="bg-teal-500"
                    style={{ width: `${(stats.confirmedAnnotations / (stats.totalAnnotations - stats.gapAnnotations)) * 100}%` }}
                    title={`${stats.confirmedAnnotations} confirmed`}
                  />
                )}
                {stats.predictedAnnotations > 0 && (
                  <div
                    className="bg-indigo-500"
                    style={{ width: `${(stats.predictedAnnotations / (stats.totalAnnotations - stats.gapAnnotations)) * 100}%` }}
                    title={`${stats.predictedAnnotations} predicted`}
                  />
                )}
                {stats.pendingReview > 0 && (
                  <div
                    className="bg-pink-500"
                    style={{ width: `${(stats.pendingReview / (stats.totalAnnotations - stats.gapAnnotations)) * 100}%` }}
                    title={`${stats.pendingReview} pending`}
                  />
                )}
              </div>
            ) : (
              <span className="text-gray-500 dark:text-gray-500">-</span>
            )}
          </td>
          <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 dark:text-gray-400">
            {stats && stats.pendingReview > 0 ? (
              <span className="inline-flex items-center rounded-md bg-yellow-50 dark:bg-yellow-900/30 px-2 py-1 text-xs font-medium text-yellow-800 dark:text-yellow-400 ring-1 ring-inset ring-yellow-600/20 dark:ring-yellow-500/30">
                {stats.pendingReview}
              </span>
            ) : (
              <span className="text-gray-500 dark:text-gray-500">0</span>
            )}
          </td>
          <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 dark:text-gray-400">
            {stats ? (
              <div className="flex items-center gap-2">
                <div className="w-24 bg-gray-300 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-emerald-500 dark:bg-emerald-500 h-2 rounded-full transition-all"
                    style={{ width: `${stats.progress}%` }}
                  />
                </div>
                <span className="text-xs">{stats.progress}%</span>
              </div>
            ) : (
              <span className="text-gray-500 dark:text-gray-500">-</span>
            )}
          </td>
          <td className="relative whitespace-nowrap py-3 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
            <Menu as="div" className="relative inline-block text-left">
              <MenuButton className="flex items-center rounded-full text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                <span className="sr-only">Open folder options</span>
                <EllipsisVerticalIcon className="h-5 w-5" aria-hidden="true" />
              </MenuButton>
              <MenuItems anchor="bottom end" className="z-50 mt-2 w-56 rounded-md bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10 focus:outline-none">
                <div className="py-1">
                  <MenuItem>
                    <button
                      onClick={() => onCreateSubfolder(node.path)}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:text-gray-900 dark:data-[focus]:text-white data-[focus]:outline-none"
                    >
                      New subfolder...
                    </button>
                  </MenuItem>
                  <MenuItem>
                    <button
                      onClick={() => onRenameFolder(node.path, node.name)}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:text-gray-900 dark:data-[focus]:text-white data-[focus]:outline-none"
                    >
                      Rename...
                    </button>
                  </MenuItem>
                  <MenuItem>
                    <button
                      onClick={() => onDeleteFolder(node.path, node.name, node.videoCount)}
                      className="block w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:outline-none"
                    >
                      Delete folder...
                    </button>
                  </MenuItem>
                </div>
              </MenuItems>
            </Menu>
          </td>
        </tr>

        {/* Render children if expanded */}
        {isExpanded && node.children.map(child => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expandedPaths={expandedPaths}
            onToggle={onToggle}
            videoStatsMap={videoStatsMap}
            onStatsUpdate={onStatsUpdate}
            onCreateSubfolder={onCreateSubfolder}
            isMounted={isMounted}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            onRenameVideo={onRenameVideo}
          />
        ))}
      </>
    )
  }

  // Video Row
  const videoId = node.videoId

  // Processing status badge
  const getProcessingStatusBadge = () => {
    if (!stats?.processingStatus) return null

    const { status } = stats.processingStatus

    const statusConfig = {
      uploading: { label: 'Uploading', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
      upload_complete: { label: 'Upload Complete', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
      extracting_frames: { label: 'Extracting Frames', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400' },
      running_ocr: { label: 'Running OCR', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' },
      analyzing_layout: { label: 'Analyzing Layout', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' },
      processing_complete: { label: 'Ready', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
      error: { label: 'Error', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
    }

    const config = statusConfig[status]
    return (
      <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${config.color}`}>
        {config.label}
      </span>
    )
  }

  return (
    <tr className="hover:bg-gray-100 dark:hover:bg-gray-800">
      <td
        className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 dark:text-gray-300 sm:pl-6"
        style={{ paddingLeft: `${depth * 1.5 + 1.5}rem` }}
      >
        <div className="flex items-center gap-2">
          <span>{node.name}</span>
          {getProcessingStatusBadge()}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-400">
        {stats ? stats.totalAnnotations : '-'}
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-400">
        {stats && stats.totalAnnotations > 0 ? (
          <div className="flex h-2 w-32 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            {stats.confirmedAnnotations > 0 && (
              <div
                className="bg-teal-500"
                style={{ width: `${(stats.confirmedAnnotations / (stats.totalAnnotations - stats.gapAnnotations)) * 100}%` }}
                title={`${stats.confirmedAnnotations} confirmed`}
              />
            )}
            {stats.predictedAnnotations > 0 && (
              <div
                className="bg-indigo-500"
                style={{ width: `${(stats.predictedAnnotations / (stats.totalAnnotations - stats.gapAnnotations)) * 100}%` }}
                title={`${stats.predictedAnnotations} predicted`}
              />
            )}
            {stats.pendingReview > 0 && (
              <div
                className="bg-pink-500"
                style={{ width: `${(stats.pendingReview / (stats.totalAnnotations - stats.gapAnnotations)) * 100}%` }}
                title={`${stats.pendingReview} pending`}
              />
            )}
          </div>
        ) : (
          <span className="text-gray-500 dark:text-gray-500">-</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-400">
        {stats && stats.pendingReview > 0 ? (
          <span className="inline-flex items-center rounded-md bg-yellow-50 dark:bg-yellow-900/30 px-2 py-1 text-xs font-medium text-yellow-800 dark:text-yellow-400 ring-1 ring-inset ring-yellow-600/20 dark:ring-yellow-500/30">
            {stats.pendingReview}
          </span>
        ) : (
          <span className="text-gray-500 dark:text-gray-500">0</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-400">
        {stats ? (
          <div className="flex items-center gap-2">
            <div className="w-24 bg-gray-300 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-emerald-500 dark:bg-emerald-500 h-2 rounded-full transition-all"
                style={{ width: `${stats.progress}%` }}
              />
            </div>
            <span className="text-xs">{stats.progress}%</span>
          </div>
        ) : (
          <span className="text-gray-500 dark:text-gray-500">-</span>
        )}
      </td>
      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
        <Menu as="div" className="relative inline-block text-left">
          <MenuButton className="flex items-center rounded-full text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            <span className="sr-only">Open options</span>
            <EllipsisVerticalIcon className="h-5 w-5" aria-hidden="true" />
          </MenuButton>
          <MenuItems anchor="bottom end" className="z-50 mt-2 w-56 rounded-md bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10 focus:outline-none">
            <div className="py-1">
              <MenuItem disabled={
                !stats?.hasOcrData ||
                (stats?.processingStatus && stats.processingStatus.status !== 'processing_complete')
              }>
                {({ disabled }) => {
                  const statusText = stats?.processingStatus?.status
                    ? `(${stats.processingStatus.status.replace(/_/g, ' ')})`
                    : !stats?.hasOcrData ? '(no OCR data)' : ''

                  return disabled ? (
                    <span className="block px-4 py-2 text-sm text-gray-400 dark:text-gray-600 cursor-not-allowed">
                      Annotate Layout {statusText}
                    </span>
                  ) : (
                    <Link
                      to={`/annotate/layout?videoId=${encodeURIComponent(videoId)}`}
                      className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:text-gray-900 dark:data-[focus]:text-white data-[focus]:outline-none"
                    >
                      Annotate Layout
                    </Link>
                  )
                }}
              </MenuItem>
              <MenuItem disabled={!stats?.layoutComplete}>
                {({ disabled }) => (
                  disabled ? (
                    <span className="block px-4 py-2 text-sm text-gray-400 dark:text-gray-600 cursor-not-allowed">
                      Mark Boundaries
                    </span>
                  ) : (
                    <Link
                      to={`/annotate/boundaries?videoId=${encodeURIComponent(videoId)}`}
                      className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:text-gray-900 dark:data-[focus]:text-white data-[focus]:outline-none"
                    >
                      Mark Boundaries
                    </Link>
                  )
                )}
              </MenuItem>
              <MenuItem disabled={!stats?.layoutComplete || stats.totalAnnotations === 0}>
                {({ disabled }) => (
                  disabled ? (
                    <span className="block px-4 py-2 text-sm text-gray-400 dark:text-gray-600 cursor-not-allowed">
                      Annotate Text
                    </span>
                  ) : (
                    <Link
                      to={`/annotate/text?videoId=${encodeURIComponent(videoId)}`}
                      className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:text-gray-900 dark:data-[focus]:text-white data-[focus]:outline-none"
                    >
                      Annotate Text
                    </Link>
                  )
                )}
              </MenuItem>
              <MenuItem>
                <button
                  onClick={() => onRenameVideo(node.videoId, node.name)}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:text-gray-900 dark:data-[focus]:text-white data-[focus]:outline-none"
                >
                  Rename...
                </button>
              </MenuItem>
            </div>
          </MenuItems>
        </Menu>
      </td>
    </tr>
  )
}

export default function VideosPage() {
  const { tree } = useLoaderData<{ tree: TreeNode[] }>()
  const revalidator = useRevalidator()
  const [searchQuery, setSearchQuery] = useState('')
  const CACHE_VERSION = 'v4' // Increment to invalidate cache when VideoStats structure changes

  // Modal states
  const [createFolderModal, setCreateFolderModal] = useState<{ open: boolean; parentPath?: string }>({ open: false })
  const [renameFolderModal, setRenameFolderModal] = useState<{ open: boolean; folderPath?: string; currentName?: string }>({ open: false })
  const [deleteFolderModal, setDeleteFolderModal] = useState<{ open: boolean; folderPath?: string; folderName?: string; videoCount?: number }>({ open: false })
  const [renameVideoModal, setRenameVideoModal] = useState<{ open: boolean; videoPath?: string; currentName?: string }>({ open: false })

  // Form states
  const [newFolderName, setNewFolderName] = useState('')
  const [renamedFolderName, setRenamedFolderName] = useState('')
  const [renamedVideoName, setRenamedVideoName] = useState('')
  const [folderError, setFolderError] = useState<string | null>(null)
  const [folderLoading, setFolderLoading] = useState(false)
  const [videoError, setVideoError] = useState<string | null>(null)
  const [videoLoading, setVideoLoading] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const [videoStatsMap, setVideoStatsMap] = useState<Map<string, VideoStats>>(() => {
    // Load cached stats from localStorage
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem(`video-stats-cache-${CACHE_VERSION}`)
      if (cached) {
        try {
          const parsed = JSON.parse(cached)
          return new Map(Object.entries(parsed))
        } catch {
          return new Map()
        }
      }
    }
    return new Map()
  })
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    // Load expansion state from localStorage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('video-tree-expanded')
      if (saved) {
        try {
          return new Set(JSON.parse(saved))
        } catch {
          return new Set()
        }
      }
    }
    return new Set()
  })

  // Detect client-side mount to avoid hydration mismatch
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Save stats to localStorage whenever they update
  useEffect(() => {
    if (videoStatsMap.size > 0 && typeof window !== 'undefined') {
      // Filter out any invalid stats objects (those with error property)
      const validStats = Array.from(videoStatsMap.entries()).filter(
        ([_, stats]) => !('error' in stats)
      )
      if (validStats.length > 0) {
        const cacheObj = Object.fromEntries(validStats)
        localStorage.setItem(`video-stats-cache-${CACHE_VERSION}`, JSON.stringify(cacheObj))
      }
    }
  }, [videoStatsMap])

  // Callback for videos to update their stats
  const updateVideoStats = useCallback((videoId: string, stats: VideoStats) => {
    setVideoStatsMap(prev => {
      const next = new Map(prev)
      next.set(videoId, stats)
      return next
    })
  }, [])

  // Poll for stats updates for videos that are processing
  useEffect(() => {
    if (!isMounted) return

    // Find videos that are currently processing
    const processingVideos = Array.from(videoStatsMap.entries())
      .filter(([_, stats]) =>
        stats.processingStatus &&
        stats.processingStatus.status !== 'processing_complete' &&
        stats.processingStatus.status !== 'error'
      )
      .map(([videoId]) => videoId)

    if (processingVideos.length === 0) return

    console.log(`[Videos] Polling ${processingVideos.length} processing videos...`)

    // Poll every 5 seconds
    const interval = setInterval(() => {
      processingVideos.forEach(videoId => {
        fetch(`/api/videos/${encodeURIComponent(videoId)}/stats`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data && !data.error) {
              console.log(`[Videos] Polling update for ${videoId}:`, data.processingStatus?.status)
              updateVideoStats(videoId, data)
            }
          })
          .catch(err => console.error(`Failed to poll stats for ${videoId}:`, err))
      })
    }, 5000)

    return () => clearInterval(interval)
  }, [isMounted, videoStatsMap, updateVideoStats])

  // Eagerly load stats for all videos in the tree
  useEffect(() => {
    const collectAllVideoIds = (nodes: TreeNode[]): string[] => {
      const ids: string[] = []
      for (const node of nodes) {
        if (node.type === 'video') {
          ids.push(node.videoId)
        } else {
          ids.push(...collectAllVideoIds(node.children))
        }
      }
      return ids
    }

    const videoIds = collectAllVideoIds(tree)

    // Check for videos that were recently touched and need stats refresh
    let touchedVideos: Set<string> = new Set()
    if (typeof window !== 'undefined') {
      const touchedList = localStorage.getItem('touched-videos')
      if (touchedList) {
        try {
          touchedVideos = new Set(JSON.parse(touchedList))
          // Clear the list after reading
          localStorage.removeItem('touched-videos')
        } catch (e) {
          console.error('Failed to parse touched videos list:', e)
        }
      }
    }

    // Load stats for all videos (skip cached ones unless they were recently touched)
    videoIds.forEach(videoId => {
      const needsRefresh = touchedVideos.has(videoId)
      if (needsRefresh || !videoStatsMap.has(videoId)) {
        console.log(`[Videos] Loading stats for ${videoId}...`)
        fetch(`/api/videos/${encodeURIComponent(videoId)}/stats`)
          .then(res => {
            if (!res.ok) {
              console.error(`[Videos] Stats request failed for ${videoId}: ${res.status}`)
              return null
            }
            return res.json()
          })
          .then(data => {
            if (data && !data.error) {
              console.log(`[Videos] Stats loaded for ${videoId}:`, data)
              updateVideoStats(videoId, data)
            } else {
              console.error(`[Videos] Stats error for ${videoId}:`, data?.error || 'Unknown error')
            }
          })
          .catch(err => console.error(`Failed to load stats for ${videoId}:`, err))
      }
    })
  }, [tree, videoStatsMap, updateVideoStats])

  // Save expansion state to localStorage
  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('video-tree-expanded', JSON.stringify(Array.from(next)))
      }
      return next
    })
  }

  // Expand all folders
  const expandAll = () => {
    const allPaths = new Set<string>()
    const collectPaths = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        if (node.type === 'folder') {
          allPaths.add(node.path)
          collectPaths(node.children)
        }
      })
    }
    collectPaths(tree)
    setExpandedPaths(allPaths)
    if (typeof window !== 'undefined') {
      localStorage.setItem('video-tree-expanded', JSON.stringify(Array.from(allPaths)))
    }
  }

  // Collapse all folders
  const collapseAll = () => {
    setExpandedPaths(new Set())
    if (typeof window !== 'undefined') {
      localStorage.setItem('video-tree-expanded', JSON.stringify([]))
    }
  }

  // Folder operation handlers
  const handleCreateFolder = async () => {
    setFolderError(null)
    setFolderLoading(true)

    try {
      const folderPath = createFolderModal.parentPath
        ? `${createFolderModal.parentPath}/${newFolderName}`
        : newFolderName

      const response = await fetch('/api/folders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath })
      })

      const data = await response.json()

      if (!response.ok) {
        setFolderError(data.error || 'Failed to create folder')
        setFolderLoading(false)
        return
      }

      // Success - close modal and reload
      setFolderLoading(false)
      setCreateFolderModal({ open: false })
      setNewFolderName('')
      revalidator.revalidate()
    } catch (error) {
      setFolderError('Network error')
      setFolderLoading(false)
    }
  }

  const handleRenameFolder = async () => {
    setFolderError(null)
    setFolderLoading(true)

    try {
      const oldPath = renameFolderModal.folderPath!
      const pathParts = oldPath.split('/')
      pathParts[pathParts.length - 1] = renamedFolderName
      const newPath = pathParts.join('/')

      const response = await fetch('/api/folders/rename', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath })
      })

      const data = await response.json()

      if (!response.ok) {
        setFolderError(data.error || 'Failed to rename folder')
        setFolderLoading(false)
        return
      }

      // Success - close modal and reload
      setFolderLoading(false)
      setRenameFolderModal({ open: false })
      setRenamedFolderName('')
      revalidator.revalidate()
    } catch (error) {
      setFolderError('Network error')
      setFolderLoading(false)
    }
  }

  const handleDeleteFolder = async () => {
    setFolderError(null)
    setFolderLoading(true)

    try {
      // Delete with confirmed=true parameter
      const response = await fetch(`/api/folders/delete?path=${encodeURIComponent(deleteFolderModal.folderPath!)}&confirmed=true`, {
        method: 'DELETE'
      })

      const data = await response.json()

      if (!response.ok) {
        setFolderError(data.error || 'Failed to delete folder')
        setFolderLoading(false)
        return
      }

      // Success - close modal and reload
      setFolderLoading(false)
      setDeleteFolderModal({ open: false })
      revalidator.revalidate()
    } catch (error) {
      setFolderError('Network error')
      setFolderLoading(false)
    }
  }

  // Load video count before showing delete modal
  const handleDeleteFolderClick = async (folderPath: string, folderName: string) => {
    setFolderError(null)
    setFolderLoading(true)

    try {
      // First, get the video count
      const response = await fetch(`/api/folders/delete?path=${encodeURIComponent(folderPath)}`, {
        method: 'DELETE'
      })

      const data = await response.json()

      if (data.requiresConfirmation) {
        // Show modal with video count
        setDeleteFolderModal({
          open: true,
          folderPath,
          folderName,
          videoCount: data.videoCount
        })
        setFolderLoading(false)
      } else if (!response.ok) {
        setFolderError(data.error || 'Failed to check folder')
        setFolderLoading(false)
      }
    } catch (error) {
      setFolderError('Network error')
      setFolderLoading(false)
    }
  }

  // Video rename handler
  const handleRenameVideo = async () => {
    setVideoError(null)
    setVideoLoading(true)

    try {
      const oldPath = renameVideoModal.videoPath!

      const response = await fetch('/api/videos/rename', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newName: renamedVideoName })
      })

      const data = await response.json()

      if (!response.ok) {
        setVideoError(data.error || 'Failed to rename video')
        setVideoLoading(false)
        return
      }

      // Success - close modal and reload
      setVideoLoading(false)
      setRenameVideoModal({ open: false })
      setRenamedVideoName('')
      revalidator.revalidate()
    } catch (error) {
      setVideoError('Network error')
      setVideoLoading(false)
    }
  }

  const filteredTree = useMemo(() => {
    if (!searchQuery) return tree

    const query = searchQuery.toLowerCase()

    const filterNode = (node: TreeNode): TreeNode | null => {
      if (node.type === 'video') {
        // Check if video name or path matches
        const matches = node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)
        return matches ? node : null
      } else {
        // For folders, filter children and keep folder if any children match
        const filteredChildren = node.children
          .map(filterNode)
          .filter((n): n is TreeNode => n !== null)

        if (filteredChildren.length > 0) {
          return {
            ...node,
            children: filteredChildren
          }
        }

        // Also match folder name
        const matches = node.name.toLowerCase().includes(query)
        return matches ? node : null
      }
    }

    return tree.map(filterNode).filter((n): n is TreeNode => n !== null)
  }, [tree, searchQuery])

  return (
    <AppLayout>
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="sm:flex sm:items-center sm:justify-between">
          <div className="sm:flex-auto">
            <h1 className="text-base font-semibold text-gray-900 dark:text-gray-200">Videos</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              A list of all videos with annotation statistics and progress.
            </p>
          </div>
          <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex sm:items-center sm:gap-4">
            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-teal-500" />
                <span>Confirmed</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-indigo-500" />
                <span>Predicted</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-pink-500" />
                <span>Pending</span>
              </div>
            </div>
            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setCreateFolderModal({ open: true })
                  setNewFolderName('')
                  setFolderError(null)
                  setFolderLoading(false)
                }}
                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                <PlusIcon className="h-4 w-4" />
                New Folder
              </button>
              <Link
                to="/upload"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Upload Videos
              </Link>
            </div>
          </div>
        </div>

      {/* Search and Controls */}
      <div className="mt-8 flex gap-3">
        <div className="relative flex-1 rounded-md shadow-sm">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-500 dark:text-gray-500" aria-hidden="true" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="block w-full rounded-md border-0 py-1.5 pl-10 text-gray-900 dark:text-white dark:bg-gray-800 ring-1 ring-inset ring-gray-300 dark:ring-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-inset focus:ring-indigo-600 dark:focus:ring-indigo-500 sm:text-sm"
            placeholder="Search videos..."
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={expandAll}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="mt-8 flow-root">
        <div className="-mx-4 -my-2 sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full align-middle sm:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 dark:ring-white dark:ring-opacity-10 sm:rounded-lg">
              <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 25rem)' }}>
                <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th
                        scope="col"
                        className="py-2 pl-4 pr-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 sm:pl-6 bg-gray-50 dark:bg-gray-800"
                      >
                        {/* Video column - no group header */}
                      </th>
                      <th
                        scope="colgroup"
                        colSpan={4}
                        className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800"
                      >
                        Boundary Annotation
                      </th>
                      <th scope="col" className="relative py-2 pl-3 pr-4 sm:pr-6 bg-gray-50 dark:bg-gray-800">
                        {/* Actions column - no group header */}
                      </th>
                    </tr>
                    <tr>
                      <th
                        scope="col"
                        className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-200 sm:pl-6 bg-gray-50 dark:bg-gray-800"
                      >
                        Video
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-gray-200 bg-gray-50 dark:bg-gray-800"
                      >
                        Total
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-gray-200 bg-gray-50 dark:bg-gray-800"
                      >
                        Distribution
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-gray-200 bg-gray-50 dark:bg-gray-800"
                      >
                        Pending
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-gray-200 bg-gray-50 dark:bg-gray-800"
                      >
                        Progress
                      </th>
                      <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6 bg-gray-50 dark:bg-gray-800">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-950">
                    {filteredTree.map((node) => (
                      <TreeRow
                        key={node.path}
                        node={node}
                        depth={0}
                        expandedPaths={expandedPaths}
                        onToggle={toggleExpand}
                        videoStatsMap={videoStatsMap}
                        onStatsUpdate={updateVideoStats}
                        isMounted={isMounted}
                        onCreateSubfolder={(parentPath) => {
                          setCreateFolderModal({ open: true, parentPath })
                          setNewFolderName('')
                          setFolderError(null)
                          setFolderLoading(false)
                        }}
                        onRenameFolder={(folderPath, currentName) => {
                          setRenameFolderModal({ open: true, folderPath, currentName })
                          setRenamedFolderName(currentName)
                          setFolderError(null)
                          setFolderLoading(false)
                        }}
                        onDeleteFolder={handleDeleteFolderClick}
                        onRenameVideo={(videoPath, currentName) => {
                          setRenameVideoModal({ open: true, videoPath, currentName })
                          setRenamedVideoName(currentName)
                          setVideoError(null)
                          setVideoLoading(false)
                        }}
                      />
                    ))}
                  </tbody>
                </table>

                {filteredTree.length === 0 && (
                  <div className="bg-white dark:bg-gray-950 text-center py-12">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {searchQuery ? 'No videos found matching your search.' : 'No videos available.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Create Folder Modal */}
      <Dialog open={createFolderModal.open} onClose={() => setCreateFolderModal({ open: false })} className="relative z-50">
        <div className="fixed inset-0 bg-black/30 dark:bg-black/50" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
            <DialogTitle className="text-lg font-medium text-gray-900 dark:text-gray-200">
              {createFolderModal.parentPath ? 'Create Subfolder' : 'Create New Folder'}
            </DialogTitle>
            <div className="mt-4">
              {createFolderModal.parentPath && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Parent: <span className="font-mono">{createFolderModal.parentPath}/</span>
                </p>
              )}
              <label htmlFor="folder-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Folder name
              </label>
              <input
                type="text"
                id="folder-name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !folderLoading && handleCreateFolder()}
                placeholder="e.g., season_1"
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                autoFocus
              />
              {folderError && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">{folderError}</p>
              )}
            </div>
            <div className="mt-6 flex gap-3 justify-end">
              <button
                onClick={() => setCreateFolderModal({ open: false })}
                disabled={folderLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || folderLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {folderLoading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>

      {/* Rename Folder Modal */}
      <Dialog open={renameFolderModal.open} onClose={() => setRenameFolderModal({ open: false })} className="relative z-50">
        <div className="fixed inset-0 bg-black/30 dark:bg-black/50" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
            <DialogTitle className="text-lg font-medium text-gray-900 dark:text-gray-200">
              Rename Folder
            </DialogTitle>
            <div className="mt-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Folder: <span className="font-mono">{renameFolderModal.folderPath}</span>
              </p>
              <label htmlFor="renamed-folder-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                New name
              </label>
              <input
                type="text"
                id="renamed-folder-name"
                value={renamedFolderName}
                onChange={(e) => setRenamedFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !folderLoading && handleRenameFolder()}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                autoFocus
              />
              {folderError && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">{folderError}</p>
              )}
            </div>
            <div className="mt-6 flex gap-3 justify-end">
              <button
                onClick={() => setRenameFolderModal({ open: false })}
                disabled={folderLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRenameFolder}
                disabled={!renamedFolderName.trim() || folderLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {folderLoading ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>

      {/* Delete Folder Modal */}
      <Dialog open={deleteFolderModal.open} onClose={() => setDeleteFolderModal({ open: false })} className="relative z-50">
        <div className="fixed inset-0 bg-black/30 dark:bg-black/50" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
            <DialogTitle className="text-lg font-medium text-gray-900 dark:text-gray-200">
              Delete Folder
            </DialogTitle>
            <div className="mt-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Are you sure you want to delete the folder <span className="font-mono font-medium">{deleteFolderModal.folderName}</span>?
              </p>

              {deleteFolderModal.videoCount !== undefined && deleteFolderModal.videoCount > 0 && (
                <div className="mt-4 rounded-md bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-red-800 dark:text-red-300">
                        This will permanently delete {deleteFolderModal.videoCount} {deleteFolderModal.videoCount === 1 ? 'video' : 'videos'}
                      </h3>
                      <div className="mt-2 text-sm text-red-700 dark:text-red-400">
                        <p>All annotation data, frames, and video files in this folder will be lost forever.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {deleteFolderModal.videoCount === 0 && (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  This folder is empty.
                </p>
              )}

              <p className="mt-3 text-sm font-medium text-gray-900 dark:text-gray-200">
                This action cannot be undone.
              </p>

              {folderError && (
                <p className="mt-3 text-sm text-red-600 dark:text-red-400">{folderError}</p>
              )}
            </div>
            <div className="mt-6 flex gap-3 justify-end">
              <button
                onClick={() => setDeleteFolderModal({ open: false })}
                disabled={folderLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteFolder}
                disabled={folderLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {folderLoading ? 'Deleting...' : deleteFolderModal.videoCount && deleteFolderModal.videoCount > 0 ? `Delete ${deleteFolderModal.videoCount} ${deleteFolderModal.videoCount === 1 ? 'Video' : 'Videos'}` : 'Delete Folder'}
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>

      {/* Rename Video Modal */}
      <Dialog open={renameVideoModal.open} onClose={() => setRenameVideoModal({ open: false })} className="relative z-50">
        <div className="fixed inset-0 bg-black/30 dark:bg-black/50" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
            <DialogTitle className="text-lg font-medium text-gray-900 dark:text-gray-200">
              Rename Video
            </DialogTitle>
            <div className="mt-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Video: <span className="font-mono">{renameVideoModal.videoPath}</span>
              </p>
              <label htmlFor="renamed-video-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                New name
              </label>
              <input
                type="text"
                id="renamed-video-name"
                value={renamedVideoName}
                onChange={(e) => setRenamedVideoName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !videoLoading && handleRenameVideo()}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                autoFocus
              />
              {videoError && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">{videoError}</p>
              )}
            </div>
            <div className="mt-6 flex gap-3 justify-end">
              <button
                onClick={() => setRenameVideoModal({ open: false })}
                disabled={videoLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRenameVideo}
                disabled={!renamedVideoName.trim() || videoLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {videoLoading ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
      </div>
    </AppLayout>
  )
}
