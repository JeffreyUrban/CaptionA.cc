/**
 * Type definitions for the Videos page.
 * These types are used across hooks and components for the video list view.
 */

import type { BadgeState } from '~/utils/video-stats'

// =============================================================================
// Folders Metadata
// =============================================================================

/** Metadata stored in .folders.json */
export interface FoldersMetadata {
  emptyFolders: string[]
}

// =============================================================================
// Modal States
// =============================================================================

/** Modal state for creating folders */
export interface CreateFolderModalState {
  open: boolean
  parentPath?: string
}

/** Modal state for renaming folders */
export interface RenameFolderModalState {
  open: boolean
  folderPath?: string
  currentName?: string
}

/** Modal state for deleting folders */
export interface DeleteFolderModalState {
  open: boolean
  folderPath?: string
  folderName?: string
  videoCount?: number
}

/** Modal state for renaming videos */
export interface RenameVideoModalState {
  open: boolean
  videoPath?: string
  currentName?: string
}

/** Modal state for deleting videos */
export interface DeleteVideoModalState {
  open: boolean
  videoPath?: string
  videoName?: string
}

/** Modal state for error details */
export interface ErrorModalState {
  open: boolean
  errorDetails?: BadgeState['errorDetails']
  videoId?: string
}

/** Modal state for moving items */
export interface MoveModalState {
  open: boolean
  itemPath?: string
  itemName?: string
  itemType?: 'video' | 'folder'
}

// =============================================================================
// Drag and Drop
// =============================================================================

/** Dragged item state */
export interface DraggedItemState {
  path: string
  name: string
  type: 'video' | 'folder'
}

// =============================================================================
// Folder Operations
// =============================================================================

/** Folder item for folder picker */
export interface FolderItem {
  path: string
  name: string
}

// =============================================================================
// Initial States
// =============================================================================

/** Initial state for create folder modal */
export const INITIAL_CREATE_FOLDER_MODAL: CreateFolderModalState = { open: false }

/** Initial state for rename folder modal */
export const INITIAL_RENAME_FOLDER_MODAL: RenameFolderModalState = { open: false }

/** Initial state for delete folder modal */
export const INITIAL_DELETE_FOLDER_MODAL: DeleteFolderModalState = { open: false }

/** Initial state for rename video modal */
export const INITIAL_RENAME_VIDEO_MODAL: RenameVideoModalState = { open: false }

/** Initial state for delete video modal */
export const INITIAL_DELETE_VIDEO_MODAL: DeleteVideoModalState = { open: false }

/** Initial state for error modal */
export const INITIAL_ERROR_MODAL: ErrorModalState = { open: false }

/** Initial state for move modal */
export const INITIAL_MOVE_MODAL: MoveModalState = { open: false }
