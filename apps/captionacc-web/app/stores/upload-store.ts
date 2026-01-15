/**
 * Upload Store - Manages video upload state with sessionStorage persistence
 *
 * This store tracks:
 * - Active uploads (in progress or pending)
 * - Pending duplicates (awaiting user resolution)
 * - Completed uploads (upload history for current session)
 * - Notification state (for header badge)
 *
 * Persistence:
 * - Uses sessionStorage (survives navigation, cleared on refresh)
 * - No polling - pure Zustand subscriptions
 * - Decoupled from UI components
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import { uploadManager } from '~/services/upload-manager'

// ============================================================================
// Types
// ============================================================================

export interface ActiveUpload {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  relativePath: string
  targetFolder: string | null

  uploadUrl: string | null
  bytesUploaded: number
  progress: number
  status: 'pending' | 'uploading' | 'error'
  error: string | null

  createdAt: number
  startedAt: number | null
}

export interface PendingDuplicate {
  id: string
  fileName: string
  relativePath: string
  videoId: string
  duplicateOfVideoId: string
  duplicateOfDisplayPath: string
  createdAt: number
}

export interface CompletedUpload {
  id: string
  fileName: string
  relativePath: string
  videoId: string
  completedAt: number
}

export interface UploadNotification {
  show: boolean
  dismissed: boolean
  hasActiveUploads: boolean
  hasPendingDuplicates: boolean
  activeCount: number
  completedCount: number
  totalCount: number
  progress: number
}

export interface UploadStore {
  // State
  activeUploads: Record<string, ActiveUpload>
  pendingDuplicates: Record<string, PendingDuplicate>
  completedUploads: CompletedUpload[]
  notification: UploadNotification

  // Upload lifecycle
  addUpload: (
    upload: Omit<
      ActiveUpload,
      | 'id'
      | 'createdAt'
      | 'startedAt'
      | 'uploadUrl'
      | 'bytesUploaded'
      | 'progress'
      | 'status'
      | 'error'
    >
  ) => string
  updateProgress: (id: string, bytesUploaded: number, progress: number) => void
  updateStatus: (id: string, status: ActiveUpload['status'], error?: string) => void
  setUploadUrl: (id: string, uploadUrl: string) => void
  removeUpload: (id: string) => void

  // Duplicate handling
  markAsDuplicate: (
    id: string,
    videoId: string,
    duplicateOfVideoId: string,
    duplicateOfDisplayPath: string
  ) => void
  resolveDuplicate: (id: string) => void

  // Upload completion
  completeUpload: (id: string, videoId: string) => void

  // Bulk actions
  abortAll: () => void
  cancelQueued: () => void
  clearHistory: () => void

  // Notification
  dismissNotification: () => void
  visitedUploadPage: () => void

  // Computed
  totalProgress: () => { completed: number; total: number; percent: number }
  hasActiveUploads: () => boolean
  hasPendingDuplicates: () => boolean
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate notification state from current store state
 */
function calculateNotification(
  activeUploads: Record<string, ActiveUpload>,
  pendingDuplicates: Record<string, PendingDuplicate>,
  completedUploads: CompletedUpload[],
  dismissed: boolean
): UploadNotification {
  const activeCount = Object.keys(activeUploads).length
  const pendingDuplicatesCount = Object.keys(pendingDuplicates).length
  const completedCount = completedUploads.length
  const totalCount = activeCount + pendingDuplicatesCount + completedCount

  // Calculate overall progress
  let totalBytes = 0
  let uploadedBytes = 0
  Object.values(activeUploads).forEach(upload => {
    totalBytes += upload.fileSize
    uploadedBytes += upload.bytesUploaded
  })
  const progress = totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0

  const hasActiveUploads = activeCount > 0
  const hasPendingDuplicates = pendingDuplicatesCount > 0

  // Show notification if has active uploads or pending duplicates, and not dismissed
  const show = (hasActiveUploads || hasPendingDuplicates) && !dismissed

  return {
    show,
    dismissed,
    hasActiveUploads,
    hasPendingDuplicates,
    activeCount,
    completedCount,
    totalCount,
    progress,
  }
}

// ============================================================================
// Initial State
// ============================================================================

