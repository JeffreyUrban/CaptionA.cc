import { useKeyboardShortcuts } from './useKeyboardShortcuts'

interface UseTextAnnotationKeyboardParams {
  handleSave: () => Promise<void>
  handleSaveEmptyCaption: () => Promise<void>
  handlePrevious: () => void
  handleSkip: () => void
  navigateFrame: (delta: number) => void
}

/**
 * Handles keyboard shortcuts for the Text Annotation workflow.
 * Extracted from the main component to reduce complexity.
 */
export function useTextAnnotationKeyboard({
  handleSave,
  handleSaveEmptyCaption,
  handlePrevious,
  handleSkip,
  navigateFrame,
}: UseTextAnnotationKeyboardParams): void {
  useKeyboardShortcuts(
    (e: KeyboardEvent) => {
      handleKeyDown(e, {
        handleSave,
        handleSaveEmptyCaption,
        handlePrevious,
        handleSkip,
        navigateFrame,
      })
    },
    [handleSave, handleSaveEmptyCaption, handlePrevious, handleSkip, navigateFrame],
    { skipWhenTyping: false } // Handle typing check manually for Ctrl+E
  )
}

function handleKeyDown(e: KeyboardEvent, params: UseTextAnnotationKeyboardParams): void {
  const { handleSave, handleSaveEmptyCaption, handlePrevious, handleSkip, navigateFrame } = params

  // Ctrl+E for Save Empty Caption (works even when typing)
  if (e.ctrlKey && e.key.toLowerCase() === 'e') {
    e.preventDefault()
    void handleSaveEmptyCaption()
    return
  }

  // Skip other shortcuts if typing in input/textarea
  const isTyping = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
  if (isTyping) return

  const key = e.key.toLowerCase()

  // Frame navigation (up/down arrows)
  if (key === 'arrowup') {
    e.preventDefault()
    navigateFrame(-1)
  } else if (key === 'arrowdown') {
    e.preventDefault()
    navigateFrame(1)
  }
  // Annotation navigation
  else if (key === 'enter') {
    e.preventDefault()
    void handleSave()
  } else if (key === 'arrowleft') {
    e.preventDefault()
    handlePrevious()
  } else if (key === 'arrowright') {
    e.preventDefault()
    handleSkip()
  }
}
