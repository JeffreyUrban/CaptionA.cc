/**
 * Hook for detecting and handling incomplete uploads from previous sessions.
 * Automatically clears stalled uploads and notifies the user.
 */

import { useState, useEffect } from 'react'

import type { IncompleteUpload } from '~/types/upload'

interface UseIncompleteUploadsResult {
  incompleteUploads: IncompleteUpload[]
  showIncompletePrompt: boolean
  dismissIncompletePrompt: () => void
}

/**
 * Hook for detecting incomplete uploads from previous sessions.
 * Automatically clears them and provides notification state.
 *
 * @returns Incomplete upload state and dismiss handler
 */
export function useIncompleteUploads(): UseIncompleteUploadsResult {
  const [incompleteUploads, setIncompleteUploads] = useState<IncompleteUpload[]>([])
  const [showIncompletePrompt, setShowIncompletePrompt] = useState(false)

  // Detect and auto-clear incomplete uploads from previous session
  useEffect(() => {
    const checkAndClearIncomplete = async () => {
      try {
        const response = await fetch('/api/uploads/incomplete')
        const data = await response.json()

        if (data.uploads && data.uploads.length > 0) {
          console.log(
            `[Upload] Found ${data.uploads.length} incomplete upload(s) from previous session - auto-clearing`
          )

          // Store the list before clearing
          setIncompleteUploads(data.uploads)

          // Auto-clear stalled uploads
          await fetch('/api/uploads/clear-incomplete', { method: 'POST' })

          // Show notification
          setShowIncompletePrompt(true)
        }
      } catch (err) {
        console.error('[Upload] Failed to check for incomplete uploads:', err)
      }
    }

    void checkAndClearIncomplete()
  }, [])

  const dismissIncompletePrompt = () => {
    setShowIncompletePrompt(false)
  }

  return {
    incompleteUploads,
    showIncompletePrompt,
    dismissIncompletePrompt,
  }
}
