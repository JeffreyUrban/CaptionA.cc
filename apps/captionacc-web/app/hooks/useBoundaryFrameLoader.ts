/**
 * Hook for hierarchical frame loading with priority queue and LRU caching.
 * Loads frames at different modulo levels (coarse to fine) based on proximity to current frame.
 *
 * This is extracted from the main BoundaryWorkflow component to reduce complexity.
 * The original loadFrameHierarchy function had complexity of 22.
 */

import { useEffect, useRef } from 'react'

import type { Frame } from '~/types/boundaries'

interface UseBoundaryFrameLoaderParams {
  videoId: string
  currentFrameIndexRef: React.RefObject<number> // Pass ref, read inside effect
  totalFrames: number
  framesRef: React.RefObject<Map<number, Frame>> // Now passed from parent
  isReady: boolean // Only start loading when metadata is loaded
}

// LRU cache configuration
const MAX_CHUNKS_PER_MODULO = 5
const MAX_CONCURRENT_REQUESTS = 6
const FRAMES_PER_CHUNK = 32

// Modulo levels with their preload ranges
// Higher modulo = coarser sampling, larger range
// Lower modulo = finer sampling, smaller range
const MODULO_LEVELS = [
  { modulo: 32, range: 1024 },
  { modulo: 16, range: 512 },
  { modulo: 8, range: 256 },
  { modulo: 4, range: 128 },
  { modulo: 2, range: 64 },
  { modulo: 1, range: 32 },
] as const

interface QueueChunk {
  modulo: number
  range: number
  frames: number[]
}

/**
 * Build queue of chunks to load for a specific modulo level.
 */
function buildQueueForModulo(
  centerFrame: number,
  moduloLevelIndex: number,
  totalFrames: number,
  loadedChunks: Map<number, number[]>,
  requestedChunks: Map<number, Set<number>>
): QueueChunk[] {
  const chunks: QueueChunk[] = []
  const level = MODULO_LEVELS[moduloLevelIndex]
  if (!level) return chunks

  const { modulo, range } = level
  const rangeStart = Math.max(0, centerFrame - range)
  const rangeEnd = Math.min(totalFrames - 1, centerFrame + range)

  // Chunk size in frame indices = 32 frames x modulo spacing
  // For modulo 32: 32 frames x 32 = 1024 frame indices [0-1023]
  const chunkSize = FRAMES_PER_CHUNK * modulo

  // Align to chunk boundaries
  const firstChunkStart = Math.floor(rangeStart / chunkSize) * chunkSize
  const lastChunkStart = Math.floor(rangeEnd / chunkSize) * chunkSize

  // Get cached chunks and in-flight requests for this modulo
  const cachedChunks = loadedChunks.get(modulo) ?? []
  const inFlightChunks = requestedChunks.get(modulo) ?? new Set()

  // Collect frames in chunks of 32 frames each
  for (let chunkStart = firstChunkStart; chunkStart <= lastChunkStart; chunkStart += chunkSize) {
    // Skip if chunk is already loaded or being fetched
    if (cachedChunks.includes(chunkStart) || inFlightChunks.has(chunkStart)) {
      continue
    }

    const chunkEnd = chunkStart + chunkSize - 1
    const chunkFrames: number[] = []

    // Collect ALL frames at modulo positions within this chunk
    // Chunks are atomic - we load all frames or none (cache check handles skip)
    for (let i = chunkStart; i <= Math.min(chunkEnd, totalFrames - 1); i++) {
      if (i % modulo === 0) {
        chunkFrames.push(i)
      }
    }

    // Add chunk if it has frames (including edge chunks with <32 frames)
    if (chunkFrames.length > 0) {
      chunks.push({ modulo, range, frames: chunkFrames })
    }
  }

  return chunks
}

/**
 * Filter queue to only include chunks that overlap with current frame's range.
 */
