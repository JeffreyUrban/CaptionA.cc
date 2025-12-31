import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import type { FrameInfo, FrameBoxesData, ViewMode } from '~/types/review-labels'

interface KeyboardShortcutsParams {
  viewMode: ViewMode
  selectedFrameIndex: number | null
  frames: FrameInfo[]
  hoveredBoxIndex: number | null
  currentFrameBoxes: FrameBoxesData | null
  isSelecting: boolean
  handleThumbnailClick: (frameIndex: number | 'analysis') => void
  handleBoxClick: (boxIndex: number, label: 'in' | 'out') => Promise<void>
  cancelSelection: () => void
}

/**
 * Handles keyboard shortcuts for the ReviewLabels workflow.
 * Extracted from the main component to reduce complexity.
 */
export function useReviewLabelsKeyboardShortcuts({
  viewMode,
  selectedFrameIndex,
  frames,
  hoveredBoxIndex,
  currentFrameBoxes,
  isSelecting,
  handleThumbnailClick,
  handleBoxClick,
  cancelSelection,
}: KeyboardShortcutsParams): void {
  useKeyboardShortcuts(
    (e: KeyboardEvent) => {
      handleKeyDown(e, {
        viewMode,
        selectedFrameIndex,
        frames,
        hoveredBoxIndex,
        currentFrameBoxes,
        isSelecting,
        handleThumbnailClick,
        handleBoxClick,
        cancelSelection,
      })
    },
    [
      viewMode,
      selectedFrameIndex,
      frames,
      hoveredBoxIndex,
      currentFrameBoxes,
      isSelecting,
      handleThumbnailClick,
      handleBoxClick,
      cancelSelection,
    ]
  )
}

type KeyHandler = (e: KeyboardEvent, params: KeyboardShortcutsParams) => void

const KEY_HANDLERS: Record<string, KeyHandler> = {
  ArrowLeft: handleArrowLeft,
  ArrowRight: handleArrowRight,
  Escape: handleEscape,
  i: handleMarkIn,
  I: handleMarkIn,
  o: handleMarkOut,
  O: handleMarkOut,
  '0': handleJumpToAnalysis,
  '1': handleQuickJump,
  '2': handleQuickJump,
  '3': handleQuickJump,
  '4': handleQuickJump,
  '5': handleQuickJump,
  '6': handleQuickJump,
  '7': handleQuickJump,
  '8': handleQuickJump,
  '9': handleQuickJump,
}

function handleKeyDown(e: KeyboardEvent, params: KeyboardShortcutsParams): void {
  const handler = KEY_HANDLERS[e.key]
  if (handler) {
    handler(e, params)
  }
}

function handleArrowLeft(e: KeyboardEvent, params: KeyboardShortcutsParams): void {
  const { viewMode, selectedFrameIndex, frames, handleThumbnailClick } = params
  e.preventDefault()
  if (viewMode !== 'frame' || selectedFrameIndex === null) return

  const currentIndex = frames.findIndex(f => f.frameIndex === selectedFrameIndex)
  if (currentIndex > 0) {
    const prevFrame = frames[currentIndex - 1]
    if (prevFrame) {
      handleThumbnailClick(prevFrame.frameIndex)
    }
  }
}

function handleArrowRight(e: KeyboardEvent, params: KeyboardShortcutsParams): void {
  const { viewMode, selectedFrameIndex, frames, handleThumbnailClick } = params
  e.preventDefault()

  if (viewMode === 'frame' && selectedFrameIndex !== null) {
    const currentIndex = frames.findIndex(f => f.frameIndex === selectedFrameIndex)
    if (currentIndex < frames.length - 1) {
      const nextFrame = frames[currentIndex + 1]
      if (nextFrame) {
        handleThumbnailClick(nextFrame.frameIndex)
      }
    }
  } else if (viewMode === 'analysis' && frames.length > 0) {
    const firstFrame = frames[0]
    if (firstFrame) {
      handleThumbnailClick(firstFrame.frameIndex)
    }
  }
}

function handleEscape(e: KeyboardEvent, params: KeyboardShortcutsParams): void {
  const { isSelecting, cancelSelection, handleThumbnailClick } = params
  e.preventDefault()

  if (isSelecting) {
    cancelSelection()
  } else {
    handleThumbnailClick('analysis')
  }
}

function handleMarkIn(e: KeyboardEvent, params: KeyboardShortcutsParams): void {
  const { hoveredBoxIndex, currentFrameBoxes, handleBoxClick } = params
  e.preventDefault()

  if (hoveredBoxIndex === null || !currentFrameBoxes) return

  const box = currentFrameBoxes.boxes[hoveredBoxIndex]
  if (box) {
    void handleBoxClick(box.boxIndex, 'in')
  }
}

function handleMarkOut(e: KeyboardEvent, params: KeyboardShortcutsParams): void {
  const { hoveredBoxIndex, currentFrameBoxes, handleBoxClick } = params
  e.preventDefault()

  if (hoveredBoxIndex === null || !currentFrameBoxes) return

  const box = currentFrameBoxes.boxes[hoveredBoxIndex]
  if (box) {
    void handleBoxClick(box.boxIndex, 'out')
  }
}

function handleJumpToAnalysis(e: KeyboardEvent, params: KeyboardShortcutsParams): void {
  const { handleThumbnailClick } = params
  e.preventDefault()
  handleThumbnailClick('analysis')
}

function handleQuickJump(e: KeyboardEvent, params: KeyboardShortcutsParams): void {
  const { frames, handleThumbnailClick } = params
  e.preventDefault()

  const frameNum = parseInt(e.key) - 1
  if (frameNum < frames.length) {
    const targetFrame = frames[frameNum]
    if (targetFrame) {
      handleThumbnailClick(targetFrame.frameIndex)
    }
  }
}
