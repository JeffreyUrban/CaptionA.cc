/**
 * Hook for handling drag and drop functionality in the upload workflow.
 * Manages drag state and processes dropped files/folders.
 */

import { useState, useRef, useCallback } from 'react'

import type { FileSystemEntry } from '~/types/upload'
import { traverseFileTree } from '~/utils/upload-helpers'

interface UseUploadDragDropResult {
  dragActive: boolean
  dragCounterRef: React.MutableRefObject<number>
  handleDragEnter: (e: React.DragEvent) => void
  handleDragLeave: (e: React.DragEvent) => void
  handleDragOver: (e: React.DragEvent) => void
  handleDrop: (e: React.DragEvent) => Promise<void>
}

/**
 * Hook for managing drag and drop state and handling dropped files.
 *
 * @param onFilesDropped - Callback when files are successfully dropped and collected
 * @param disabled - Whether drag and drop should be disabled (e.g., during upload)
 * @returns Drag state and event handlers
 */
export function useUploadDragDrop(
  onFilesDropped: (files: FileList) => void,
  disabled: boolean = false
): UseUploadDragDropResult {
  const [dragActive, setDragActive] = useState(false)
  const dragCounterRef = useRef(0)

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (disabled) return

      dragCounterRef.current++
      if (dragCounterRef.current === 1) {
        setDragActive(true)
      }
    },
    [disabled]
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setDragActive(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setDragActive(false)

      if (disabled) return

      const items = e.dataTransfer.items
      if (!items) return

      console.log(`[handleDrop] Processing ${items.length} items`)

      // CRITICAL: Collect all entries synchronously BEFORE any async operations
      // DataTransferItemList becomes invalid after the event handler yields
      const entries: (FileSystemEntry | null)[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (!item) continue
        console.log(`[handleDrop] Item ${i}: kind="${item.kind}", type="${item.type}"`)
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry()
          console.log(`[handleDrop] Item ${i}: webkitGetAsEntry() returned`, entry)
          if (entry) {
            console.log(
              `[handleDrop] Item ${i}: isFile=${entry.isFile}, isDirectory=${entry.isDirectory}`
            )
            entries.push(entry as FileSystemEntry)
          } else {
            console.log(`[handleDrop] Item ${i}: webkitGetAsEntry() returned null/undefined`)
          }
        }
      }

      console.log(`[handleDrop] Collected ${entries.length} entries, now processing asynchronously`)

      // Now process all entries asynchronously
      const files: File[] = []
      for (const entry of entries) {
        if (!entry) continue
        await traverseFileTree(entry, '', files)
      }

      console.log(`[handleDrop] Collected ${files.length} files`)

      // Create FileList-like object
      const dt = new DataTransfer()
      files.forEach(file => dt.items.add(file))
      onFilesDropped(dt.files)
    },
    [disabled, onFilesDropped]
  )

  return {
    dragActive,
    dragCounterRef,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  }
}
