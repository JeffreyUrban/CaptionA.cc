/**
 * Database Loader
 *
 * Downloads and decompresses CR-SQLite databases from Wasabi S3.
 * Uses native DecompressionStream for efficient gzip decompression.
 *
 * Browser Support:
 * - Chrome 80+
 * - Safari 16.4+
 * - Firefox 105+
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

import {
  downloadError,
  decompressError,
  credentialsError,
  networkError,
  logDatabaseError,
  type DatabaseError,
} from './database-errors'

import { type DatabaseName, WASABI_CONFIG, buildStorageKey } from '~/config'

// =============================================================================
// Types
// =============================================================================

/**
 * Progress callback for download operations.
 */
export type DownloadProgressCallback = (progress: DownloadProgress) => void

/**
 * Download progress information.
 */
export interface DownloadProgress {
  /** Current phase of the download */
  phase: 'downloading' | 'decompressing' | 'complete' | 'error'
  /** Bytes downloaded so far */
  bytesDownloaded: number
  /** Total bytes to download (if known) */
  totalBytes: number | null
  /** Progress percentage (0-100) */
  percent: number
  /** Error message if phase is 'error' */
  error?: string
}

/**
 * S3 credentials for Wasabi access.
 */
export interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  expiration?: Date
}

/**
 * Download result containing the decompressed database.
 */
export interface DownloadResult {
  /** Decompressed database bytes */
  data: Uint8Array
  /** ETag for cache validation */
  etag?: string
  /** Last modified timestamp */
  lastModified?: Date
}

// =============================================================================
// Credential Management
// =============================================================================

/** Cached credentials */
let cachedCredentials: S3Credentials | null = null
let credentialsExpiry: Date | null = null

/**
 * Get S3 credentials for Wasabi access.
 * Fetches from Supabase Edge Function and caches until expiration.
 *
 * @param forceRefresh Force refresh even if cached credentials are valid
 * @returns S3 credentials
 * @throws DatabaseError if credentials cannot be obtained
 */
