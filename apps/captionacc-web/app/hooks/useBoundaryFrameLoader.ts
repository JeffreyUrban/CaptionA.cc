/**
 * Hook for hierarchical frame loading with priority queue and LRU caching.
 * Loads frames at different modulo levels (coarse to fine) based on proximity to current frame.
 *
 * LOADING STRATEGIES:
 *
 * 1. **Normal Progressive Loading** (Common case - user scrolling/working):
 *    - Loads coarse-to-fine (modulo_16 → modulo_4 → modulo_1)
 *    - Centered on current frame position
 *    - Triggers when moved >3 frames
 *
 * 2. **Jump Loading** (Explicit navigation - Jump to Frame, Prev button):
 *    - HIGHEST PRIORITY - preloading pauses if jump requested
 *    - Loads modulo_1 (finest) frames FIRST around jump target
 *    - Blocks navigation until exact frames are loaded
 *    - Then does normal progressive loading
 *    - Triggered by: jumpRequestedRef = true, jumpTargetRef = target frame
 *
 * 3. **Next Annotation Preloading** (Background optimization):
 *    - LOWEST PRIORITY - yields to jumps and scrolling
 *    - Starts immediately when next annotation identified
 *    - Loads ALL frames for short annotations (<500 frames)
 *    - Loads boundaries + overview for long annotations (>500 frames)
 *    - Automatically pauses if user initiates a jump
 *    - Runs once per annotation (tracked by ID)
 *
 * CACHE MANAGEMENT:
 * - Chunks overlapping active annotation ±20 frames: PINNED (never evicted)
 * - Chunks overlapping next annotation ±20 frames: PINNED (never evicted)
 * - Other chunks: LRU eviction when over per-modulo limits
 * - Total cache: ~75-130MB (40+50+60 chunks across 3 modulos)
 *
 * This is extracted from the main BoundaryWorkflow component to reduce complexity.
 * The original loadFrameHierarchy function had complexity of 22.
 */

import { useEffect, useRef } from 'react'

import type { Annotation, Frame } from '~/types/boundaries'

interface UseBoundaryFrameLoaderParams {
  videoId: string
  currentFrameIndexRef: React.RefObject<number> // Pass ref, read inside effect
  jumpRequestedRef: React.RefObject<boolean> // True when user explicitly jumps (not scroll/drag)
  jumpTargetRef: React.RefObject<number | null> // Pending jump destination (null = no pending jump)
  totalFrames: number
  framesRef: React.RefObject<Map<number, Frame>> // Now passed from parent
  isReady: boolean // Only start loading when metadata is loaded
  activeAnnotation: Annotation | null // Current annotation being worked on
  nextAnnotation: Annotation | null // Next annotation to preload
}

// Cache configuration - optimized for seamless next annotation workflow
// Goal: User never waits when advancing to next annotation
// Strategy: Immediately preload next annotation as soon as it's identified
const MAX_CHUNKS_PER_MODULO = {
  16: 40, // ~20-40MB, covers ±10,240 frame indices - multiple annotations
  4: 50, // ~25-50MB, covers ±6,400 frame indices
  1: 60, // ~30-60MB, covers ±1,440 actual frames
} as const

const MAX_CONCURRENT_REQUESTS = 8 // Increased for faster loading
const FRAMES_PER_CHUNK = 32
const MAX_PRELOAD_ANNOTATION_SPAN = 500 // Max frames to fully preload for next annotation (all modulos)
const BOUNDARY_BUFFER = 20 // Frames to pin around annotation boundaries (start-20 to end+20)

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
 * Check if a frame should be included for this modulo level.
 * Non-duplicating strategy: each frame belongs to exactly one modulo level.
 */
