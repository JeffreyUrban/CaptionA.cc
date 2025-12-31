/**
 * Global application state types for Zustand store
 */

// ============================================================================
// Upload Types
// ============================================================================

export type UploadStatus = 'pending' | 'uploading' | 'completed' | 'failed' | 'cancelled'

/**
 * Metadata for a single file upload (persisted to localStorage)
 */
export interface UploadMetadata {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  targetFolder: string | null
  relativePath: string // For folder uploads

  // TUS resume data
  uploadUrl: string | null // TUS upload URL for resume
  bytesUploaded: number
  progress: number // 0-100

  // Status
  status: UploadStatus
  error: string | null

  // Timestamps
  createdAt: number
  startedAt: number | null
  completedAt: number | null
}

// ============================================================================
// Video Pipeline Types
// ============================================================================

export type PipelineStage =
  | 'upload'
  | 'full_frames'
  | 'crop_frames'
  | 'layout_analysis'
  | 'ocr'
  | 'caption_extraction'
  | 'complete'

export type PipelineStageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface PipelineStatus {
  stage: PipelineStage
  status: PipelineStageStatus
  progress: number // 0-100
  error: string | null
  startedAt: number | null
  completedAt: number | null
}

/**
 * Complete video processing state
 */
export interface VideoState {
  videoId: string
  displayPath: string

  // Pipeline tracking
  currentStage: PipelineStage
  stages: Record<PipelineStage, PipelineStatus>

  // Metadata
  totalFrames: number | null
  hasOcrData: boolean
  layoutApproved: boolean

  // Overall status
  isProcessing: boolean
  lastUpdated: number
}

// ============================================================================
// User Preferences Types
// ============================================================================

export interface UserPreferences {
  // Theme
  theme: 'light' | 'dark' | 'system'

  // Upload preferences
  defaultUploadFolder: string | null
  maxConcurrentUploads: number
  autoResumeUploads: boolean

  // Notification preferences
  showUploadNotifications: boolean
  showPipelineNotifications: boolean
}

// ============================================================================
// Store State & Actions
// ============================================================================

export interface AppState {
  // Upload state
  uploads: Record<string, UploadMetadata>
  activeUploadIds: string[]

  // Video pipeline state
  videos: Record<string, VideoState>

  // User preferences
  preferences: UserPreferences

  // Upload actions
  addUpload: (upload: UploadMetadata) => void
  updateUploadProgress: (id: string, bytesUploaded: number, progress: number) => void
  updateUploadStatus: (id: string, status: UploadStatus, error?: string) => void
  setUploadUrl: (id: string, uploadUrl: string) => void
  removeUpload: (id: string) => void
  clearCompletedUploads: () => void

  // Video pipeline actions
  setVideoState: (videoId: string, state: VideoState) => void
  updatePipelineStage: (
    videoId: string,
    stage: PipelineStage,
    status: PipelineStageStatus,
    progress?: number,
    error?: string
  ) => void
  removeVideo: (videoId: string) => void

  // Preference actions
  updatePreferences: (preferences: Partial<UserPreferences>) => void

  // Utility actions
  reset: () => void
}

// ============================================================================
// Persisted State (what gets saved to localStorage)
// ============================================================================

export interface PersistedState {
  uploads: Record<string, UploadMetadata>
  videos: Record<string, VideoState>
  preferences: UserPreferences
}
