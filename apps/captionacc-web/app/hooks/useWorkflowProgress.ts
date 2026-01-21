import { useState, useCallback, useEffect } from 'react'

interface WorkflowProgress {
  progress_percent: number
  completed_frames: number
}

interface UseWorkflowProgressResult {
  workflowProgress: number
  completedFrames: number
  updateProgress: () => Promise<void>
  loading: boolean
}

/**
 * Manages workflow progress for boundary annotation.
 * Loads progress on mount and provides an updateProgress function.
 *
 * @param videoId - The ID of the video
 * @returns Object containing progress state and update function
 */
export function useWorkflowProgress(videoId: string | null | undefined): UseWorkflowProgressResult {
  const [workflowProgress, setWorkflowProgress] = useState(0)
  const [completedFrames, setCompletedFrames] = useState(0)
  const [loading, setLoading] = useState(true)

  const updateProgress = useCallback(async () => {
    if (!videoId) return

    try {
      const encodedVideoId = encodeURIComponent(videoId)
      const response = await fetch(`/videos/${encodedVideoId}/progress`)
      const data: WorkflowProgress = await response.json()

      setWorkflowProgress(data.progress_percent ?? 0)
      setCompletedFrames(data.completed_frames ?? 0)
    } catch (error) {
      console.error('Failed to update progress:', error)
    }
  }, [videoId])

  // Load initial progress
  useEffect(() => {
    if (!videoId) {
      setLoading(false)
      return
    }

    const loadProgress = async () => {
      await updateProgress()
      setLoading(false)
    }

    void loadProgress()
  }, [videoId, updateProgress])

  return { workflowProgress, completedFrames, updateProgress, loading }
}
