/**
 * Global application state store using Zustand
 *
 * This store manages:
 * - Upload state and progress (persisted for resume capability)
 * - Video pipeline processing state
 * - User preferences
 *
 * State is persisted to localStorage (except non-serializable objects like TUS instances)
 */

import { create } from 'zustand'
import { devtools, persist, createJSONStorage } from 'zustand/middleware'

import type {
  AppState,
  UploadMetadata,
  UploadStatus,
  VideoState,
  PipelineStage,
  PipelineStageStatus,
  UserPreferences,
  PersistedState,
} from '~/types/store'

// ============================================================================
// Default Values
// ============================================================================

const defaultPreferences: UserPreferences = {
  theme: 'system',
  defaultUploadFolder: null,
  maxConcurrentUploads: 5,
  autoResumeUploads: true,
  showUploadNotifications: true,
  showPipelineNotifications: true,
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      set => ({
        // Initial state
        uploads: {},
        activeUploadIds: [],
        videos: {},
        preferences: defaultPreferences,

        // ====================================================================
        // Upload Actions
        // ====================================================================

        addUpload: (upload: UploadMetadata) =>
          set(
            state => ({
              uploads: {
                ...state.uploads,
                [upload.id]: upload,
              },
              activeUploadIds: [...state.activeUploadIds, upload.id],
            }),
            false,
            'addUpload'
          ),

        updateUploadProgress: (id: string, bytesUploaded: number, progress: number) =>
          set(
            state => {
              const upload = state.uploads[id]
              if (!upload) return state

              return {
                uploads: {
                  ...state.uploads,
                  [id]: {
                    ...upload,
                    bytesUploaded,
                    progress,
                  },
                },
              }
            },
            false,
            'updateUploadProgress'
          ),

        updateUploadStatus: (id: string, status: UploadStatus, error?: string) =>
          set(
            state => {
              const upload = state.uploads[id]
              if (!upload) return state

              const now = Date.now()
              const updates: Partial<UploadMetadata> = {
                status,
                error: error ?? null,
              }

              if (status === 'uploading' && !upload.startedAt) {
                updates.startedAt = now
              }

              if (status === 'completed' || status === 'failed' || status === 'cancelled') {
                updates.completedAt = now
              }

              return {
                uploads: {
                  ...state.uploads,
                  [id]: {
                    ...upload,
                    ...updates,
                  },
                },
                // Remove from active list if completed/failed/cancelled
                activeUploadIds:
                  status === 'completed' || status === 'failed' || status === 'cancelled'
                    ? state.activeUploadIds.filter(uploadId => uploadId !== id)
                    : state.activeUploadIds,
              }
            },
            false,
            'updateUploadStatus'
          ),

        setUploadUrl: (id: string, uploadUrl: string) =>
          set(
            state => {
              const upload = state.uploads[id]
              if (!upload) return state

              return {
                uploads: {
                  ...state.uploads,
                  [id]: {
                    ...upload,
                    uploadUrl,
                  },
                },
              }
            },
            false,
            'setUploadUrl'
          ),

        removeUpload: (id: string) =>
          set(
            state => {
              const { [id]: _removed, ...remainingUploads } = state.uploads
              return {
                uploads: remainingUploads,
                activeUploadIds: state.activeUploadIds.filter(uploadId => uploadId !== id),
              }
            },
            false,
            'removeUpload'
          ),

        clearCompletedUploads: () =>
          set(
            state => {
              const uploads: Record<string, UploadMetadata> = {}
              for (const [id, upload] of Object.entries(state.uploads)) {
                if (upload.status !== 'completed') {
                  uploads[id] = upload
                }
              }
              return { uploads }
            },
            false,
            'clearCompletedUploads'
          ),

        // ====================================================================
        // Video Pipeline Actions
        // ====================================================================

        setVideoState: (videoId: string, videoState: VideoState) =>
          set(
            state => ({
              videos: {
                ...state.videos,
                [videoId]: {
                  ...videoState,
                  lastUpdated: Date.now(),
                },
              },
            }),
            false,
            'setVideoState'
          ),

        updatePipelineStage: (
          videoId: string,
          stage: PipelineStage,
          status: PipelineStageStatus,
          progress?: number,
          error?: string
        ) =>
          set(
            state => {
              const video = state.videos[videoId]
              if (!video) return state

              const now = Date.now()
              const stageStatus = video.stages[stage]

              return {
                videos: {
                  ...state.videos,
                  [videoId]: {
                    ...video,
                    currentStage: stage,
                    stages: {
                      ...video.stages,
                      [stage]: {
                        ...stageStatus,
                        status,
                        progress: progress ?? stageStatus.progress,
                        error: error ?? null,
                        startedAt:
                          status === 'running' && !stageStatus.startedAt
                            ? now
                            : stageStatus.startedAt,
                        completedAt: status === 'completed' || status === 'failed' ? now : null,
                      },
                    },
                    isProcessing: status === 'running',
                    lastUpdated: now,
                  },
                },
              }
            },
            false,
            'updatePipelineStage'
          ),

        removeVideo: (videoId: string) =>
          set(
            state => {
              const { [videoId]: _removed, ...remainingVideos } = state.videos
              return { videos: remainingVideos }
            },
            false,
            'removeVideo'
          ),

        // ====================================================================
        // Preference Actions
        // ====================================================================

        updatePreferences: (preferences: Partial<UserPreferences>) =>
          set(
            state => ({
              preferences: {
                ...state.preferences,
                ...preferences,
              },
            }),
            false,
            'updatePreferences'
          ),

        // ====================================================================
        // Utility Actions
        // ====================================================================

        reset: () =>
          set(
            {
              uploads: {},
              activeUploadIds: [],
              videos: {},
              preferences: defaultPreferences,
            },
            false,
            'reset'
          ),
      }),
      {
        name: 'captionacc-storage', // localStorage key
        storage: createJSONStorage(() => localStorage),
        // Only persist these fields (exclude non-serializable data)
        partialize: (state): PersistedState => ({
          uploads: state.uploads,
          videos: state.videos,
          preferences: state.preferences,
        }),
      }
    ),
    {
      name: 'CaptionA.cc Store', // DevTools name
      enabled: process.env['NODE_ENV'] === 'development',
    }
  )
)

// ============================================================================
// Selectors (for optimized subscriptions)
// ============================================================================

/**
 * Get all active uploads (uploading or pending)
 */
export const selectActiveUploads = (state: AppState): UploadMetadata[] => {
  return state.activeUploadIds
    .map(id => state.uploads[id])
    .filter((u): u is UploadMetadata => u !== undefined)
}

/**
 * Get incomplete uploads (for resume detection)
 */
export const selectIncompleteUploads = (state: AppState): UploadMetadata[] => {
  return Object.values(state.uploads).filter(
    upload =>
      (upload.status === 'uploading' || upload.status === 'pending') && upload.uploadUrl !== null
  )
}

/**
 * Get upload by ID
 */
export const selectUpload = (id: string) => (state: AppState) => state.uploads[id]

/**
 * Get video state by ID
 */
export const selectVideo = (videoId: string) => (state: AppState) => state.videos[videoId]

/**
 * Get all videos currently processing
 */
export const selectProcessingVideos = (state: AppState): VideoState[] => {
  return Object.values(state.videos).filter(video => video.isProcessing)
}

/**
 * Count active background operations (uploads + processing)
 */
export const selectActiveOperationCount = (state: AppState): number => {
  const activeUploads = state.activeUploadIds.length
  const processingVideos = Object.values(state.videos).filter(v => v.isProcessing).length
  return activeUploads + processingVideos
}