function shouldIncludeFrame(frameIndex: number, modulo: number): boolean {
  if (modulo === 16) return frameIndex % 16 === 0
  if (modulo === 4) return frameIndex % 4 === 0 && frameIndex % 16 !== 0
  if (modulo === 1) return frameIndex % 4 !== 0
  return false
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
    for (let i = chunkStart; i <= Math.min(chunkEnd, totalFrames - 1); i++) {
      if (shouldIncludeFrame(i, modulo)) {
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
 * Build sequence of frames in a chunk based on modulo level.
 */
function buildFramesInChunk(chunkIndex: number, modulo: number): number[] {
  const framesInChunk: number[] = []

  if (modulo === 16) {
    for (let i = chunkIndex; framesInChunk.length < 32; i += 16) {
      framesInChunk.push(i)
    }
  } else if (modulo === 4) {
    for (let i = chunkIndex; framesInChunk.length < 32; i += 4) {
      if (i % 16 === 0) continue
      framesInChunk.push(i)
    }
  } else if (modulo === 1) {
    for (let i = chunkIndex; framesInChunk.length < 32; i++) {
      if (i % 4 === 0) continue
      framesInChunk.push(i)
    }
  }

  return framesInChunk
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

      const framesInChunk = buildFramesInChunk(chunk.chunkIndex, modulo)

      for (const frameIndex of chunk.frameIndices) {
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
 * Check if a chunk is pinned (should not be evicted).
 * Chunks are pinned if they overlap with active or next annotation ranges,
 * including a BOUNDARY_BUFFER frame buffer around boundaries for smooth navigation.
 */
function isChunkPinned(
  chunkStart: number,
  modulo: number,
  activeAnnotation: Annotation | null,
  nextAnnotation: Annotation | null
): boolean {
  const chunkSize = FRAMES_PER_CHUNK * modulo
  const chunkEnd = chunkStart + chunkSize - 1

  // Check if chunk overlaps with active annotation (with buffer)
  if (activeAnnotation) {
    const start = Math.max(0, activeAnnotation.start_frame_index - BOUNDARY_BUFFER)
    const end = activeAnnotation.end_frame_index + BOUNDARY_BUFFER
    if (chunkStart <= end && chunkEnd >= start) {
      return true
    }
  }

  // Check if chunk overlaps with next annotation (with buffer)
  if (nextAnnotation) {
    const start = Math.max(0, nextAnnotation.start_frame_index - BOUNDARY_BUFFER)
    const end = nextAnnotation.end_frame_index + BOUNDARY_BUFFER
    if (chunkStart <= end && chunkEnd >= start) {
      return true
    }
  }

  return false
}

/**
 * Find first unpinned chunk index in cache for eviction.
 */
function findUnpinnedChunkIndex(
  cache: number[],
  modulo: number,
  activeAnnotation: Annotation | null,
  nextAnnotation: Annotation | null
): number {
  for (let i = 0; i < cache.length; i++) {
    const candidateChunk = cache[i]
    if (candidateChunk === undefined) continue
    if (!isChunkPinned(candidateChunk, modulo, activeAnnotation, nextAnnotation)) {
      return i
    }
  }
  return -1
}

/**
 * Move chunks from requested to loaded cache with smart eviction.
 * Uses per-modulo limits and respects pinned chunks.
 */
function updateCacheAfterLoad(
  batch: QueueChunk[],
  loadedChunks: Map<number, number[]>,
  requestedChunks: Map<number, Set<number>>,
  activeAnnotation: Annotation | null,
  nextAnnotation: Annotation | null
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

    // Add to loaded cache (with smart eviction)
    const cache = loadedChunks.get(chunk.modulo) ?? []
    if (!loadedChunks.has(chunk.modulo)) {
      loadedChunks.set(chunk.modulo, cache)
    }

    if (cache.includes(chunkStart)) continue

    cache.push(chunkStart)

    // Evict oldest unpinned chunks if over limit
    const maxChunks =
      MAX_CHUNKS_PER_MODULO[chunk.modulo as keyof typeof MAX_CHUNKS_PER_MODULO] ?? 20
    while (cache.length > maxChunks) {
      const unpinnedIndex = findUnpinnedChunkIndex(
        cache,
        chunk.modulo,
        activeAnnotation,
        nextAnnotation
      )
      if (unpinnedIndex === -1) break
      cache.splice(unpinnedIndex, 1)
    }
  }
}

/**
 * Build preload queue for next annotation.
 * Aggressively loads all frames for next annotation to ensure zero wait time.
 *
 * Note: Preloaded chunks are automatically pinned by isChunkPinned() which includes
 * a ±20 frame buffer around annotation boundaries for smooth navigation.
 */
function buildNextAnnotationQueue(
  nextAnnotation: Annotation,
  totalFrames: number,
  loadedChunks: Map<number, number[]>,
  requestedChunks: Map<number, Set<number>>
): QueueChunk[] {
  const chunks: QueueChunk[] = []
  const span = nextAnnotation.end_frame_index - nextAnnotation.start_frame_index

  // If annotation is too long, only preload boundaries + coarse overview
  if (span > MAX_PRELOAD_ANNOTATION_SPAN) {
    // Load modulo_16 across entire annotation (quick overview)
    chunks.push(
      ...buildQueueForModulo(
        Math.floor((nextAnnotation.start_frame_index + nextAnnotation.end_frame_index) / 2),
        0, // modulo_16
        totalFrames,
        loadedChunks,
        requestedChunks
      )
    )

    // Load modulo_4 near start and end (boundary precision)
    // range=128 ensures we get frames well beyond the ±20 boundary buffer
    chunks.push(
      ...buildQueueForModulo(
        nextAnnotation.start_frame_index,
        1,
        totalFrames,
        loadedChunks,
        requestedChunks
      )
    )
    chunks.push(
      ...buildQueueForModulo(
        nextAnnotation.end_frame_index,
        1,
        totalFrames,
        loadedChunks,
        requestedChunks
      )
    )
  } else {
    // Annotation is short enough - load ALL frames across all modulos
    const centerFrame = Math.floor(
      (nextAnnotation.start_frame_index + nextAnnotation.end_frame_index) / 2
    )

    // Load all modulo levels for complete coverage
    for (let levelIndex = 0; levelIndex < MODULO_LEVELS.length; levelIndex++) {
      chunks.push(
        ...buildQueueForModulo(centerFrame, levelIndex, totalFrames, loadedChunks, requestedChunks)
      )
    }
  }

  return chunks
}

/**
 * Hook for loading frames with hierarchical priority queue.
 */
// eslint-disable-next-line max-lines-per-function -- Complex loading logic requires stateful polling and preloading
export function useBoundaryFrameLoader({
  videoId,
  currentFrameIndexRef,
  jumpRequestedRef,
  jumpTargetRef,
  totalFrames,
  framesRef,
  isReady,
  activeAnnotation,
  nextAnnotation,
}: UseBoundaryFrameLoaderParams): void {
  const loadedChunksRef = useRef<Map<number, number[]>>(new Map())
  const requestedChunksRef = useRef<Map<number, Set<number>>>(new Map())
  const lastPreloadedAnnotationIdRef = useRef<number | null>(null)

  // eslint-disable-next-line max-lines-per-function -- Effect contains polling and preloading logic with multiple functions
  useEffect(() => {
    if (!isReady || !videoId || totalFrames === 0) return

    let cancelled = false
    let lastLoadedFrame = -1000 // Track last frame we loaded around
    let isLoading = false // Prevent concurrent executions
    let isPreloading = false // Track if we're preloading next annotation

    // eslint-disable-next-line complexity -- Main loading logic handles jump, progressive, and preload cases
    const loadFrameHierarchy = async () => {
      if (cancelled || isLoading) return

      // Check for pending jump FIRST (before debouncing)
      const isJump = jumpRequestedRef.current ?? false
      const jumpTarget = jumpTargetRef.current

      // Read current frame from ref (always gets latest value)
      const currentFrameIndex = currentFrameIndexRef.current ?? 0

      // Only reload if we've moved significantly (more than 3 frames)
      // Skip this check if there's a pending jump
      if (!isJump && Math.abs(currentFrameIndex - lastLoadedFrame) < 3) {
        return
      }

      isLoading = true
      const targetFrameIndex = currentFrameIndex // Capture at start, not end

      const encodedVideoId = encodeURIComponent(videoId)

      try {
        // If jumping, load exact frames around jump target FIRST, then navigate
        if (isJump && jumpTarget !== null && !isNaN(jumpTarget) && jumpTarget >= 0) {
          // Don't clear flag yet - wait until jump completes

          const finestQueue = buildQueueForModulo(
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
            updateCacheAfterLoad(
              batch,
              loadedChunksRef.current,
              requestedChunksRef.current,
              activeAnnotation,
              nextAnnotation
            )
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
          updateCacheAfterLoad(
            batch,
            loadedChunksRef.current,
            requestedChunksRef.current,
            activeAnnotation,
            nextAnnotation
          )
        }

        // Update lastLoadedFrame after successful load (use captured target, not current)
        lastLoadedFrame = targetFrameIndex
      } catch (error: unknown) {
        console.error('Failed to load frames:', error)
      } finally {
        isLoading = false
      }
    }

    // Preload next annotation frames in background (runs concurrently with main loading)
    // Note: This is background work and yields priority to explicit jumps
    const preloadNextAnnotation = async () => {
      if (cancelled || isPreloading || !nextAnnotation) return

      // Check if we've already preloaded this annotation
      if (lastPreloadedAnnotationIdRef.current === nextAnnotation.id) return

      // Yield priority to explicit user navigation (Jump to Frame, Prev button, etc.)
      // If a jump is requested, pause preloading until it completes
      if (jumpRequestedRef.current) {
        console.log('[useBoundaryFrameLoader] Deferring preload - jump in progress')
        return
      }

      isPreloading = true

      try {
        const encodedVideoId = encodeURIComponent(videoId)
        const queue = buildNextAnnotationQueue(
          nextAnnotation,
          totalFrames,
          loadedChunksRef.current,
          requestedChunksRef.current
        )

        console.log(
          `[useBoundaryFrameLoader] Preloading next annotation ${nextAnnotation.id} (${queue.length} chunks)`
        )

        // Process chunks in batches
        while (queue.length > 0) {
          if (cancelled) return

          // Yield priority to explicit jumps that occur during preloading
          if (jumpRequestedRef.current) {
            console.log('[useBoundaryFrameLoader] Pausing preload - jump requested')
            isPreloading = false
            return
          }

          const batch = queue.splice(0, MAX_CONCURRENT_REQUESTS)
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
          const allChunks = results.flatMap(r => r.chunks)
          await processLoadedChunks(allChunks, framesRef.current, batch[0]?.modulo ?? 1)
          updateCacheAfterLoad(
            batch,
            loadedChunksRef.current,
            requestedChunksRef.current,
            activeAnnotation,
            nextAnnotation
          )
        }

        lastPreloadedAnnotationIdRef.current = nextAnnotation.id
        console.log(
          `[useBoundaryFrameLoader] Preloading complete for annotation ${nextAnnotation.id}`
        )
      } catch (error: unknown) {
        console.error('Failed to preload next annotation:', error)
      } finally {
        isPreloading = false
      }
    }

    // Poll every 100ms to check if we need to load more frames
    const pollInterval = setInterval(() => {
      void loadFrameHierarchy()
    }, 100)

    // Initial load
    void loadFrameHierarchy()

    // Start preloading immediately (runs once per nextAnnotation change)
    // Effect will re-run when nextAnnotation changes, triggering new preload
    void preloadNextAnnotation()

    return () => {
      cancelled = true
      clearInterval(pollInterval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refs are stable and read inside effect via polling
  }, [totalFrames, videoId, isReady, nextAnnotation, activeAnnotation])
}
