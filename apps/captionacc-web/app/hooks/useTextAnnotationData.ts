import { useState, useEffect, useCallback, useRef } from 'react'

import type { TextQueueAnnotation, AnnotationData, PerFrameOCRItem } from '~/types/text-annotation'
import { useCaptionsDatabase } from './useCaptionsDatabase'
import type {
  CaptionQueueResult,
  CaptionAnnotationData,
  TextStatus,
} from '~/services/database-queries'

interface UseTextAnnotationDataParams {
  videoId: string
  /** Tenant ID for database initialization */
  tenantId?: string
}

interface UseTextAnnotationDataReturn {
  queue: TextQueueAnnotation[]
  queueIndex: number
  setQueueIndex: (index: number) => void
  currentAnnotation: AnnotationData | null
  perFrameOCR: PerFrameOCRItem[]
  loadingFrames: boolean
  text: string
  setText: (text: string) => void
  textStatus: string
  setTextStatus: (status: string) => void
  textNotes: string
  setTextNotes: (notes: string) => void
  workflowProgress: number
  completedAnnotations: number
  loading: boolean
  error: string | null
  setError: (error: string | null) => void
  handleSave: () => Promise<void>
  handleSaveEmptyCaption: () => Promise<void>
  handleSkip: () => void
  handlePrevious: () => void
  jumpToAnnotation: (annotationId: string) => void
  // Lock status for UI
  canEdit: boolean
  isReady: boolean
}

/**
 * Convert database annotation to UI format.
 */
function toAnnotationData(dbAnnotation: CaptionAnnotationData, videoId: string): AnnotationData {
  return {
    annotation: {
      id: dbAnnotation.id,
      start_frame_index: dbAnnotation.start_frame_index,
      end_frame_index: dbAnnotation.end_frame_index,
      caption_frame_extents_state: dbAnnotation.caption_frame_extents_state,
      caption_frame_extents_pending: dbAnnotation.caption_frame_extents_pending,
      caption_frame_extents_updated_at: dbAnnotation.caption_frame_extents_updated_at ?? '',
      text: dbAnnotation.text,
      text_pending: dbAnnotation.text_pending,
      text_status: dbAnnotation.text_status,
      text_notes: dbAnnotation.text_notes,
      caption_ocr: dbAnnotation.caption_ocr,
      text_updated_at: dbAnnotation.text_updated_at,
      created_at: dbAnnotation.created_at,
    },
    // Build combined image URL - will be handled by S3 components
    combinedImageUrl: `/api/images/${encodeURIComponent(videoId)}/combined_caption_images/${dbAnnotation.id}.jpg`,
  }
}

/**
 * Convert database queue to UI format.
 */
function toTextQueueAnnotation(dbAnnotation: CaptionAnnotationData): TextQueueAnnotation {
  return {
    id: dbAnnotation.id,
    start_frame_index: dbAnnotation.start_frame_index,
    end_frame_index: dbAnnotation.end_frame_index,
    caption_frame_extents_state: dbAnnotation.caption_frame_extents_state,
    text: dbAnnotation.text,
    text_pending: dbAnnotation.text_pending,
    text_status: dbAnnotation.text_status,
    created_at: dbAnnotation.created_at,
  }
}

/**
 * Custom hook for managing Text Annotation data fetching and state.
 * Uses CR-SQLite local database with WebSocket sync.
 */
