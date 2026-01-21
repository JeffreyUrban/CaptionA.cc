import { useState, useEffect, useCallback } from 'react'

import type { TextQueueAnnotation, AnnotationData, PerFrameOCRItem } from '~/types/text-annotation'

interface UseTextAnnotationDataParams {
  videoId: string
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
}

/**
 * Custom hook for managing Text Annotation data fetching and state.
 */
export function useTextAnnotationData({
  videoId,
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

  // Load video metadata and queue
  useEffect(() => {
    if (!videoId) return
    void loadInitialData(
      videoId,
      setQueue,
      setCompletedAnnotations,
      setWorkflowProgress,
      setLoading,
      setError
    )
  }, [videoId])

  // Load current annotation
  useEffect(() => {
    if (!videoId || queue.length === 0 || queueIndex >= queue.length) return
    const currentItem = queue[queueIndex]
    if (!currentItem) return
    void loadAnnotation(
      videoId,
      currentItem.id,
      setCurrentAnnotation,
      setText,
      setTextStatus,
      setTextNotes,
      setLoading,
      setError
    )
  }, [videoId, queue, queueIndex])

  const updateProgress = useCallback(async () => {
    await refreshProgress(videoId, setCompletedAnnotations, setWorkflowProgress)
  }, [videoId])

  const moveToNext = useCallback(async () => {
    if (queueIndex < queue.length - 1) {
      setQueueIndex(queueIndex + 1)
    } else {
      const queueData = await fetchQueue(videoId)
      setQueue(queueData.annotations)
      setQueueIndex(0)
    }
  }, [videoId, queueIndex, queue.length])

  const handleSave = useCallback(async () => {
    if (!videoId || !currentAnnotation) return
    if (text.trim() === '') {
      setError('Caption text is empty. Use "Save Empty Caption" button to confirm no caption.')
      return
    }
    const success = await saveAnnotationText(
      videoId,
      currentAnnotation.annotation.id,
      text,
      textStatus,
      textNotes
    )
    if (success) {
      setError(null)
      await updateProgress()
      await moveToNext()
    } else {
      setError('Failed to save annotation')
    }
  }, [videoId, currentAnnotation, text, textStatus, textNotes, updateProgress, moveToNext])

  const handleSaveEmptyCaption = useCallback(async () => {
    if (!videoId || !currentAnnotation) return
    const success = await saveAnnotationText(
      videoId,
      currentAnnotation.annotation.id,
      '',
      textStatus,
      textNotes
    )
    if (success) {
      setError(null)
      await updateProgress()
      await moveToNext()
    } else {
      setError('Failed to save annotation')
    }
  }, [videoId, currentAnnotation, textStatus, textNotes, updateProgress, moveToNext])

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
    loading,
    error,
    setError,
    handleSave,
    handleSaveEmptyCaption,
    handleSkip,
    handlePrevious,
    jumpToAnnotation,
  }
}

// --- API Helper Functions ---

async function fetchQueue(videoId: string) {
  const response = await fetch(`/videos/${encodeURIComponent(videoId)}/text-queue`)
  return response.json()
}

async function loadInitialData(
  videoId: string,
  setQueue: (q: TextQueueAnnotation[]) => void,
  setCompletedAnnotations: (n: number) => void,
  setWorkflowProgress: (n: number) => void,
  setLoading: (b: boolean) => void,
  setError: (e: string | null) => void
) {
  try {
    const encodedVideoId = encodeURIComponent(videoId)
    await fetch(`/api/videos/${encodedVideoId}/metadata`)
    const queueData = await fetchQueue(videoId)
    setQueue(queueData.annotations)
    const total = queueData.total ?? queueData.annotations.length
    const completed = total - queueData.annotations.length
    setCompletedAnnotations(completed)
    setWorkflowProgress(total > 0 ? (completed / total) * 100 : 0)
    setLoading(false)
  } catch (err) {
    console.error('Failed to load metadata:', err)
    setError((err as Error).message)
    setLoading(false)
  }
}

async function loadAnnotation(
  videoId: string,
  annotationId: number,
  setCurrentAnnotation: (a: AnnotationData) => void,
  setText: (t: string) => void,
  setTextStatus: (s: string) => void,
  setTextNotes: (n: string) => void,
  setLoading: (b: boolean) => void,
  setError: (e: string | null) => void
) {
  setLoading(true)
  setError(null)
  try {
    const response = await fetch(
      `/videos/${encodeURIComponent(videoId)}/${annotationId}/text`
    )
    if (!response.ok) throw new Error('Failed to load annotation')
    const data = await response.json()
    setCurrentAnnotation(data)
    setText(data.annotation.text ?? data.annotation.text_ocr_combined ?? '')
    setTextStatus(data.annotation.text_status ?? 'valid_caption')
    setTextNotes(data.annotation.text_notes ?? '')
    setLoading(false)
  } catch (err) {
    setError((err as Error).message)
    setLoading(false)
  }
}

async function refreshProgress(
  videoId: string,
  setCompletedAnnotations: (n: number) => void,
  setWorkflowProgress: (n: number) => void
) {
  if (!videoId) return
  try {
    const queueData = await fetchQueue(videoId)
    const total = queueData.total ?? queueData.annotations.length
    const completed = total - queueData.annotations.length
    setCompletedAnnotations(completed)
    setWorkflowProgress(total > 0 ? (completed / total) * 100 : 0)
  } catch (err) {
    console.error('Failed to update progress:', err)
  }
}

async function saveAnnotationText(
  videoId: string,
  annotationId: number,
  text: string,
  textStatus: string,
  textNotes: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `/videos/${encodeURIComponent(videoId)}/${annotationId}/text`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, text_status: textStatus, text_notes: textNotes }),
      }
    )
    return response.ok
  } catch {
    return false
  }
}
