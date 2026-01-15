/**
 * Videos page - Lists all videos with annotation statistics and progress.
 *
 * This component has been refactored for maintainability:
 * - Business logic extracted to hooks in ~/hooks/
 * - Modal components extracted to ~/components/videos/VideoModals.tsx
 * - Table components extracted to ~/components/videos/VideoTable.tsx
 */

import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/20/solid'
import { useState, useMemo } from 'react'
import { useLoaderData, Link, useRevalidator, redirect } from 'react-router'

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
import { createServerSupabaseClient } from '~/services/supabase-client'
import {
  buildVideoTree,
  calculateVideoCounts,
  sortTreeNodes,
  type TreeNode,
  type VideoInfo,
} from '~/utils/video-tree'

// =============================================================================
// Loader
// =============================================================================

export async function loader() {
  const supabase = createServerSupabaseClient()

  // Get authenticated user
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (!user || error) {
    throw redirect('/auth/login')
  }

  // Query videos table - RLS automatically filters by tenant/user
  const { data: videos, error: videosError } = await supabase
    .from('videos')
    .select('id, filename, display_path, status, uploaded_at, is_demo')
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false })

  if (videosError) {
    console.error('Failed to fetch videos:', videosError)
    return { tree: [] }
  }

  // Transform to VideoInfo format expected by tree builder
  const videoList: VideoInfo[] =
    videos?.map(v => ({
      videoId: v.id,
      displayPath: v.display_path ?? v.filename ?? v.id,
      isDemo: v.is_demo ?? false,
    })) ?? []

  // Build tree structure from videos only (without stats - will be loaded client-side)
  const tree = buildVideoTree(videoList)

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
        <h1 className="text-base font-semibold text-olive-950 dark:text-white">Videos</h1>
        <p className="mt-2 text-sm text-olive-700 dark:text-olive-400">
          A list of all videos with annotation statistics and progress.
        </p>
      </div>
      <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex sm:items-center sm:gap-4">
        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-olive-700 dark:text-olive-400">
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
            className="inline-flex items-center gap-2 px-4 py-2 border border-olive-950/10 dark:border-white/10 text-sm font-medium rounded-md text-olive-950 dark:text-white bg-white dark:bg-olive-900 hover:bg-olive-950/5 dark:hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-olive-600"
          >
            <PlusIcon className="h-4 w-4" />
            New Folder
          </button>
          <Link
            to="/upload"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-olive-600 hover:bg-olive-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-olive-600 dark:bg-olive-400 dark:text-olive-950 dark:hover:bg-olive-300"
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
            className="h-5 w-5 text-olive-600 dark:text-olive-500"
            aria-hidden="true"
          />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          className="block w-full rounded-md border-0 py-1.5 pl-10 text-olive-950 dark:text-white dark:bg-olive-900 ring-1 ring-inset ring-olive-950/10 dark:ring-white/10 placeholder:text-olive-500 dark:placeholder:text-olive-600 focus:ring-2 focus:ring-inset focus:ring-olive-600 dark:focus:ring-olive-400 sm:text-sm"
          placeholder="Search videos..."
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={onExpandAll}
          className="px-3 py-1.5 text-sm font-medium text-olive-950 dark:text-white bg-white dark:bg-olive-900 border border-olive-950/10 dark:border-white/10 rounded-md hover:bg-olive-950/5 dark:hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-olive-600"
        >
          Expand All
        </button>
        <button
          onClick={onCollapseAll}
          className="px-3 py-1.5 text-sm font-medium text-olive-950 dark:text-white bg-white dark:bg-olive-900 border border-olive-950/10 dark:border-white/10 rounded-md hover:bg-olive-950/5 dark:hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-olive-600"
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

// Large videos page component with comprehensive UI sections - acceptable length for library view
/* eslint-disable max-lines-per-function */
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
