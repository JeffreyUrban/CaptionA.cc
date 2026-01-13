/**
 * Keyboard shortcuts handler for the Caption Frame Extents Annotation workflow.
 * Extracted to reduce complexity in the main component.
 */

import { useKeyboardShortcuts } from './useKeyboardShortcuts'

interface UseCaptionFrameExtentsKeyboardShortcutsParams {
  navigateFrame: (delta: number) => void
  jumpToStart: () => void
  jumpToEnd: () => void
  markStart: () => void
  markEnd: () => void
  saveAnnotation: () => Promise<void>
  clearMarks: () => void
}

/**
 * Handle keyboard shortcuts for caption frame extents annotation workflow.
 */
export function useCaptionFrameExtentsKeyboardShortcuts({
  navigateFrame,
  jumpToStart,
  jumpToEnd,
  markStart,
  markEnd,
  saveAnnotation,
  clearMarks,
}: UseCaptionFrameExtentsKeyboardShortcutsParams): void {
  useKeyboardShortcuts(
    (e: KeyboardEvent) => {
      handleKeyDown(e, {
        navigateFrame,
        jumpToStart,
        jumpToEnd,
        markStart,
        markEnd,
        saveAnnotation,
        clearMarks,
      })
    },
    [navigateFrame, jumpToStart, jumpToEnd, markStart, markEnd, saveAnnotation, clearMarks]
  )
}

type KeyHandler = (e: KeyboardEvent, params: UseCaptionFrameExtentsKeyboardShortcutsParams) => void

const KEY_HANDLERS: Record<string, KeyHandler> = {
  arrowdown: handleNavigateForward,
  arrowright: handleNavigateForward,
  arrowup: handleNavigateBack,
  arrowleft: handleNavigateBack,
  a: handleJumpToStart,
  s: handleMarkStart,
  d: handleMarkEnd,
  f: handleJumpToEnd,
  enter: handleSave,
  escape: handleClear,
}

function handleKeyDown(
  e: KeyboardEvent,
  params: UseCaptionFrameExtentsKeyboardShortcutsParams
): void {
  const key = e.key.toLowerCase()
  const handler = KEY_HANDLERS[key]
  if (handler) {
    handler(e, params)
  }
}

function handleNavigateForward(
  e: KeyboardEvent,
  params: UseCaptionFrameExtentsKeyboardShortcutsParams
): void {
  e.preventDefault()
  const jump = e.ctrlKey ? 50 : e.shiftKey ? 10 : 1
  params.navigateFrame(jump)
}

function handleNavigateBack(
  e: KeyboardEvent,
  params: UseCaptionFrameExtentsKeyboardShortcutsParams
): void {
  e.preventDefault()
  const jump = e.ctrlKey ? 50 : e.shiftKey ? 10 : 1
  params.navigateFrame(-jump)
}

function handleJumpToStart(
  e: KeyboardEvent,
  params: UseCaptionFrameExtentsKeyboardShortcutsParams
): void {
  e.preventDefault()
  params.jumpToStart()
}

function handleMarkStart(
  e: KeyboardEvent,
  params: UseCaptionFrameExtentsKeyboardShortcutsParams
): void {
  e.preventDefault()
  params.markStart()
}

function handleMarkEnd(
  e: KeyboardEvent,
  params: UseCaptionFrameExtentsKeyboardShortcutsParams
): void {
  e.preventDefault()
  params.markEnd()
}

function handleJumpToEnd(
  e: KeyboardEvent,
  params: UseCaptionFrameExtentsKeyboardShortcutsParams
): void {
  e.preventDefault()
  params.jumpToEnd()
}

function handleSave(e: KeyboardEvent, params: UseCaptionFrameExtentsKeyboardShortcutsParams): void {
  e.preventDefault()
  void params.saveAnnotation()
}

function handleClear(
  e: KeyboardEvent,
  params: UseCaptionFrameExtentsKeyboardShortcutsParams
): void {
  e.preventDefault()
  params.clearMarks()
}
