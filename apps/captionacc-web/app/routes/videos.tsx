/**
 * Videos page - Lists all videos with annotation statistics and progress.
 *
 * This component has been refactored for maintainability:
 * - Business logic extracted to hooks in ~/hooks/
 * - Modal components extracted to ~/components/videos/VideoModals.tsx
 * - Table components extracted to ~/components/videos/VideoTable.tsx
 */

import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/20/solid'
import { useState, useMemo } from 'react'
import { useLoaderData, Link, useRevalidator } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import {
  CreateFolderModal,
  RenameFolderModal,
  DeleteFolderModal,
  RenameVideoModal,
  DeleteVideoModal,
  ErrorDetailsModal,
  MoveItemModal,
  ErrorAlertModal,
} from '~/components/videos/VideoModals'
import { TableHeader, TreeRow, EmptyState } from '~/components/videos/VideoTable'
import { useFolderOperations } from '~/hooks/useFolderOperations'
import { useMoveOperation } from '~/hooks/useMoveOperation'
import { useTreeNavigation } from '~/hooks/useTreeNavigation'
import { useVideoDragDrop } from '~/hooks/useVideoDragDrop'
import { useVideoOperations } from '~/hooks/useVideoOperations'
import { useVideoStats } from '~/hooks/useVideoStats'
import type { FoldersMetadata } from '~/types/videos'
import { getAllVideos } from '~/utils/video-paths'
import {
  buildVideoTree,
  calculateVideoCounts,
  sortTreeNodes,
  type TreeNode,
  type FolderNode,
  type VideoInfo,
} from '~/utils/video-tree'

// =============================================================================
// Helper Functions - Server Side
// =============================================================================

function readEmptyFolders(dataDir: string): string[] {
  const foldersMetaPath = resolve(dataDir, '.folders.json')
  try {
    if (existsSync(foldersMetaPath)) {
      const content = readFileSync(foldersMetaPath, 'utf-8')
      const metadata: FoldersMetadata = JSON.parse(content)
      return metadata.emptyFolders ?? []
    }
  } catch {
    // If file doesn't exist or is invalid, return empty
  }
  return []
}

/**
 * Insert empty folders into the tree as FolderNodes
 */
function insertEmptyFolders(tree: TreeNode[], emptyFolders: string[]): TreeNode[] {
  for (const folderPath of emptyFolders) {
    const segments = folderPath.split('/')
    let currentLevel = tree
    // Navigate/create the folder structure
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      if (!segment) continue

      const path = segments.slice(0, i + 1).join('/')

      // Find existing node at this level
      let node = currentLevel.find(n => n.name === segment)

      if (!node) {
        // Create new folder node
        const folderNode: FolderNode = {
          type: 'folder',
          name: segment,
          path,
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
            layoutApproved: false,
            boundaryPendingReview: 0,
            textPendingReview: 0,
            badges: [],
          },
          videoCount: 0,
        }
        currentLevel.push(folderNode)
        node = folderNode
      }

      // Move to next level
      if (node.type === 'folder') {
        currentLevel = node.children
      }
    }
  }

  return tree
}

// =============================================================================
// Loader
// =============================================================================

export async function loader() {
  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')

  if (!existsSync(dataDir)) {
    return { tree: [] }
  }

  // Get all videos with their metadata (uses display_path)
  const allVideos = getAllVideos()

  // Convert to VideoInfo objects using display_path
  const videos: VideoInfo[] = allVideos.map(video => ({
    videoId: video.displayPath,
  }))

  // Build tree structure from videos only (without stats - will be loaded client-side)
  let tree = buildVideoTree(videos)

  // Get empty folders from metadata and insert them as proper FolderNodes
  const emptyFolders = readEmptyFolders(dataDir)
  tree = insertEmptyFolders(tree, emptyFolders)

  // Calculate video counts for each folder
  tree.forEach(node => {
    if (node.type === 'folder') {
      calculateVideoCounts(node)
    }
  })

  // Sort tree: folders first, then videos
  const sortedTree = sortTreeNodes(tree)

  return { tree: sortedTree }
}

// =============================================================================
// UI Components
// =============================================================================

