/**
 * Frame Cache - LRU cache for frame images
 *
 * Provides:
 * - LRU eviction when cache size exceeds 60MB
 * - Pin/unpin frames to prevent eviction (for active annotation)
 * - Blob URL management with automatic cleanup
 * - Memory-efficient tracking of cache size
 *
 * Cache Entry:
 * - frameIndex: Frame number
 * - imageUrl: Blob URL for the image
 * - modulo: Modulo level (1, 4, or 16)
 * - timestamp: Last access time (for LRU)
 * - pinned: Whether frame is pinned (prevents eviction)
 * - sizeBytes: Estimated size in bytes
 */

// ============================================================================
// Types
// ============================================================================

export interface FrameCacheEntry {
  frameIndex: number
  imageUrl: string // Blob URL
  modulo: number
  timestamp: number
  pinned: boolean
  sizeBytes: number
}

export interface FrameCacheStats {
  totalEntries: number
  totalSizeBytes: number
  pinnedEntries: number
  maxSizeBytes: number
}

// ============================================================================
// Constants
// ============================================================================

const MAX_CACHE_SIZE_BYTES = 60 * 1024 * 1024 // 60MB

// ============================================================================
// Cache Implementation
// ============================================================================

class FrameCache {
  private cache: Map<number, FrameCacheEntry>
  private totalSizeBytes: number

  constructor() {
    this.cache = new Map()
    this.totalSizeBytes = 0
  }

  /**
   * Get frame from cache
   */
  get(frameIndex: number): FrameCacheEntry | null {
    const entry = this.cache.get(frameIndex)

    if (!entry) {
      return null
    }

    // Update timestamp (LRU)
    entry.timestamp = Date.now()

    return entry
  }

  /**
   * Set frame in cache
   */
  set(frameIndex: number, imageUrl: string, modulo: number, sizeBytes: number): void {
    // Check if frame already exists
    const existing = this.cache.get(frameIndex)

    if (existing) {
      // Update existing entry
      // Revoke old blob URL
      URL.revokeObjectURL(existing.imageUrl)

      // Update size tracking
      this.totalSizeBytes -= existing.sizeBytes
      this.totalSizeBytes += sizeBytes

      // Update entry
      existing.imageUrl = imageUrl
      existing.modulo = modulo
      existing.timestamp = Date.now()
      existing.sizeBytes = sizeBytes

      return
    }

    // Add new entry
    const entry: FrameCacheEntry = {
      frameIndex,
      imageUrl,
      modulo,
      timestamp: Date.now(),
      pinned: false,
      sizeBytes,
    }

    this.cache.set(frameIndex, entry)
    this.totalSizeBytes += sizeBytes

    // Evict LRU entries if over size limit
    this.evictIfNeeded()
  }

  /**
   * Pin frame to prevent eviction
   */
  pin(frameIndex: number): void {
    const entry = this.cache.get(frameIndex)

    if (entry) {
      entry.pinned = true
    }
  }

  /**
   * Unpin frame (allow eviction)
   */
  unpin(frameIndex: number): void {
    const entry = this.cache.get(frameIndex)

    if (entry) {
      entry.pinned = false
    }
  }

  /**
   * Remove frame from cache
   */
  remove(frameIndex: number): void {
    const entry = this.cache.get(frameIndex)

    if (entry) {
      // Revoke blob URL
      URL.revokeObjectURL(entry.imageUrl)

      // Update size tracking
      this.totalSizeBytes -= entry.sizeBytes

      // Remove from cache
      this.cache.delete(frameIndex)
    }
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    // Revoke all blob URLs
    for (const entry of this.cache.values()) {
      URL.revokeObjectURL(entry.imageUrl)
    }

    // Clear cache
    this.cache.clear()
    this.totalSizeBytes = 0
  }

