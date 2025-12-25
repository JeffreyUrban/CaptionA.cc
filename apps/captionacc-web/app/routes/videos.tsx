import { useLoaderData, Link } from 'react-router'
import { useState, useMemo, useEffect, useCallback } from 'react'
import { MagnifyingGlassIcon, ChevronRightIcon, ChevronDownIcon, EllipsisVerticalIcon } from '@heroicons/react/20/solid'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
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

async function findVideos(dir: string, baseDir: string): Promise<string[]> {
  const videoPaths: string[] = []

  try {
    const entries = await readdir(dir, { withFileTypes: true })

    // Check if this directory has a caption_frames subdirectory
    const hasCaptionFrames = entries.some(
      entry => entry.isDirectory() && entry.name === 'caption_frames'
    )

    if (hasCaptionFrames) {
      // Found caption_frames - this is a video directory, record it and stop descending
      const relativePath = dir.substring(baseDir.length + 1) // +1 to remove leading slash
      if (relativePath) {
        videoPaths.push(relativePath)
      }
      return videoPaths // Don't descend into subdirectories
    }

    // No caption_frames here, so continue recursing into subdirectories
    // Skip directories that are known to contain data, not video folders
    const skipDirs = new Set(['caption_frames', 'caption_layout'])

    for (const entry of entries) {
      if (entry.isDirectory() && !skipDirs.has(entry.name)) {
        const fullPath = resolve(dir, entry.name)
        const subPaths = await findVideos(fullPath, baseDir)
        videoPaths.push(...subPaths)
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dir}:`, error)
  }

  return videoPaths
}

export async function loader() {
  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')

  if (!existsSync(dataDir)) {
    return new Response(
      JSON.stringify({ tree: [] }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Find all videos by looking for caption_frames directories
  const videoPaths = await findVideos(dataDir, dataDir)

  // Convert to VideoInfo objects
  const videos: VideoInfo[] = videoPaths.map(videoId => ({
    videoId
  }))

  // Build tree structure (without stats - will be loaded client-side)
  const tree = buildVideoTree(videos)

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

interface TreeRowProps {
  node: TreeNode
  depth: number
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  videoStatsMap: Map<string, VideoStats>
  onStatsUpdate: (videoId: string, stats: VideoStats) => void
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
    coveredFrames: 0
  }

  for (const stats of videoStats) {
    aggregated.totalAnnotations += stats.totalAnnotations || 0
    aggregated.pendingReview += stats.pendingReview || 0
    aggregated.confirmedAnnotations += stats.confirmedAnnotations || 0
    aggregated.predictedAnnotations += stats.predictedAnnotations || 0
    aggregated.gapAnnotations += stats.gapAnnotations || 0
    aggregated.totalFrames += stats.totalFrames || 0
    aggregated.coveredFrames += stats.coveredFrames || 0
  }

  aggregated.progress = aggregated.totalFrames > 0
    ? Math.round((aggregated.coveredFrames / aggregated.totalFrames) * 100)
    : 0

  return aggregated
}

function TreeRow({ node, depth, expandedPaths, onToggle, videoStatsMap, onStatsUpdate }: TreeRowProps) {
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

  const stats = node.type === 'video'
    ? videoStatsMap.get(node.videoId) || null
    : calculateFolderStatsFromMap(node, videoStatsMap)

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
            {/* Folder actions placeholder */}
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
          />
        ))}
      </>
    )
  }

  // Video Row
  const videoId = node.videoId

  return (
    <tr className="hover:bg-gray-100 dark:hover:bg-gray-800">
      <td
        className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 dark:text-gray-300 sm:pl-6"
        style={{ paddingLeft: `${depth * 1.5 + 1.5}rem` }}
      >
        {node.name}
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
          <MenuItems className="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-md bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10 focus:outline-none">
            <div className="py-1">
              <MenuItem>
                <Link
                  to={`/annotate/boundaries?videoId=${encodeURIComponent(videoId)}`}
                  className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:text-gray-900 dark:data-[focus]:text-white data-[focus]:outline-none"
                >
                  Mark Boundaries
                </Link>
              </MenuItem>
              <MenuItem>
                <Link
                  to={`/annotate/text?videoId=${encodeURIComponent(videoId)}`}
                  className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:text-gray-900 dark:data-[focus]:text-white data-[focus]:outline-none"
                >
                  Annotate Text
                </Link>
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
  const [searchQuery, setSearchQuery] = useState('')
  const CACHE_VERSION = 'v2' // Increment to invalidate cache when VideoStats structure changes
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

  // Save stats to localStorage whenever they update
  useEffect(() => {
    if (videoStatsMap.size > 0 && typeof window !== 'undefined') {
      const cacheObj = Object.fromEntries(videoStatsMap.entries())
      localStorage.setItem(`video-stats-cache-${CACHE_VERSION}`, JSON.stringify(cacheObj))
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
        fetch(`/api/videos/${encodeURIComponent(videoId)}/stats`)
          .then(res => res.json())
          .then(data => updateVideoStats(videoId, data))
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
          {/* Legend */}
          <div className="mt-4 sm:mt-0 flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
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
      </div>
    </AppLayout>
  )
}