function filterQueueByRange(queue: QueueChunk[], currentFrame: number): QueueChunk[] {
  return queue.filter(chunk => {
    const firstFrame = chunk.frames[0]
    const lastFrame = chunk.frames[chunk.frames.length - 1]
    if (firstFrame === undefined || lastFrame === undefined) return false

    const rangeStart = currentFrame - chunk.range
    const rangeEnd = currentFrame + chunk.range

    // Chunk overlaps if: chunkStart <= rangeEnd && chunkEnd >= rangeStart
    return firstFrame <= rangeEnd && lastFrame >= rangeStart
  })
}

/**
 * Mark chunks as requested (before fetch starts).
 */
function markChunksAsRequested(
  batch: QueueChunk[],
  requestedChunks: Map<number, Set<number>>
): void {
  for (const chunk of batch) {
    const firstChunkFrame = chunk.frames[0]
    if (firstChunkFrame === undefined) continue

    const chunkSize = FRAMES_PER_CHUNK * chunk.modulo
    const chunkStart = Math.floor(firstChunkFrame / chunkSize) * chunkSize

    let inFlight = requestedChunks.get(chunk.modulo)
    if (!inFlight) {
      inFlight = new Set()
      requestedChunks.set(chunk.modulo, inFlight)
    }
    inFlight.add(chunkStart)
  }
}

/**
 * Process loaded frame data and update frames map.
 */
function processLoadedFrames(
  results: Array<{ frames: Array<{ frame_index: number; image_data: string }> }>,
  framesMap: Map<number, Frame>
): void {
  for (const data of results) {
    for (const frame of data.frames) {
      const binaryData = atob(frame.image_data)
      const bytes = Uint8Array.from(binaryData, char => char.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'image/jpeg' })
      const imageUrl = URL.createObjectURL(blob)
      framesMap.set(frame.frame_index, {
        frame_index: frame.frame_index,
        image_url: imageUrl,
        ocr_text: '',
      })
    }
  }
}

/**
 * Move chunks from requested to loaded cache with LRU eviction.
 */
function updateCacheAfterLoad(
  batch: QueueChunk[],
  loadedChunks: Map<number, number[]>,
  requestedChunks: Map<number, Set<number>>
): void {
  for (const chunk of batch) {
    const chunkFirstFrame = chunk.frames[0]
    if (chunkFirstFrame === undefined) continue

    const chunkSize = FRAMES_PER_CHUNK * chunk.modulo
    const chunkStart = Math.floor(chunkFirstFrame / chunkSize) * chunkSize

    // Remove from requested
    const inFlight = requestedChunks.get(chunk.modulo)
    if (inFlight) {
      inFlight.delete(chunkStart)
    }

    // Add to loaded cache (with LRU eviction)
    const cache = loadedChunks.get(chunk.modulo) ?? []
    if (!loadedChunks.has(chunk.modulo)) {
      loadedChunks.set(chunk.modulo, cache)
    }
    const shouldAdd = !cache.includes(chunkStart)
    if (shouldAdd) cache.push(chunkStart)
    if (cache.length > MAX_CHUNKS_PER_MODULO) cache.shift()
  }
}

/**
 * Hook for loading frames with hierarchical priority queue.
 */
