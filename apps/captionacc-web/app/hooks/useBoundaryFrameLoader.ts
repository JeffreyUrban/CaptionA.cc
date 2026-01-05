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
  jumpRequestedRef: React.RefObject<boolean> // True when user explicitly jumps (not scroll/drag)
  jumpTargetRef: React.RefObject<number | null> // Pending jump destination (null = no pending jump)
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
// Updated for Wasabi VP9 chunks: [16, 4, 1]
const MODULO_LEVELS = [
  { modulo: 16, range: 512 },
  { modulo: 4, range: 128 },
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

    // Collect frames at modulo positions within this chunk
    // Hybrid duplication: skip frames that belong to a coarser modulo level
    // - modulo 16: only frames where index % 16 === 0
    // - modulo 4: only frames where index % 4 === 0 AND index % 16 !== 0
    // - modulo 1: ALL frames (no skipping)
    for (let i = chunkStart; i <= Math.min(chunkEnd, totalFrames - 1); i++) {
      // For modulo_1, include every frame
      if (modulo === 1) {
        chunkFrames.push(i)
        continue
      }

      // For other modulos, only include frames at modulo spacing
      if (i % modulo !== 0) continue

      // Hybrid duplication: skip frames in coarser modulo levels
      if (modulo === 4 && i % 16 === 0) continue

      chunkFrames.push(i)
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
 * Extract a single frame from a video element as a Blob URL.
 */
async function extractFrameFromVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  frameTime: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    video.currentTime = frameTime

    const onSeeked = () => {
      try {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Failed to get canvas context'))
          return
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        canvas.toBlob(
          blob => {
            if (!blob) {
              reject(new Error('Failed to create blob from canvas'))
              return
            }
            resolve(URL.createObjectURL(blob))
          },
          'image/jpeg',
          0.95
        )
      } catch (error) {
        reject(error)
      } finally {
        video.removeEventListener('seeked', onSeeked)
      }
    }

    video.addEventListener('seeked', onSeeked)
    video.onerror = () => {
      video.removeEventListener('seeked', onSeeked)
      reject(new Error('Video error during seek'))
    }
  })
}

/**
 * Process loaded VP9 WebM chunks and extract individual frames.
 */
