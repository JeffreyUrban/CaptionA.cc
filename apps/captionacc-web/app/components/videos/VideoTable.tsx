/**
 * Video table components for the Videos page.
 * Includes table header, tree rows, and all table-related UI components.
 */

import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ChevronRightIcon, ChevronDownIcon, EllipsisVerticalIcon } from '@heroicons/react/20/solid'
import { useState, useEffect } from 'react'
import { Link } from 'react-router'

import type { DraggedItemState } from '~/types/videos'
import { calculateBadges, calculateMenuActions, type BadgeState } from '~/utils/video-badges'
import type { TreeNode, FolderNode } from '~/utils/video-tree'

// =============================================================================
// Helper Functions
// =============================================================================

interface AggregatedStats {
  totalAnnotations: number
  confirmedAnnotations: number
  predictedAnnotations: number
  boundaryPendingCount: number
  textPendingCount: number
  totalFrames: number
  coveredFrames: number
  progress: number
}

/** Calculate aggregate stats for a folder from its children */
function calculateFolderStats(node: FolderNode): AggregatedStats | null {
  const collectVideoNodes = (n: TreeNode): TreeNode[] => {
    if (n.type === 'video') {
      return [n]
    } else {
      return n.children?.flatMap(collectVideoNodes) || []
    }
  }

  const videoNodes = collectVideoNodes(node)
  if (videoNodes.length === 0) return null

  const aggregated: AggregatedStats = {
    totalAnnotations: 0,
    confirmedAnnotations: 0,
    predictedAnnotations: 0,
    boundaryPendingCount: 0,
    textPendingCount: 0,
    totalFrames: 0,
    coveredFrames: 0,
    progress: 0,
  }

  for (const video of videoNodes) {
    aggregated.totalAnnotations += video.total_annotations || 0
    aggregated.confirmedAnnotations += video.confirmed_annotations || 0
    aggregated.predictedAnnotations += video.predicted_annotations || 0
    aggregated.boundaryPendingCount += video.boundary_pending_count || 0
    aggregated.textPendingCount += video.text_pending_count || 0
    aggregated.totalFrames += video.total_frames || 0
    aggregated.coveredFrames += video.covered_frames || 0
  }

  aggregated.progress =
    aggregated.totalFrames > 0
      ? Math.round((aggregated.coveredFrames / aggregated.totalFrames) * 100)
      : 0

  return aggregated
}

/** Get badge color classes for a given color name */
function getBadgeColorClasses(color: string): string {
  const defaultClasses = 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
  const colorMap: Record<string, string> = {
    blue: defaultClasses,
    indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    green: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    teal: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
    red: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    gray: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  }
  return colorMap[color] ?? defaultClasses
}

// =============================================================================
// Table Header
// =============================================================================

interface TableHeaderProps {
  draggedItem: DraggedItemState | null
  dragOverFolder: string | null
  onRootDragOver: (e: React.DragEvent) => void
  onRootDragLeave: (e: React.DragEvent) => void
  onRootDrop: (e: React.DragEvent) => Promise<void>
}