export function useBoundaryFrameLoader({
  videoId,
  currentFrameIndexRef,
  totalFrames,
  framesRef,
  isReady,
}: UseBoundaryFrameLoaderParams): void {
  const loadedChunksRef = useRef<Map<number, number[]>>(new Map())
  const requestedChunksRef = useRef<Map<number, Set<number>>>(new Map())

  useEffect(() => {
    if (!isReady || !videoId || totalFrames === 0) return

    let cancelled = false
    let lastLoadedFrame = -1000 // Track last frame we loaded around

    const loadFrameHierarchy = async () => {
      if (cancelled) return

      // Read current frame from ref (always gets latest value)
      const currentFrameIndex = currentFrameIndexRef.current ?? 0

      // Only reload if we've moved significantly (more than 16 frames)
      // This prevents constant reloading while still responding to navigation
      if (Math.abs(currentFrameIndex - lastLoadedFrame) < 16) {
        return
      }

      const encodedVideoId = encodeURIComponent(videoId)

      try {
        // Check if this is a jump beyond largest cache range (modulo=32, range=1024)
        const isJump = Math.abs(currentFrameIndex - lastLoadedFrame) > 1024

        // If jumping, load exact visible frames FIRST and WAIT for them (modulo=1, level 5)
        if (isJump) {
          let finestQueue = buildQueueForModulo(
            currentFrameIndex,
            5, // Level 5 = modulo 1 (finest, exact frames)
            totalFrames,
            loadedChunksRef.current,
            requestedChunksRef.current
          )

          // Load ALL finest frames before starting progressive loading
          while (finestQueue.length > 0) {
            if (cancelled) return

            const batch = finestQueue.splice(0, MAX_CONCURRENT_REQUESTS)
            markChunksAsRequested(batch, requestedChunksRef.current)

            const batchPromises = batch.map(async chunk => {
              const indicesParam = chunk.frames.join(',')
              const response = await fetch(
                `/api/frames/${encodedVideoId}/batch?indices=${indicesParam}`
              )
              return response.json() as Promise<{
                frames: Array<{ frame_index: number; image_data: string }>
              }>
            })

            const results = await Promise.all(batchPromises)
            processLoadedFrames(results, framesRef.current)
            updateCacheAfterLoad(batch, loadedChunksRef.current, requestedChunksRef.current)
          }
        }

        // Now do normal progressive loading (coarsest to finest)
        let currentModuloLevel = 0
        let queue = buildQueueForModulo(
          currentFrameIndex,
          currentModuloLevel,
          totalFrames,
          loadedChunksRef.current,
          requestedChunksRef.current
        )

        // Continue while we have chunks to load or more modulo levels to try
        while (queue.length > 0 || currentModuloLevel < MODULO_LEVELS.length - 1) {
          if (cancelled) return

          // If current level complete, move to next finer level
          if (queue.length === 0) {
            currentModuloLevel++
            queue = buildQueueForModulo(
              currentFrameIndex,
              currentModuloLevel,
              totalFrames,
              loadedChunksRef.current,
              requestedChunksRef.current
            )
            if (queue.length === 0) continue
          }

          if (queue.length === 0) break

          // Filter to drop entire chunks outside range of current frame
          queue = filterQueueByRange(queue, currentFrameIndex)

          if (queue.length === 0) break

          // Process multiple chunks concurrently
          const batch = queue.splice(0, MAX_CONCURRENT_REQUESTS)

          // Mark chunks as requested IMMEDIATELY to prevent duplicate requests
          markChunksAsRequested(batch, requestedChunksRef.current)

          // Load chunks concurrently
          const batchPromises = batch.map(async chunk => {
            const indicesParam = chunk.frames.join(',')
            const response = await fetch(
              `/api/frames/${encodedVideoId}/batch?indices=${indicesParam}`
            )
            return response.json() as Promise<{
              frames: Array<{ frame_index: number; image_data: string }>
            }>
          })

          const results = await Promise.all(batchPromises)

          // Update framesRef directly (RAF loop will pick up changes)
          processLoadedFrames(results, framesRef.current)

          // Update cache
          updateCacheAfterLoad(batch, loadedChunksRef.current, requestedChunksRef.current)
        }

        // Update lastLoadedFrame after successful load
        lastLoadedFrame = currentFrameIndex
      } catch (error: unknown) {
        console.error('Failed to load frames:', error)
      }
    }

    // Poll every 100ms to check if we need to load more frames
    const pollInterval = setInterval(() => {
      void loadFrameHierarchy()
    }, 100)

    // Initial load
    void loadFrameHierarchy()

    return () => {
      cancelled = true
      clearInterval(pollInterval)
    }
    // Note: currentFrameIndexRef is NOT in dependencies - we read from it via polling
    // This allows continuous monitoring without effect re-triggering
  }, [totalFrames, videoId, isReady])
}