/** Page header with title and action buttons */
function PageHeader({ onCreateFolder }: { onCreateFolder: () => void }) {
  return (
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
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-purple-700" />
            <span>Issue</span>
          </div>
        </div>
        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={onCreateFolder}
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
  )
}

/** Search input and expand/collapse controls */
function SearchControls({
  searchQuery,
  onSearchChange,
  onExpandAll,
  onCollapseAll,
}: {
  searchQuery: string
  onSearchChange: (query: string) => void
  onExpandAll: () => void
  onCollapseAll: () => void
}) {
  return (
    <div className="mt-8 flex gap-3">
      <div className="relative flex-1 rounded-md shadow-sm">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <MagnifyingGlassIcon
            className="h-5 w-5 text-gray-500 dark:text-gray-500"
            aria-hidden="true"
          />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          className="block w-full rounded-md border-0 py-1.5 pl-10 text-gray-900 dark:text-white dark:bg-gray-800 ring-1 ring-inset ring-gray-300 dark:ring-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-inset focus:ring-indigo-600 dark:focus:ring-indigo-500 sm:text-sm"
          placeholder="Search videos..."
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={onExpandAll}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Expand All
        </button>
        <button
          onClick={onCollapseAll}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Collapse All
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export default function VideosPage() {
  const { tree } = useLoaderData<{ tree: TreeNode[] }>()
  const revalidator = useRevalidator()
  const [searchQuery, setSearchQuery] = useState('')

  // Revalidation callback for all hooks
  const handleOperationComplete = () => {
    void revalidator.revalidate()
  }

  // Video stats hook
  const { videoStatsMap, isMounted, updateVideoStats, clearVideoStats } = useVideoStats({ tree })

  // Tree navigation hook
  const { expandedPaths, toggleExpand, expandAll, collapseAll } = useTreeNavigation({ tree })

  // Drag and drop hook
  const {
    draggedItem,
    dragOverFolder,
    dragDropErrorModal,
    closeDragDropErrorModal,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleRootDragOver,
    handleRootDragLeave,
    handleRootDrop,
    handleDrop,
  } = useVideoDragDrop({
    onMoveComplete: handleOperationComplete,
    clearVideoStats,
  })

  // Folder operations hook
  const {
    createFolderModal,
    renameFolderModal,
    deleteFolderModal,
    newFolderName,
    renamedFolderName,
    folderError,
    folderLoading,
    openCreateFolderModal,
    openRenameFolderModal,
    openDeleteFolderModal,
    closeCreateFolderModal,
    closeRenameFolderModal,
    closeDeleteFolderModal,
    setNewFolderName,
    setRenamedFolderName,
    handleCreateFolder,
    handleRenameFolder,
    handleDeleteFolder,
  } = useFolderOperations({ onOperationComplete: handleOperationComplete })

  // Video operations hook
  const {
    renameVideoModal,
    deleteVideoModal,
    errorModal,
    renamedVideoName,
    videoError,
    videoLoading,
    openRenameVideoModal,
    openDeleteVideoModal,
    openErrorModal,
    closeRenameVideoModal,
    closeDeleteVideoModal,
    closeErrorModal,
    setRenamedVideoName,
    handleRenameVideo,
    handleDeleteVideo,
  } = useVideoOperations({
    onOperationComplete: handleOperationComplete,
    clearVideoStats,
  })

  // Move operation hook
  const {
    moveModal,
    selectedTargetFolder,
    moveError,
    moveLoading,
    allFolders,
    openMoveVideoModal,
    openMoveFolderModal,
    closeMoveModal,
    setSelectedTargetFolder,
    handleMove,
  } = useMoveOperation({
    tree,
    onMoveComplete: handleOperationComplete,
    clearVideoStats,
  })

  // Filter tree based on search query
  const filteredTree = useMemo(() => {
    if (!searchQuery) return tree

    const query = searchQuery.toLowerCase()

    const filterNode = (node: TreeNode): TreeNode | null => {
      if (node.type === 'video') {
        // Check if video name or path matches
        const matches =
          node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)
        return matches ? node : null
      } else {
        // For folders, filter children and keep folder if any children match
        const filteredChildren = node.children
          .map(filterNode)
          .filter((n): n is TreeNode => n !== null)

        if (filteredChildren.length > 0) {
          return {
            ...node,
            children: filteredChildren,
          }
        }

        // Also match folder name
        const matches = node.name.toLowerCase().includes(query)
        return matches ? node : null
      }
    }

    return tree.map(filterNode).filter((n): n is TreeNode => n !== null)
  }, [tree, searchQuery])

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <AppLayout>
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader onCreateFolder={() => openCreateFolderModal()} />

        <SearchControls
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
        />

        {/* Table */}
        <div className="mt-8 flow-root">
          <div className="-mx-4 -my-2 sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full align-middle sm:px-6 lg:px-8">
              <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 dark:ring-white dark:ring-opacity-10 sm:rounded-lg">
                <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 25rem)' }}>
                  <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
                    <TableHeader
                      draggedItem={draggedItem}
                      dragOverFolder={dragOverFolder}
                      onRootDragOver={handleRootDragOver}
                      onRootDragLeave={handleRootDragLeave}
                      onRootDrop={handleRootDrop}
                    />
                    <tbody className="divide-y divide-y-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-950">
                      {filteredTree.map(node => (
                        <TreeRow
                          key={node.path}
                          node={node}
                          depth={0}
                          expandedPaths={expandedPaths}
                          onToggle={toggleExpand}
                          videoStatsMap={videoStatsMap}
                          onStatsUpdate={updateVideoStats}
                          isMounted={isMounted}
                          onCreateSubfolder={openCreateFolderModal}
                          onRenameFolder={openRenameFolderModal}
                          onMoveFolder={openMoveFolderModal}
                          onDeleteFolder={(path, name) => void openDeleteFolderModal(path, name)}
                          onRenameVideo={openRenameVideoModal}
                          onMoveVideo={openMoveVideoModal}
                          onDeleteVideo={openDeleteVideoModal}
                          onErrorBadgeClick={openErrorModal}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={(e, path) => void handleDrop(e, path)}
                          dragOverFolder={dragOverFolder}
                        />
                      ))}
                    </tbody>
                  </table>

                  {filteredTree.length === 0 && <EmptyState searchQuery={searchQuery} />}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modals */}
        <CreateFolderModal
          state={createFolderModal}
          onClose={closeCreateFolderModal}
          folderName={newFolderName}
          onFolderNameChange={setNewFolderName}
          error={folderError}
          loading={folderLoading}
          onSubmit={() => void handleCreateFolder()}
        />

        <RenameFolderModal
          state={renameFolderModal}
          onClose={closeRenameFolderModal}
          newName={renamedFolderName}
          onNewNameChange={setRenamedFolderName}
          error={folderError}
          loading={folderLoading}
          onSubmit={() => void handleRenameFolder()}
        />

        <DeleteFolderModal
          state={deleteFolderModal}
          onClose={closeDeleteFolderModal}
          error={folderError}
          loading={folderLoading}
          onSubmit={() => void handleDeleteFolder()}
        />

        <RenameVideoModal
          state={renameVideoModal}
          onClose={closeRenameVideoModal}
          newName={renamedVideoName}
          onNewNameChange={setRenamedVideoName}
          error={videoError}
          loading={videoLoading}
          onSubmit={() => void handleRenameVideo()}
        />

        <DeleteVideoModal
          state={deleteVideoModal}
          onClose={closeDeleteVideoModal}
          error={videoError}
          loading={videoLoading}
          onSubmit={() => void handleDeleteVideo()}
        />

        <ErrorDetailsModal state={errorModal} onClose={closeErrorModal} />

        <MoveItemModal
          state={moveModal}
          onClose={closeMoveModal}
          allFolders={allFolders}
          selectedFolder={selectedTargetFolder}
          onFolderSelect={setSelectedTargetFolder}
          error={moveError}
          loading={moveLoading}
          onSubmit={() => void handleMove()}
        />

        <ErrorAlertModal
          open={dragDropErrorModal.open}
          title={dragDropErrorModal.title}
          message={dragDropErrorModal.message}
          onClose={closeDragDropErrorModal}
        />
      </div>
    </AppLayout>
  )
}
