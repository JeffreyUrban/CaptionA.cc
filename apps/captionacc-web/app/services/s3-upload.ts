/**
 * S3 Upload Service - Direct uploads using presigned URLs
 *
 * This service:
 * - Requests presigned upload URLs from Supabase Edge Function
 * - Uploads files directly to S3 (Wasabi) using XMLHttpRequest for progress tracking
 * - Supports cancellation via AbortController
 * - Implements retry logic with exponential backoff
 * - Returns videoId on successful upload completion
 *
 * The service replaces TUS resumable uploads with simpler S3 presigned URL uploads.
 * Presigned URLs expire (typically 1 hour), so failed uploads need new URLs.
 */

import { supabase } from '~/services/supabase-client'
import { RETRY_DELAYS, MAX_RETRIES } from '~/types/upload'
import { isRetryableError } from '~/utils/upload-helpers'

// ============================================================================
// Types
// ============================================================================

export interface PresignedUploadResponse {
  uploadUrl: string
  videoId: string
  storageKey: string
  expiresAt: string
}

export interface S3UploadOptions {
  file: File
  filename: string
  contentType: string
  folderPath?: string | null
  onProgress?: (bytesUploaded: number, progress: number) => void
  onError?: (error: Error) => void
  signal?: AbortSignal
}

export interface S3UploadResult {
  videoId: string
  storageKey: string
}

// ============================================================================
// Edge Function Communication
// ============================================================================

/**
 * Request a presigned upload URL from the Supabase Edge Function
 */
async function requestPresignedUrl(
  filename: string,
  contentType: string,
  sizeBytes: number,
  folderPath?: string | null
): Promise<PresignedUploadResponse> {
  // Get Supabase URL and JWT
  const supabaseUrl = import.meta.env['VITE_SUPABASE_URL']!

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    throw new Error('No authenticated session - please sign in')
  }

  const jwt = session.access_token

  // Call Edge Function
  const url = `${supabaseUrl}/functions/v1/captionacc-presigned-upload`

  console.log(`[S3Upload] Requesting presigned URL from: ${url}`)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename,
      contentType,
      sizeBytes,
      folderPath: folderPath ?? undefined,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to get presigned URL (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as PresignedUploadResponse

  console.log(`[S3Upload] Received presigned URL for video: ${data.videoId}`)

  return data
}

// ============================================================================
// S3 Upload with Progress
// ============================================================================

/**
 * Upload a file to S3 using a presigned URL with progress tracking
 * Uses XMLHttpRequest instead of fetch for progress events
 */
function uploadToS3(
  file: File,
  presignedUrl: string,
  contentType: string,
  onProgress?: (bytesUploaded: number, progress: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    // Handle abort signal
    const abortHandler = () => {
      xhr.abort()
      reject(new Error('Upload cancelled by user'))
    }

    if (signal) {
      if (signal.aborted) {
        reject(new Error('Upload cancelled by user'))
        return
      }
      signal.addEventListener('abort', abortHandler)
    }

    // Track progress
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable && onProgress) {
        const percentComplete = Math.round((e.loaded / e.total) * 100)
        onProgress(e.loaded, percentComplete)
      }
    })

    // Handle completion
    xhr.addEventListener('load', () => {
      if (signal) {
        signal.removeEventListener('abort', abortHandler)
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        console.log('[S3Upload] Upload to S3 completed successfully')
        resolve()
      } else {
        reject(new Error(`S3 upload failed with status ${xhr.status}: ${xhr.statusText}`))
      }
    })

    // Handle network errors
    xhr.addEventListener('error', () => {
      if (signal) {
        signal.removeEventListener('abort', abortHandler)
      }
      reject(new Error('Network error during S3 upload'))
    })

    // Handle abort
    xhr.addEventListener('abort', () => {
      if (signal) {
        signal.removeEventListener('abort', abortHandler)
      }
      reject(new Error('Upload cancelled'))
    })

    // Handle timeout
    xhr.addEventListener('timeout', () => {
      if (signal) {
        signal.removeEventListener('abort', abortHandler)
      }
      reject(new Error('Upload timeout'))
    })

    // Configure and send request
    xhr.open('PUT', presignedUrl)
    xhr.setRequestHeader('Content-Type', contentType)

    // Set timeout (10 minutes for large files)
    xhr.timeout = 10 * 60 * 1000

    xhr.send(file)
  })
}

// ============================================================================
// Main Upload Function with Retry
// ============================================================================

/**
 * Upload a file to S3 with retry logic
 *
 * Process:
 * 1. Request presigned URL from Edge Function (creates video entry in DB)
 * 2. Upload file directly to S3 using presigned URL
 * 3. Return videoId on success
 *
 * Note: Backend auto-detects new files and triggers processing workflow
 */
export async function uploadFileToS3(
  options: S3UploadOptions,
  retryCount = 0
): Promise<S3UploadResult> {
  const { file, filename, contentType, folderPath, onProgress, onError, signal } = options

  try {
    console.log(
      `[S3Upload] Starting upload for ${filename} (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`
    )

    // Step 1: Request presigned URL
    const presignedData = await requestPresignedUrl(filename, contentType, file.size, folderPath)

    // Check for cancellation before upload
    if (signal?.aborted) {
      throw new Error('Upload cancelled by user')
    }

    // Step 2: Upload to S3
    await uploadToS3(file, presignedData.uploadUrl, contentType, onProgress, signal)

    // Step 3: Return success
    console.log(`[S3Upload] Successfully uploaded ${filename} as video ${presignedData.videoId}`)

    return {
      videoId: presignedData.videoId,
      storageKey: presignedData.storageKey,
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    // Don't retry if cancelled by user
    if (err.message.includes('cancelled') || err.message.includes('abort')) {
      console.log(`[S3Upload] Upload cancelled for ${filename}`)
      throw err
    }

    // Check if we should retry
    if (retryCount < MAX_RETRIES && isRetryableError(err)) {
      const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)]

      console.warn(
        `[S3Upload] Upload failed for ${filename}, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`,
        err
      )

      if (onError) {
        onError(new Error(`Upload failed, retrying... (attempt ${retryCount + 1}/${MAX_RETRIES})`))
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delay))

      // Check for cancellation before retry
      if (signal?.aborted) {
        throw new Error('Upload cancelled by user')
      }

      // Retry upload (will request new presigned URL)
      return uploadFileToS3(options, retryCount + 1)
    } else {
      // Max retries exceeded or non-retryable error
      console.error(
        `[S3Upload] Upload failed for ${filename} after ${retryCount + 1} attempts:`,
        err
      )

      if (onError) {
        onError(err)
      }

      throw err
    }
  }
}

// ============================================================================
// Abort Controller Management
// ============================================================================

/**
 * Create an abort controller for cancellable uploads
 */
export function createUploadAbortController(): AbortController {
  return new AbortController()
}

/**
 * Cancel an upload using its abort controller
 */
export function cancelUpload(controller: AbortController): void {
  controller.abort()
}