  /**
   * Evict LRU entries until cache size is under limit
   */
  private evictIfNeeded(): void {
    if (this.totalSizeBytes <= MAX_CACHE_SIZE_BYTES) {
      return
    }

    // Sort entries by timestamp (oldest first)
    const entries = Array.from(this.cache.entries())
      .map(([frameIndex, entry]) => ({ frameIndex, entry }))
      .sort((a, b) => a.entry.timestamp - b.entry.timestamp)

    // Evict unpinned entries until under limit
    for (const { frameIndex, entry } of entries) {
      if (this.totalSizeBytes <= MAX_CACHE_SIZE_BYTES) {
        break
      }

      // Skip pinned entries
      if (entry.pinned) {
        continue
      }

      // Evict entry
      this.remove(frameIndex)
    }

    // If still over limit and all remaining entries are pinned, log warning
    if (this.totalSizeBytes > MAX_CACHE_SIZE_BYTES) {
      console.warn(
        `[FrameCache] Cache size (${this.totalSizeBytes} bytes) exceeds limit but all entries are pinned`
      )
    }
  }

  /**
   * Evict LRU entry (manually trigger eviction)
   */
  evictLRU(): void {
    // Find oldest unpinned entry
    let oldestEntry: { frameIndex: number; timestamp: number } | null = null

    for (const [frameIndex, entry] of this.cache.entries()) {
      if (entry.pinned) {
        continue
      }

      if (!oldestEntry || entry.timestamp < oldestEntry.timestamp) {
        oldestEntry = { frameIndex, timestamp: entry.timestamp }
      }
    }

    // Evict oldest entry
    if (oldestEntry) {
      this.remove(oldestEntry.frameIndex)
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): FrameCacheStats {
    let pinnedEntries = 0

    for (const entry of this.cache.values()) {
      if (entry.pinned) {
        pinnedEntries++
      }
    }

    return {
      totalEntries: this.cache.size,
      totalSizeBytes: this.totalSizeBytes,
      pinnedEntries,
      maxSizeBytes: MAX_CACHE_SIZE_BYTES,
    }
  }

  /**
   * Get all cached frame indices
   */
  getCachedFrames(): number[] {
    return Array.from(this.cache.keys())
  }

  /**
   * Check if frame is cached
   */
  has(frameIndex: number): boolean {
    return this.cache.has(frameIndex)
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

const frameCache = new FrameCache()

// ============================================================================
// Public API
// ============================================================================

/**
 * Get frame from cache
 */
export function getFrame(frameIndex: number): FrameCacheEntry | null {
  return frameCache.get(frameIndex)
}

/**
 * Set frame in cache
 *
 * @param frameIndex Frame number
 * @param imageUrl Blob URL for the image
 * @param modulo Modulo level (1, 4, or 16)
 * @param sizeBytes Estimated size in bytes
 */
export function setFrame(
  frameIndex: number,
  imageUrl: string,
  modulo: number,
  sizeBytes: number
): void {
  frameCache.set(frameIndex, imageUrl, modulo, sizeBytes)
}

/**
 * Pin frame to prevent eviction
 */
export function pinFrame(frameIndex: number): void {
  frameCache.pin(frameIndex)
}

/**
 * Unpin frame (allow eviction)
 */
export function unpinFrame(frameIndex: number): void {
  frameCache.unpin(frameIndex)
}

/**
 * Remove frame from cache
 */
export function removeFrame(frameIndex: number): void {
  frameCache.remove(frameIndex)
}

/**
 * Clear entire cache
 */
export function clearFrameCache(): void {
  frameCache.clear()
}

/**
 * Evict LRU entry
 */
export function evictLRU(): void {
  frameCache.evictLRU()
}

/**
 * Get cache statistics
 */
export function getFrameCacheStats(): FrameCacheStats {
  return frameCache.getStats()
}

/**
 * Get all cached frame indices
 */
export function getCachedFrames(): number[] {
  return frameCache.getCachedFrames()
}

/**
 * Check if frame is cached
 */
export function hasFrame(frameIndex: number): boolean {
  return frameCache.has(frameIndex)
}

/**
 * Helper: Create blob URL from bytes
 */
export function createBlobUrl(bytes: Uint8Array, mimeType = 'image/jpeg'): string {
  const blob = new Blob([bytes as BlobPart], { type: mimeType })
  return URL.createObjectURL(blob)
}

/**
 * Helper: Estimate size of blob URL
 *
 * Since blob URLs don't expose size directly, we estimate based on the bytes array
 */
export function estimateBlobSize(bytes: Uint8Array): number {
  return bytes.byteLength
}
