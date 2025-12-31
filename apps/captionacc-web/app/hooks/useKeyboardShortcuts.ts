import { useEffect } from 'react'

interface UseKeyboardShortcutsOptions {
  /**
   * If true, keyboard shortcuts will be ignored when user is typing in an input or textarea.
   * Defaults to true.
   */
  skipWhenTyping?: boolean
}

/**
 * Sets up keyboard shortcut handling with automatic cleanup.
 * By default, shortcuts are disabled when user is typing in an input/textarea.
 *
 * @param handler - Keyboard event handler function
 * @param deps - Dependencies array for the useEffect
 * @param options - Configuration options
 *
 * @example
 * ```typescript
 * useKeyboardShortcuts((e) => {
 *   if (e.key === 'ArrowUp') {
 *     e.preventDefault()
 *     navigateFrame(-1)
 *   }
 * }, [navigateFrame])
 * ```
 */
export function useKeyboardShortcuts(
  handler: (e: KeyboardEvent) => void,
  deps: React.DependencyList,
  options: UseKeyboardShortcutsOptions = {}
) {
  const { skipWhenTyping = true } = options

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in input/textarea (unless disabled)
      if (skipWhenTyping) {
        const target = e.target
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          return
        }
      }

      handler(e)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