async function processLoadedChunks(
  chunks: Array<{
    chunkIndex: number
    signedUrl: string
    frameIndices: number[]
  }>,
  framesMap: Map<number, Frame>,
  modulo: number
): Promise<void> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  const canvas = document.createElement('canvas')

  // FPS assumption: 10 fps for VP9 chunks (matches encoding script)
  const fps = 10

  for (const chunk of chunks) {
    try {
      // Fetch WebM chunk from Wasabi
      const response = await fetch(chunk.signedUrl)
      if (!response.ok) {
        console.error(`Failed to fetch chunk ${chunk.chunkIndex}: ${response.statusText}`)
        continue
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      video.src = objectUrl

      // Wait for video metadata to load
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve()
        video.onerror = () => reject(new Error('Failed to load video metadata'))
      })

      // Extract each frame from the chunk
      // First, build the actual sequence of frames in this chunk (accounting for hybrid duplication)
      const framesInChunk: number[] = []

      if (modulo === 1) {
        // modulo_1: ALL frames (every single frame, no skipping)
        for (let i = 0; i < 32; i++) {
          framesInChunk.push(chunk.chunkIndex + i)
        }
      } else {
        // modulo_4 and modulo_16: frames at modulo spacing with hybrid duplication
        for (let i = chunk.chunkIndex; framesInChunk.length < 32; i += modulo) {
          // Skip frames that belong to coarser modulo levels (hybrid duplication)
          if (modulo === 4 && i % 16 === 0) continue

          framesInChunk.push(i)
        }
      }

      for (const frameIndex of chunk.frameIndices) {
        // Find the actual position of this frame in the chunk's frame sequence
        const framePositionInChunk = framesInChunk.indexOf(frameIndex)

        if (framePositionInChunk === -1) {
          console.warn(`Frame ${frameIndex} not found in chunk ${chunk.chunkIndex}`)
          continue
        }

        const frameTime = framePositionInChunk / fps

        const imageUrl = await extractFrameFromVideo(video, canvas, frameTime)
        framesMap.set(frameIndex, {
          frame_index: frameIndex,
          image_url: imageUrl,
          ocr_text: '',
        })
      }

      // Clean up object URL
      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      console.error(`Error processing chunk ${chunk.chunkIndex}:`, error)
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
  jumpRequestedRef,
  jumpTargetRef,
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
    let isLoading = false // Prevent concurrent executions

    const loadFrameHierarchy = async () => {
      if (cancelled || isLoading) return

      // Check for pending jump FIRST (before debouncing)
      const isJump = jumpRequestedRef.current ?? false
      const jumpTarget = jumpTargetRef.current

      // Read current frame from ref (always gets latest value)
      const currentFrameIndex = currentFrameIndexRef.current ?? 0

      // Only reload if we've moved significantly (more than 16 frames)
      // Skip this check if there's a pending jump
      if (!isJump && Math.abs(currentFrameIndex - lastLoadedFrame) < 16) {
        return
      }

      isLoading = true
      const targetFrameIndex = currentFrameIndex // Capture at start, not end

      const encodedVideoId = encodeURIComponent(videoId)

      try {
        // If jumping, load exact frames around jump target FIRST, then navigate
        if (isJump && jumpTarget !== null && !isNaN(jumpTarget) && jumpTarget >= 0) {
          // Don't clear flag yet - wait until jump completes

          let finestQueue = buildQueueForModulo(
            jumpTarget, // Load around target, not current position
            2, // Level 2 = modulo 1 (finest, exact frames)
            totalFrames,
            loadedChunksRef.current,
            requestedChunksRef.current
          )

          // Load ALL finest frames before jumping
          while (finestQueue.length > 0) {
            if (cancelled) return

            const batch = finestQueue.splice(0, MAX_CONCURRENT_REQUESTS)
            markChunksAsRequested(batch, requestedChunksRef.current)

            const batchPromises = batch.map(async chunk => {
              const indicesParam = chunk.frames.join(',')
              const response = await fetch(
                `/api/frames/${encodedVideoId}/batch-signed-urls?modulo=${chunk.modulo}&indices=${indicesParam}`
              )
              return response.json() as Promise<{
                chunks: Array<{
                  chunkIndex: number
                  signedUrl: string
                  frameIndices: number[]
                }>
              }>
            })

            const results = await Promise.all(batchPromises)
            // Flatten chunks from all responses
            const allChunks = results.flatMap(r => r.chunks)
            await processLoadedChunks(allChunks, framesRef.current, 1)
            updateCacheAfterLoad(batch, loadedChunksRef.current, requestedChunksRef.current)
          }

          // All exact frames loaded - NOW jump to target
          currentFrameIndexRef.current = jumpTarget
          jumpTargetRef.current = null // Clear pending jump
          jumpRequestedRef.current = false // Clear jump flag
          lastLoadedFrame = jumpTarget // Update tracking
        } else if (isJump) {
          // Invalid jump target - clear flags and warn
          console.warn('[useBoundaryFrameLoader] Invalid jump target:', jumpTarget)
          jumpRequestedRef.current = false
          jumpTargetRef.current = null
        }

        // Now do normal progressive loading (coarsest to finest)
        let currentModuloLevel = 0
        let queue = buildQueueForModulo(
          targetFrameIndex,
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
              targetFrameIndex,
              currentModuloLevel,
              totalFrames,
              loadedChunksRef.current,
              requestedChunksRef.current
            )
            if (queue.length === 0) continue
          }

          if (queue.length === 0) break

          // Filter to drop entire chunks outside range of target frame
          queue = filterQueueByRange(queue, targetFrameIndex)

          if (queue.length === 0) break

          // Process multiple chunks concurrently
          const batch = queue.splice(0, MAX_CONCURRENT_REQUESTS)

          // Mark chunks as requested IMMEDIATELY to prevent duplicate requests
          markChunksAsRequested(batch, requestedChunksRef.current)

          // Load chunks concurrently
          const batchPromises = batch.map(async chunk => {
            const indicesParam = chunk.frames.join(',')
            const response = await fetch(
              `/api/frames/${encodedVideoId}/batch-signed-urls?modulo=${chunk.modulo}&indices=${indicesParam}`
            )
            return response.json() as Promise<{
              chunks: Array<{
                chunkIndex: number
                signedUrl: string
                frameIndices: number[]
              }>
            }>
          })

          const results = await Promise.all(batchPromises)

          // Flatten chunks from all responses
          const allChunks = results.flatMap(r => r.chunks)

          // Update framesRef directly (RAF loop will pick up changes)
          await processLoadedChunks(allChunks, framesRef.current, batch[0]?.modulo ?? 1)

          // Update cache
          updateCacheAfterLoad(batch, loadedChunksRef.current, requestedChunksRef.current)
        }

        // Update lastLoadedFrame after successful load (use captured target, not current)
        lastLoadedFrame = targetFrameIndex
      } catch (error: unknown) {
        console.error('Failed to load frames:', error)
      } finally {
        isLoading = false
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