export function useTextAnnotationData({
  videoId,
  tenantId,
}: UseTextAnnotationDataParams): UseTextAnnotationDataReturn {
  const [queue, setQueue] = useState<TextQueueAnnotation[]>([])
  const [queueIndex, setQueueIndex] = useState(0)
  const [currentAnnotation, setCurrentAnnotation] = useState<AnnotationData | null>(null)
  const [text, setText] = useState('')
  const [textStatus, setTextStatus] = useState<string>('valid_caption')
  const [textNotes, setTextNotes] = useState('')
  const [perFrameOCR, _setPerFrameOCR] = useState<PerFrameOCRItem[]>([])
  const [loadingFrames, _setLoadingFrames] = useState(false)
  const [workflowProgress, setWorkflowProgress] = useState(0)
  const [completedAnnotations, setCompletedAnnotations] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Track if initial load has been done
  const initialLoadDoneRef = useRef(false)

  // Use the captions database hook
  const captionsDb = useCaptionsDatabase({
    videoId,
    tenantId,
    autoAcquireLock: true,
    onError: err => setError(err.message),
  })

  // Load initial data when database is ready
  useEffect(() => {
    if (!captionsDb.isReady || initialLoadDoneRef.current) return

    const loadInitialData = async () => {
      try {
        setLoading(true)
        setError(null)

        // Get text annotation queue from database
        const queueData = await captionsDb.getQueue()

        // Convert to UI format
        const uiQueue = queueData.annotations.map(a =>
          toTextQueueAnnotation(a as CaptionAnnotationData)
        )
        setQueue(uiQueue)

        // Set progress
        setCompletedAnnotations(queueData.completed)
        const progressPercent =
          queueData.total > 0 ? (queueData.completed / queueData.total) * 100 : 0
        setWorkflowProgress(progressPercent)

        initialLoadDoneRef.current = true
        setLoading(false)
      } catch (err) {
        console.error('Failed to load initial data:', err)
        setError((err as Error).message)
        setLoading(false)
      }
    }

    void loadInitialData()
  }, [captionsDb.isReady, captionsDb])

  // Load current annotation when queue index changes
  useEffect(() => {
    if (!captionsDb.isReady || queue.length === 0 || queueIndex >= queue.length) return

    const currentItem = queue[queueIndex]
    if (!currentItem) return

    const loadAnnotation = async () => {
      setLoading(true)
      setError(null)

      try {
        const annotation = await captionsDb.getAnnotation(currentItem.id)
        if (annotation) {
          const annotationData = toAnnotationData(annotation, videoId)
          setCurrentAnnotation(annotationData)
          setText(annotation.text ?? annotation.caption_ocr ?? '')
          setTextStatus(annotation.text_status ?? 'valid_caption')
          setTextNotes(annotation.text_notes ?? '')
        }
        setLoading(false)
      } catch (err) {
        setError((err as Error).message)
        setLoading(false)
      }
    }

    void loadAnnotation()
  }, [captionsDb.isReady, captionsDb, queue, queueIndex, videoId])

  const updateProgress = useCallback(async () => {
    if (!captionsDb.isReady) return

    try {
      const progress = await captionsDb.getTextProgress()
      setCompletedAnnotations(progress.completed)
      setWorkflowProgress(progress.progress)
    } catch (err) {
      console.error('Failed to update progress:', err)
    }
  }, [captionsDb])

  const moveToNext = useCallback(async () => {
    if (queueIndex < queue.length - 1) {
      setQueueIndex(queueIndex + 1)
    } else {
      // Refresh queue to get any new items
      if (!captionsDb.isReady) return

      try {
        const queueData = await captionsDb.getQueue()
        const uiQueue = queueData.annotations.map(a =>
          toTextQueueAnnotation(a as CaptionAnnotationData)
        )
        setQueue(uiQueue)
        setQueueIndex(0)
      } catch (err) {
        console.error('Failed to refresh queue:', err)
      }
    }
  }, [captionsDb, queueIndex, queue.length])

  const handleSave = useCallback(async () => {
    if (!captionsDb.isReady || !currentAnnotation) return

    if (text.trim() === '') {
      setError('Caption text is empty. Use "Save Empty Caption" button to confirm no caption.')
      return
    }

    try {
      await captionsDb.updateAnnotationText(
        currentAnnotation.annotation.id,
        text,
        textStatus as TextStatus,
        textNotes
      )
      setError(null)
      await updateProgress()
      await moveToNext()
    } catch (err) {
      setError('Failed to save annotation')
      console.error('Failed to save annotation:', err)
    }
  }, [captionsDb, currentAnnotation, text, textStatus, textNotes, updateProgress, moveToNext])

  const handleSaveEmptyCaption = useCallback(async () => {
    if (!captionsDb.isReady || !currentAnnotation) return

    try {
      await captionsDb.updateAnnotationText(
        currentAnnotation.annotation.id,
        '',
        textStatus as TextStatus,
        textNotes
      )
      setError(null)
      await updateProgress()
      await moveToNext()
    } catch (err) {
      setError('Failed to save annotation')
      console.error('Failed to save annotation:', err)
    }
  }, [captionsDb, currentAnnotation, textStatus, textNotes, updateProgress, moveToNext])

  const handleSkip = useCallback(() => {
    if (queueIndex < queue.length - 1) setQueueIndex(queueIndex + 1)
  }, [queueIndex, queue.length])

  const handlePrevious = useCallback(() => {
    if (queueIndex > 0) setQueueIndex(queueIndex - 1)
  }, [queueIndex])

  const jumpToAnnotation = useCallback(
    (input: string) => {
      const id = parseInt(input)
      if (isNaN(id) || id < 0) {
        alert('Invalid annotation ID')
        return
      }
      const index = queue.findIndex(a => a.id === id)
      if (index !== -1) setQueueIndex(index)
      else alert(`Annotation ${id} not found in current queue`)
    },
    [queue]
  )

  return {
    queue,
    queueIndex,
    setQueueIndex,
    currentAnnotation,
    perFrameOCR,
    loadingFrames,
    text,
    setText,
    textStatus,
    setTextStatus,
    textNotes,
    setTextNotes,
    workflowProgress,
    completedAnnotations,
    loading: loading || captionsDb.isLoading,
    error,
    setError,
    handleSave,
    handleSaveEmptyCaption,
    handleSkip,
    handlePrevious,
    jumpToAnnotation,
    // Expose lock status
    canEdit: captionsDb.canEdit,
    isReady: captionsDb.isReady,
  }
}
