/**
 * Keyboard shortcut handlers for the Layout annotation workflow.
 * Pure functions that handle keyboard navigation and actions.
 */

import type { KeyboardShortcutContext } from '~/types/layout'

/**
 * Handle left arrow key - navigate to previous frame
 */
export function handleArrowLeft(ctx: KeyboardShortcutContext): void {
  if (ctx.viewMode === 'frame' && ctx.selectedFrameIndex !== null) {
    const currentIndex = ctx.frames.findIndex(f => f.frameIndex === ctx.selectedFrameIndex)
    if (currentIndex > 0) {
      const prevFrame = ctx.frames[currentIndex - 1]
      if (prevFrame) {
        ctx.handleThumbnailClick(prevFrame.frameIndex)
      }
    }
  }
}

/**
 * Handle right arrow key - navigate to next frame
 */
export function handleArrowRight(ctx: KeyboardShortcutContext): void {
  if (ctx.viewMode === 'frame' && ctx.selectedFrameIndex !== null) {
    const currentIndex = ctx.frames.findIndex(f => f.frameIndex === ctx.selectedFrameIndex)
    if (currentIndex < ctx.frames.length - 1) {
      const nextFrame = ctx.frames[currentIndex + 1]
      if (nextFrame) {
        ctx.handleThumbnailClick(nextFrame.frameIndex)
      }
    }
  } else if (ctx.viewMode === 'analysis' && ctx.frames.length > 0) {
    const firstFrame = ctx.frames[0]
    if (firstFrame) {
      ctx.handleThumbnailClick(firstFrame.frameIndex)
    }
  }
}

/**
 * Handle escape key - cancel selection or return to analysis view
 */
export function handleEscape(ctx: KeyboardShortcutContext): void {
  if (ctx.isSelecting) {
    ctx.cancelSelection()
  } else {
    ctx.handleThumbnailClick('analysis')
  }
}

/**
 * Handle 'i' key - mark hovered box as 'in'
 */
export function handleMarkIn(ctx: KeyboardShortcutContext): void {
  if (ctx.hoveredBoxIndex !== null && ctx.currentFrameBoxes) {
    const box = ctx.currentFrameBoxes.boxes[ctx.hoveredBoxIndex]
    if (box) {
      void ctx.handleBoxClick(box.boxIndex, 'in')
    }
  }
}

/**
 * Handle 'o' key - mark hovered box as 'out'
 */
export function handleMarkOut(ctx: KeyboardShortcutContext): void {
  if (ctx.hoveredBoxIndex !== null && ctx.currentFrameBoxes) {
    const box = ctx.currentFrameBoxes.boxes[ctx.hoveredBoxIndex]
    if (box) {
      void ctx.handleBoxClick(box.boxIndex, 'out')
    }
  }
}

/**
 * Handle number keys 1-9 - navigate to specific frame
 */
export function handleNumberKey(ctx: KeyboardShortcutContext, key: string): void {
  const frameNum = parseInt(key) - 1
  if (frameNum < ctx.frames.length) {
    const targetFrame = ctx.frames[frameNum]
    if (targetFrame) {
      ctx.handleThumbnailClick(targetFrame.frameIndex)
    }
  }
}

/**
 * Handle '0' key - return to analysis view
 */
export function handleAnalysisViewShortcut(ctx: KeyboardShortcutContext): void {
  ctx.handleThumbnailClick('analysis')
}

/**
 * Dispatch keyboard shortcut to appropriate handler.
 * Returns true if the key was handled.
 */
export function dispatchKeyboardShortcut(key: string, ctx: KeyboardShortcutContext): boolean {
  // Arrow navigation
  if (key === 'ArrowLeft') {
    handleArrowLeft(ctx)
    return true
  }
  if (key === 'ArrowRight') {
    handleArrowRight(ctx)
    return true
  }

  // Escape
  if (key === 'Escape') {
    handleEscape(ctx)
    return true
  }

  // Mark in/out
  if (key === 'i' || key === 'I') {
    handleMarkIn(ctx)
    return true
  }
  if (key === 'o' || key === 'O') {
    handleMarkOut(ctx)
    return true
  }

  // Number keys 1-9 for frame navigation
  if (key >= '1' && key <= '9') {
    handleNumberKey(ctx, key)
    return true
  }

  // 0 for analysis view
  if (key === '0') {
    handleAnalysisViewShortcut(ctx)
    return true
  }

  return false
}