export function TableHeader({
  draggedItem,
  dragOverFolder,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
}: TableHeaderProps) {
  if (draggedItem) {
    const itemPathParts = draggedItem.path.split('/')
    const currentParent = itemPathParts.length > 1 ? itemPathParts.slice(0, -1).join('/') : ''
    const alreadyAtRoot = currentParent === ''

    return (
      <thead
        className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10"
        onDragOver={onRootDragOver}
        onDragLeave={onRootDragLeave}
        onDrop={e => void onRootDrop(e)}
      >
        <tr>
          <th
            colSpan={6}
            className={`py-6 px-6 text-center transition-colors ${
              dragOverFolder === '__ROOT__'
                ? 'bg-indigo-50 dark:bg-indigo-900/20 border-b-2 border-indigo-500'
                : 'bg-gray-50 dark:bg-gray-800 border-b-2 border-gray-300 dark:border-gray-600'
            }`}
          >
            <div
              className={`text-sm font-semibold ${
                dragOverFolder === '__ROOT__'
                  ? 'text-indigo-700 dark:text-indigo-300'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              {alreadyAtRoot
                ? `"${draggedItem.name}" is already at Root`
                : `Drop here to move "${draggedItem.name}" to Root`}
            </div>
          </th>
        </tr>
      </thead>
    )
  }

  return (
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
  )
}

// =============================================================================
// Empty State
// =============================================================================

interface EmptyStateProps {
  searchQuery: string
}

export function EmptyState({ searchQuery }: EmptyStateProps) {
  return (
    <div className="bg-white dark:bg-gray-950 text-center py-12">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {searchQuery ? 'No videos found matching your search.' : 'No videos available.'}
      </p>
    </div>
  )
}

// =============================================================================
// Stats Display Components
// =============================================================================

interface AnnotationDistributionBarProps {
  confirmed: number
  predicted: number
  pending: number
}

export function AnnotationDistributionBar({
  confirmed,
  predicted,
  pending,
}: AnnotationDistributionBarProps) {
  const total = confirmed + predicted + pending
  if (total <= 0) {
    return null
  }

  return (
    <div className="flex h-2 w-32 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
      {confirmed > 0 && (
        <div
          className="bg-teal-500"
          style={{ width: `${(confirmed / total) * 100}%` }}
          title={`${confirmed} confirmed`}
        />
      )}
      {predicted > 0 && (
        <div
          className="bg-indigo-500"
          style={{ width: `${(predicted / total) * 100}%` }}
          title={`${predicted} predicted`}
        />
      )}
      {pending > 0 && (
        <div
          className="bg-pink-500"
          style={{ width: `${(pending / total) * 100}%` }}
          title={`${pending} pending`}
        />
      )}
    </div>
  )
}

interface PendingBadgeProps {
  count: number
}

export function PendingBadge({ count }: PendingBadgeProps) {
  if (count > 0) {
    return (
      <span className="inline-flex items-center rounded-md bg-yellow-50 dark:bg-yellow-900/30 px-2 py-1 text-xs font-medium text-yellow-800 dark:text-yellow-400 ring-1 ring-inset ring-yellow-600/20 dark:ring-yellow-500/30">
        {count}
      </span>
    )
  }
  return null
}

interface ProgressBarProps {
  progress: number
}

export function ProgressBar({ progress }: ProgressBarProps) {
  // Round progress to integer for display
  const displayProgress = Math.round(progress)

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 bg-gray-300 dark:bg-gray-700 rounded-full h-2">
        <div
          className="bg-emerald-500 dark:bg-emerald-500 h-2 rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-xs">{displayProgress}%</span>
    </div>
  )
}

// =============================================================================
// TreeRow Component
// =============================================================================

interface TreeRowProps {
  node: TreeNode
  depth: number
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  onCreateSubfolder: (parentPath: string) => void
  onRenameFolder: (folderPath: string, currentName: string) => void
  onMoveFolder: (folderPath: string, folderName: string) => void
  onDeleteFolder: (folderPath: string, folderName: string, videoCount: number) => void
  onRenameVideo: (videoPath: string, currentName: string) => void
  onMoveVideo: (videoPath: string, videoName: string) => void
  onDeleteVideo: (videoId: string, videoName: string, videoPath: string) => void
  onErrorBadgeClick: (videoId: string, errorDetails: BadgeState['errorDetails']) => void
  onDragStart: (path: string, name: string, type: 'video' | 'folder') => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent, folderPath: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, targetFolderPath: string) => void
  dragOverFolder: string | null
  isMounted: boolean
}

export function TreeRow({
  node,
  depth,
  expandedPaths,
  onToggle,
  onCreateSubfolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onRenameVideo,
  onMoveVideo,
  onDeleteVideo,
  onErrorBadgeClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  dragOverFolder,
  isMounted,
}: TreeRowProps) {
  const isExpanded = expandedPaths.has(node.path)

  if (node.type === 'folder') {
    return (
      <FolderRow
        node={node as TreeNode & { type: 'folder' }}
        depth={depth}
        isExpanded={isExpanded}
        expandedPaths={expandedPaths}
        dragOverFolder={dragOverFolder}
        isMounted={isMounted}
        onToggle={onToggle}
        onCreateSubfolder={onCreateSubfolder}
        onRenameFolder={onRenameFolder}
        onMoveFolder={onMoveFolder}
        onDeleteFolder={onDeleteFolder}
        onRenameVideo={onRenameVideo}
        onMoveVideo={onMoveVideo}
        onDeleteVideo={onDeleteVideo}
        onErrorBadgeClick={onErrorBadgeClick}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />
    )
  }

  return (
    <VideoRow
      node={node}
      depth={depth}
      onRenameVideo={onRenameVideo}
      onMoveVideo={onMoveVideo}
      onDeleteVideo={onDeleteVideo}
      onErrorBadgeClick={onErrorBadgeClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    />
  )
}

// =============================================================================
// FolderRow Component
// =============================================================================

interface FolderRowProps {
  node: FolderNode
  depth: number
  isExpanded: boolean
  expandedPaths: Set<string>
  dragOverFolder: string | null
  isMounted: boolean
  onToggle: (path: string) => void
  onCreateSubfolder: (parentPath: string) => void
  onRenameFolder: (folderPath: string, currentName: string) => void
  onMoveFolder: (folderPath: string, folderName: string) => void
  onDeleteFolder: (folderPath: string, folderName: string, videoCount: number) => void
  onRenameVideo: (videoPath: string, currentName: string) => void
  onMoveVideo: (videoPath: string, videoName: string) => void
  onDeleteVideo: (videoId: string, videoName: string, videoPath: string) => void
  onErrorBadgeClick: (videoId: string, errorDetails: BadgeState['errorDetails']) => void
  onDragStart: (path: string, name: string, type: 'video' | 'folder') => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent, folderPath: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, targetFolderPath: string) => void
}

function FolderRow({
  node,
  depth,
  isExpanded,
  expandedPaths,
  dragOverFolder,
  isMounted,
  onToggle,
  onCreateSubfolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onRenameVideo,
  onMoveVideo,
  onDeleteVideo,
  onErrorBadgeClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: FolderRowProps) {
  const isDragOver = dragOverFolder === node.path
  const folderStats = calculateFolderStats(node)

  return (
    <>
      {/* Folder Row */}
      <tr
        draggable
        onDragStart={() => onDragStart(node.path, node.name, 'folder')}
        onDragEnd={onDragEnd}
        onDragOver={e => onDragOver(e, node.path)}
        onDragLeave={onDragLeave}
        onDrop={e => onDrop(e, node.path)}
        className={`bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 ${
          isDragOver
            ? 'outline outline-2 outline-offset-[-2px] outline-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 relative z-20'
            : ''
        }`}
        style={{ cursor: 'grab' }}
      >
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
            <span className="text-xs text-gray-500 dark:text-gray-500">
              ({node.videoCount} {node.videoCount === 1 ? 'video' : 'videos'})
            </span>
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 dark:text-gray-400">
          {folderStats ? folderStats.totalAnnotations : ''}
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 dark:text-gray-400">
          {folderStats && folderStats.totalAnnotations > 0 ? (
            <AnnotationDistributionBar
              confirmed={folderStats.confirmedAnnotations}
              predicted={folderStats.predictedAnnotations}
              pending={folderStats.boundaryPendingCount + folderStats.textPendingCount}
            />
          ) : (
            ''
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 dark:text-gray-400">
          {folderStats &&
          folderStats.boundaryPendingCount + folderStats.textPendingCount > 0 ? (
            <PendingBadge
              count={folderStats.boundaryPendingCount + folderStats.textPendingCount}
            />
          ) : (
            ''
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 dark:text-gray-400">
          {folderStats ? <ProgressBar progress={folderStats.progress} /> : ''}
        </td>
        <td className="relative whitespace-nowrap py-3 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
          <FolderActionsMenu
            node={node}
            onCreateSubfolder={onCreateSubfolder}
            onRenameFolder={onRenameFolder}
            onMoveFolder={onMoveFolder}
            onDeleteFolder={onDeleteFolder}
          />
        </td>
      </tr>

      {/* Render children if expanded */}
      {isExpanded &&
        node.children?.map(child => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expandedPaths={expandedPaths}
            onToggle={onToggle}
            onCreateSubfolder={onCreateSubfolder}
            isMounted={isMounted}
            onRenameFolder={onRenameFolder}
            onMoveFolder={onMoveFolder}
            onDeleteFolder={onDeleteFolder}
            onRenameVideo={onRenameVideo}
            onMoveVideo={onMoveVideo}
            onDeleteVideo={onDeleteVideo}
            onErrorBadgeClick={onErrorBadgeClick}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            dragOverFolder={dragOverFolder}
          />
        ))}
    </>
  )
}

// =============================================================================
// Folder Actions Menu
// =============================================================================

interface FolderActionsMenuProps {
  node: FolderNode
  onCreateSubfolder: (parentPath: string) => void
  onRenameFolder: (folderPath: string, currentName: string) => void
  onMoveFolder: (folderPath: string, folderName: string) => void
  onDeleteFolder: (folderPath: string, folderName: string, videoCount: number) => void
}

function FolderActionsMenu({
  node,
  onCreateSubfolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
}: FolderActionsMenuProps) {
  return (
    <Menu as="div" className="relative inline-block text-left">
      <MenuButton className="flex items-center rounded-full text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
        <span className="sr-only">Open folder options</span>
        <EllipsisVerticalIcon className="h-5 w-5" aria-hidden="true" />
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        className="z-50 mt-2 w-56 rounded-md bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10 focus:outline-none"
      >
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
            <Link
              to={`/upload?folder=${encodeURIComponent(node.path)}`}
              className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:text-gray-900 dark:data-[focus]:text-white data-[focus]:outline-none"
            >
              Upload to folder...
            </Link>
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
              onClick={() => onMoveFolder(node.path, node.name)}
              className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:text-gray-900 dark:data-[focus]:text-white data-[focus]:outline-none"
            >
              Move to...
            </button>
          </MenuItem>
          <MenuItem>
            <button
              onClick={() => onDeleteFolder(node.path, node.name, node.videoCount || 0)}
              className="block w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:outline-none"
            >
              Delete folder...
            </button>
          </MenuItem>
        </div>
      </MenuItems>
    </Menu>
  )
}

// =============================================================================
// VideoRow Component
// =============================================================================

interface VideoRowProps {
  node: TreeNode & { type: 'video' }
  depth: number
  onRenameVideo: (videoPath: string, currentName: string) => void
  onMoveVideo: (videoPath: string, videoName: string) => void
  onDeleteVideo: (videoId: string, videoName: string, videoPath: string) => void
  onErrorBadgeClick: (videoId: string, errorDetails: BadgeState['errorDetails']) => void
  onDragStart: (path: string, name: string, type: 'video' | 'folder') => void
  onDragEnd: () => void
}

function VideoRow({
  node,
  depth,
  onRenameVideo,
  onMoveVideo,
  onDeleteVideo,
  onErrorBadgeClick,
  onDragStart,
  onDragEnd,
}: VideoRowProps) {
  const videoId = node.videoId!

  return (
    <tr
      draggable
      onDragStart={() => onDragStart(videoId, node.name, 'video')}
      onDragEnd={onDragEnd}
      className="hover:bg-gray-100 dark:hover:bg-gray-800"
      style={{ cursor: 'grab' }}
    >
      <td
        className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 dark:text-gray-300 sm:pl-6"
        style={{ paddingLeft: `${depth * 1.5 + 1.5}rem` }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span>{node.name}</span>
          <VideoBadges node={node} onErrorBadgeClick={onErrorBadgeClick} />
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-400">
        {node.total_annotations || ''}
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-400">
        {node.total_annotations && node.total_annotations > 0 ? (
          <AnnotationDistributionBar
            confirmed={node.confirmed_annotations || 0}
            predicted={node.predicted_annotations || 0}
            pending={(node.boundary_pending_count || 0) + (node.text_pending_count || 0)}
          />
        ) : (
          ''
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-400">
        {(node.boundary_pending_count || 0) + (node.text_pending_count || 0) > 0 ? (
          <PendingBadge
            count={(node.boundary_pending_count || 0) + (node.text_pending_count || 0)}
          />
        ) : (
          ''
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-400">
        {node.total_frames && node.total_frames > 0 ? (
          <ProgressBar progress={((node.covered_frames || 0) / node.total_frames) * 100} />
        ) : (
          ''
        )}
      </td>
      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
        <VideoActionsMenu
          videoId={videoId}
          node={node}
          onRenameVideo={onRenameVideo}
          onMoveVideo={onMoveVideo}
          onDeleteVideo={onDeleteVideo}
        />
      </td>
    </tr>
  )
}

// =============================================================================
// Video Badges
// =============================================================================

interface VideoBadgesProps {
  node: TreeNode & { type: 'video' }
  onErrorBadgeClick: (videoId: string, errorDetails: BadgeState['errorDetails']) => void
}

function VideoBadges({ node, onErrorBadgeClick }: VideoBadgesProps) {
  // Calculate badges from video workflow data
  const badges = calculateBadges({
    id: node.videoId!,
    layout_status: node.layout_status || 'wait',
    boundaries_status: node.boundaries_status || 'wait',
    text_status: node.text_status || 'wait',
    layout_error_details: node.layout_error_details,
    boundaries_error_details: node.boundaries_error_details,
    text_error_details: node.text_error_details,
  })

  if (badges.length === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {badges.map((badge, index) => {
        const colorClasses = getBadgeColorClasses(badge.color)
        const baseClasses = `inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${colorClasses}`

        // Error badges - clickable, opens modal
        if (badge.type === 'error' && badge.clickable && badge.errorDetails) {
          return (
            <button
              key={index}
              onClick={() => onErrorBadgeClick(node.videoId!, badge.errorDetails)}
              className={`${baseClasses} hover:opacity-80 cursor-pointer transition-opacity`}
            >
              {badge.label}
            </button>
          )
        }

        // Navigation badges - clickable, opens link
        if (badge.clickable && badge.url) {
          return (
            <Link
              key={index}
              to={badge.url}
              className={`${baseClasses} hover:opacity-80 cursor-pointer transition-opacity`}
            >
              {badge.label}
            </Link>
          )
        }

        // Status badges - non-clickable
        return (
          <span key={index} className={baseClasses}>
            {badge.label}
          </span>
        )
      })}
    </div>
  )
}

// =============================================================================
// Video Actions Menu
// =============================================================================

interface VideoActionsMenuProps {
  videoId: string
  node: TreeNode & { type: 'video' }
  onRenameVideo: (videoPath: string, currentName: string) => void
  onMoveVideo: (videoPath: string, videoName: string) => void
  onDeleteVideo: (videoId: string, videoName: string, videoPath: string) => void
}

function VideoActionsMenu({
  videoId,
  node,
  onRenameVideo,
  onMoveVideo,
  onDeleteVideo,
}: VideoActionsMenuProps) {
  // Calculate menu actions from workflow data
  const menuActions = calculateMenuActions({
    id: videoId,
    layout_status: node.layout_status || 'wait',
    boundaries_status: node.boundaries_status || 'wait',
    text_status: node.text_status || 'wait',
    layout_error_details: node.layout_error_details,
    boundaries_error_details: node.boundaries_error_details,
    text_error_details: node.text_error_details,
  })

  return (
    <Menu as="div" className="relative inline-block text-left">
      <MenuButton className="flex items-center rounded-full text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
        <span className="sr-only">Open options</span>
        <EllipsisVerticalIcon className="h-5 w-5" aria-hidden="true" />
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        className="z-50 mt-2 w-56 rounded-md bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10 focus:outline-none"
      >
        <div className="py-1">
          {menuActions.map((action, index) => (
            <MenuItem key={index} disabled={!action.enabled}>
              {({ disabled }) =>
                disabled ? (
                  <span className="block px-4 py-2 text-sm text-gray-400 dark:text-gray-600 cursor-not-allowed">
                    {action.label}
                  </span>
                ) : (
                  <Link
                    to={action.url}
                    className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:text-gray-900 dark:data-[focus]:text-white data-[focus]:outline-none"
                  >
                    {action.label}
                  </Link>
                )
              }
            </MenuItem>
          ))}
          <MenuItem>
            <button
              onClick={() => onRenameVideo(node.videoId!, node.name)}
              className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:text-gray-900 dark:data-[focus]:text-white data-[focus]:outline-none"
            >
              Rename...
            </button>
          </MenuItem>
          <MenuItem>
            <button
              onClick={() => onMoveVideo(node.videoId!, node.name)}
              className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:text-gray-900 dark:data-[focus]:text-white data-[focus]:outline-none"
            >
              Move to...
            </button>
          </MenuItem>
          <MenuItem>
            <button
              onClick={() => onDeleteVideo(node.videoId!, node.name, node.path)}
              className="block w-full text-left px-4 py-2 text-sm text-red-700 dark:text-red-400 data-[focus]:bg-red-50 dark:data-[focus]:bg-red-900/20 data-[focus]:text-red-900 dark:data-[focus]:text-red-300 data-[focus]:outline-none"
            >
              Delete...
            </button>
          </MenuItem>
        </div>
      </MenuItems>
    </Menu>
  )
}