export async function getS3Credentials(forceRefresh = false): Promise<S3Credentials> {
  // Check if we have valid cached credentials
  if (!forceRefresh && cachedCredentials && credentialsExpiry) {
    // Refresh if less than 5 minutes until expiry
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000)
    if (credentialsExpiry > fiveMinutesFromNow) {
      return cachedCredentials
    }
  }

  try {
    // Fetch new credentials from Supabase Edge Function
    const supabaseUrl = import.meta.env['VITE_SUPABASE_URL']
    if (!supabaseUrl) {
      throw new Error('VITE_SUPABASE_URL not configured')
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/captionacc-s3-credentials`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // Include auth token if available
        ...(await getAuthHeaders()),
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch credentials: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    cachedCredentials = {
      accessKeyId: data.accessKeyId,
      secretAccessKey: data.secretAccessKey,
      sessionToken: data.sessionToken,
      expiration: data.expiration ? new Date(data.expiration) : undefined,
    }

    credentialsExpiry = cachedCredentials.expiration ?? new Date(Date.now() + 60 * 60 * 1000)

    console.log('[DatabaseLoader] Credentials refreshed, expires:', credentialsExpiry)
    return cachedCredentials
  } catch (error) {
    const dbError = credentialsError(error)
    logDatabaseError(dbError)
    throw dbError
  }
}

/**
 * Get auth headers for Edge Function requests.
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  // Try to get the current session from Supabase
  try {
    const { supabase } = await import('./supabase-client')
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (session?.access_token) {
      return {
        Authorization: `Bearer ${session.access_token}`,
      }
    }
  } catch {
    // Ignore errors, proceed without auth
  }

  return {}
}

/**
 * Clear cached credentials.
 * Call this when credentials are invalid or user logs out.
 */
export function clearCredentials(): void {
  cachedCredentials = null
  credentialsExpiry = null
}

// =============================================================================
// S3 Client
// =============================================================================

/**
 * Create an S3 client for Wasabi.
 */
async function createS3Client(): Promise<S3Client> {
  const credentials = await getS3Credentials()

  return new S3Client({
    endpoint: WASABI_CONFIG.ENDPOINT,
    region: WASABI_CONFIG.REGION,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
    forcePathStyle: true,
  })
}

// =============================================================================
// Download Functions
// =============================================================================

/**
 * Download and decompress a database from Wasabi.
 *
 * @param tenantId Tenant UUID
 * @param videoId Video UUID
 * @param dbName Database name
 * @param onProgress Progress callback
 * @returns Download result with decompressed data
 * @throws DatabaseError if download or decompression fails
 */
export async function downloadDatabase(
  tenantId: string,
  videoId: string,
  dbName: DatabaseName,
  onProgress?: DownloadProgressCallback
): Promise<DownloadResult> {
  const storageKey = buildStorageKey(tenantId, videoId, dbName)

  // Report initial progress
  onProgress?.({
    phase: 'downloading',
    bytesDownloaded: 0,
    totalBytes: null,
    percent: 0,
  })

  try {
    const client = await createS3Client()

    const command = new GetObjectCommand({
      Bucket: WASABI_CONFIG.BUCKET,
      Key: storageKey,
    })

    const response = await client.send(command)

    if (!response.Body) {
      throw new Error('Empty response body')
    }

    // Get content length for progress tracking
    const totalBytes = response.ContentLength ?? null

    // Convert response to stream
    const responseStream = response.Body as ReadableStream<Uint8Array>

    // Download with progress tracking
    const compressedData = await downloadWithProgress(responseStream, totalBytes, onProgress)

    // Report decompression phase
    onProgress?.({
      phase: 'decompressing',
      bytesDownloaded: compressedData.length,
      totalBytes: compressedData.length,
      percent: 100,
    })

    // Decompress the data
    const decompressedData = await decompressGzip(compressedData)

    // Report completion
    onProgress?.({
      phase: 'complete',
      bytesDownloaded: decompressedData.length,
      totalBytes: decompressedData.length,
      percent: 100,
    })

    console.log(
      `[DatabaseLoader] Downloaded and decompressed ${storageKey}: ` +
        `${compressedData.length} -> ${decompressedData.length} bytes`
    )

    return {
      data: decompressedData,
      etag: response.ETag,
      lastModified: response.LastModified,
    }
  } catch (error) {
    onProgress?.({
      phase: 'error',
      bytesDownloaded: 0,
      totalBytes: null,
      percent: 0,
      error: error instanceof Error ? error.message : 'Download failed',
    })

    // Check if it's a credentials error (needs refresh)
    if (error instanceof Error && error.message.includes('credentials')) {
      clearCredentials()
      const dbError = credentialsError(error)
      logDatabaseError(dbError)
      throw dbError
    }

    // Check if it's a network error
    if (
      error instanceof Error &&
      (error.message.includes('network') ||
        error.message.includes('fetch') ||
        error.name === 'NetworkError')
    ) {
      const dbError = networkError(error)
      logDatabaseError(dbError)
      throw dbError
    }

    const dbError = downloadError(storageKey, error)
    logDatabaseError(dbError)
    throw dbError
  }
}

/**
 * Download a stream with progress tracking.
 */
async function downloadWithProgress(
  stream: ReadableStream<Uint8Array>,
  totalBytes: number | null,
  onProgress?: DownloadProgressCallback
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let bytesDownloaded = 0

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      chunks.push(value)
      bytesDownloaded += value.length

      // Report progress
      if (onProgress) {
        const percent = totalBytes ? Math.round((bytesDownloaded / totalBytes) * 100) : 0

        onProgress({
          phase: 'downloading',
          bytesDownloaded,
          totalBytes,
          percent,
        })
      }
    }

    // Concatenate chunks into single array
    const result = new Uint8Array(bytesDownloaded)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return result
  } finally {
    reader.releaseLock()
  }
}

// =============================================================================
// Decompression
// =============================================================================

/**
 * Decompress gzip data using native DecompressionStream.
 *
 * @param compressedData Gzip compressed data
 * @returns Decompressed data
 * @throws DatabaseError if decompression fails
 */
export async function decompressGzip(compressedData: Uint8Array): Promise<Uint8Array> {
  // Check for DecompressionStream support
  if (typeof DecompressionStream === 'undefined') {
    throw decompressError(new Error('DecompressionStream not supported in this browser'))
  }

  try {
    // Create decompression stream
    const ds = new DecompressionStream('gzip')

    // Create a readable stream from the compressed data
    const inputStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(compressedData)
        controller.close()
      },
    })

    // Pipe through decompression
    // Cast to work around TypeScript's strict typing for DecompressionStream
    const decompressedStream = inputStream.pipeThrough(
      ds as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
    )

    // Read all decompressed data
    const reader = decompressedStream.getReader()
    const chunks: Uint8Array[] = []
    let totalLength = 0

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      chunks.push(value)
      totalLength += value.length
    }

    // Concatenate into single array
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return result
  } catch (error) {
    const dbError = decompressError(error)
    logDatabaseError(dbError)
    throw dbError
  }
}

// =============================================================================
// Retry Logic
// =============================================================================

/**
 * Options for retry logic.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries?: number
  /** Initial delay between retries in ms */
  initialDelay?: number
  /** Maximum delay between retries in ms */
  maxDelay?: number
  /** Backoff multiplier */
  backoffMultiplier?: number
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
}

/**
 * Download a database with automatic retry on failure.
 *
 * @param tenantId Tenant UUID
 * @param videoId Video UUID
 * @param dbName Database name
 * @param onProgress Progress callback
 * @param options Retry options
 * @returns Download result with decompressed data
 * @throws DatabaseError if all retries fail
 */
export async function downloadDatabaseWithRetry(
  tenantId: string,
  videoId: string,
  dbName: DatabaseName,
  onProgress?: DownloadProgressCallback,
  options?: RetryOptions
): Promise<DownloadResult> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options }
  let lastError: DatabaseError | undefined
  let delay = opts.initialDelay

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await downloadDatabase(tenantId, videoId, dbName, onProgress)
    } catch (error) {
      lastError = error as DatabaseError

      // Don't retry on non-recoverable errors
      if (!lastError.recoverable) {
        throw lastError
      }

      // Don't retry on last attempt
      if (attempt === opts.maxRetries) {
        throw lastError
      }

      console.log(
        `[DatabaseLoader] Download failed (attempt ${attempt + 1}/${opts.maxRetries + 1}), ` +
          `retrying in ${delay}ms...`
      )

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delay))

      // Increase delay for next attempt
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelay)

      // Clear credentials on auth errors before retry
      if (lastError.code === 'CREDENTIALS_FAILED') {
        clearCredentials()
      }
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError
}

// =============================================================================
// Cache Management
// =============================================================================

/**
 * Check if a database is cached in IndexedDB.
 * Note: This checks the wa-sqlite VFS cache, not S3.
 *
 * @param videoId Video UUID
 * @param dbName Database name
 * @returns True if cached locally
 */
export async function isDatabaseCached(videoId: string, dbName: DatabaseName): Promise<boolean> {
  const filename = `${videoId}_${dbName}.db`

  // Check IndexedDB for the database file
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('captionacc-vfs', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })

    // Check if the database file exists in the store
    const transaction = db.transaction(['files'], 'readonly')
    const store = transaction.objectStore('files')
    const request = store.get(filename)

    return new Promise(resolve => {
      request.onsuccess = () => resolve(request.result !== undefined)
      request.onerror = () => resolve(false)
    })
  } catch {
    return false
  }
}

/**
 * Clear cached database from IndexedDB.
 *
 * @param videoId Video UUID
 * @param dbName Database name
 */
export async function clearDatabaseCache(videoId: string, dbName: DatabaseName): Promise<void> {
  const filename = `${videoId}_${dbName}.db`

  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('captionacc-vfs', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })

    const transaction = db.transaction(['files'], 'readwrite')
    const store = transaction.objectStore('files')
    store.delete(filename)

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })

    console.log(`[DatabaseLoader] Cleared cache for ${filename}`)
  } catch (error) {
    console.warn(`[DatabaseLoader] Failed to clear cache for ${filename}:`, error)
  }
}