const initialNotification: UploadNotification = {
  show: false,
  dismissed: false,
  hasActiveUploads: false,
  hasPendingDuplicates: false,
  activeCount: 0,
  completedCount: 0,
  totalCount: 0,
  progress: 0,
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useUploadStore = create<UploadStore>()(
  persist(
    // eslint-disable-next-line max-lines-per-function -- Zustand store pattern combines all upload state management and actions in single creator function
    (set, get) => ({
      // Initial state
      activeUploads: {},
      pendingDuplicates: {},
      completedUploads: [],
      notification: initialNotification,

      // Upload lifecycle
      addUpload: upload => {
        const id = crypto.randomUUID()
        const now = Date.now()

        set(state => {
          const newActiveUploads = {
            ...state.activeUploads,
            [id]: {
              ...upload,
              id,
              uploadUrl: null,
              bytesUploaded: 0,
              progress: 0,
              status: 'pending' as const,
              error: null,
              createdAt: now,
              startedAt: null,
            },
          }

          return {
            activeUploads: newActiveUploads,
            notification: calculateNotification(
              newActiveUploads,
              state.pendingDuplicates,
              state.completedUploads,
              state.notification.dismissed
            ),
          }
        })

        return id
      },

      updateProgress: (id, bytesUploaded, progress) => {
        set(state => {
          const upload = state.activeUploads[id]
          if (!upload) return state

          const newActiveUploads = {
            ...state.activeUploads,
            [id]: {
              ...upload,
              bytesUploaded,
              progress,
              status: 'uploading' as const,
              startedAt: upload.startedAt ?? Date.now(),
            },
          }

          return {
            activeUploads: newActiveUploads,
            notification: calculateNotification(
              newActiveUploads,
              state.pendingDuplicates,
              state.completedUploads,
              state.notification.dismissed
            ),
          }
        })
      },

      updateStatus: (id, status, error) => {
        set(state => {
          const upload = state.activeUploads[id]
          if (!upload) return state

          const newActiveUploads = {
            ...state.activeUploads,
            [id]: {
              ...upload,
              status,
              error: error ?? null,
            },
          }

          return {
            activeUploads: newActiveUploads,
            notification: calculateNotification(
              newActiveUploads,
              state.pendingDuplicates,
              state.completedUploads,
              state.notification.dismissed
            ),
          }
        })
      },

      setUploadUrl: (id, uploadUrl) => {
        set(state => {
          const upload = state.activeUploads[id]
          if (!upload) return state

          return {
            activeUploads: {
              ...state.activeUploads,
              [id]: {
                ...upload,
                uploadUrl,
              },
            },
          }
        })
      },

      removeUpload: id => {
        set(state => {
          const { [id]: _removed, ...remaining } = state.activeUploads

          return {
            activeUploads: remaining,
            notification: calculateNotification(
              remaining,
              state.pendingDuplicates,
              state.completedUploads,
              state.notification.dismissed
            ),
          }
        })
      },

      // Duplicate handling
      markAsDuplicate: (id, videoId, duplicateOfVideoId, duplicateOfDisplayPath) => {
        set(state => {
          const upload = state.activeUploads[id]
          if (!upload) return state

          const { [id]: _removed, ...remainingActive } = state.activeUploads
          const newPendingDuplicates = {
            ...state.pendingDuplicates,
            [id]: {
              id,
              fileName: upload.fileName,
              relativePath: upload.relativePath,
              videoId,
              duplicateOfVideoId,
              duplicateOfDisplayPath,
              createdAt: Date.now(),
            },
          }

          return {
            activeUploads: remainingActive,
            pendingDuplicates: newPendingDuplicates,
            notification: calculateNotification(
              remainingActive,
              newPendingDuplicates,
              state.completedUploads,
              state.notification.dismissed
            ),
          }
        })
      },

      resolveDuplicate: id => {
        set(state => {
          const { [id]: _removed, ...remaining } = state.pendingDuplicates

          return {
            pendingDuplicates: remaining,
            notification: calculateNotification(
              state.activeUploads,
              remaining,
              state.completedUploads,
              state.notification.dismissed
            ),
          }
        })
      },

      // Upload completion
      completeUpload: (id, videoId) => {
        set(state => {
          const upload = state.activeUploads[id]
          if (!upload) return state

          const { [id]: _removed, ...remainingActive } = state.activeUploads
          const newCompletedUploads = [
            ...state.completedUploads,
            {
              id,
              fileName: upload.fileName,
              relativePath: upload.relativePath,
              videoId,
              completedAt: Date.now(),
            },
          ]

          return {
            activeUploads: remainingActive,
            completedUploads: newCompletedUploads,
            notification: calculateNotification(
              remainingActive,
              state.pendingDuplicates,
              newCompletedUploads,
              state.notification.dismissed
            ),
          }
        })
      },

      // Bulk actions
      abortAll: () => {
        const state = get()

        // Cancel all active uploads via upload manager
        Object.keys(state.activeUploads).forEach(id => {
          void uploadManager.cancelUpload(id)
        })

        set({
          activeUploads: {},
          pendingDuplicates: {},
          completedUploads: [],
          notification: initialNotification,
        })
      },

      cancelQueued: () => {
        const state = get()

        // Cancel pending uploads (not yet started)
        Object.entries(state.activeUploads).forEach(([id, upload]) => {
          if (upload.status === 'pending') {
            void uploadManager.cancelUpload(id)
          }
        })

        set(state => {
          const newActiveUploads = Object.fromEntries(
            Object.entries(state.activeUploads).filter(([_, upload]) => upload.status !== 'pending')
          )

          return {
            activeUploads: newActiveUploads,
            notification: calculateNotification(
              newActiveUploads,
              state.pendingDuplicates,
              state.completedUploads,
              state.notification.dismissed
            ),
          }
        })
      },

      clearHistory: () => {
        set(state => ({
          completedUploads: [],
          notification: calculateNotification(
            state.activeUploads,
            state.pendingDuplicates,
            [],
            state.notification.dismissed
          ),
        }))
      },

      // Notification
      dismissNotification: () => {
        set(state => ({
          notification: {
            ...state.notification,
            show: false,
            dismissed: true,
          },
        }))
      },

      visitedUploadPage: () => {
        set(state => ({
          notification: {
            ...state.notification,
            show: false,
            dismissed: false, // Reset dismissed flag when visiting upload page
          },
        }))
      },

      // Computed
      totalProgress: () => {
        const state = get()
        const completed = state.completedUploads.length
        const total = Object.keys(state.activeUploads).length + completed
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0

        return { completed, total, percent }
      },

      hasActiveUploads: () => {
        return Object.keys(get().activeUploads).length > 0
      },

      hasPendingDuplicates: () => {
        return Object.keys(get().pendingDuplicates).length > 0
      },
    }),
    {
      name: 'upload-store',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
)
