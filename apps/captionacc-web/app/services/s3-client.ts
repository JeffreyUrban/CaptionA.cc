/**
 * S3 Client - Wrapper for AWS SDK S3Client with STS credentials
 *
 * Provides:
 * - S3Client initialization with STS credentials
 * - Retry logic with exponential backoff
 * - Path builders for S3 keys
 * - Helper methods for common operations
 * - Typed error handling
 */

import { S3Client, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { getS3Credentials, refreshS3Credentials } from './s3-credentials'
import { getUserTenantId, getCurrentUser } from './supabase-client'

// ============================================================================
// Types
// ============================================================================

export interface S3PathParams {
  tenantId: string
  videoId: string
  type: 'video' | 'layout' | 'captions' | 'full_frames' | 'cropped_frames'
  filename?: string
  modulo?: number
  chunkIndex?: number
  croppedFramesVersion?: number
}

export interface S3ClientConfig {
  bucket: string
  region: string
  endpoint: string
  credentials: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken: string
  }
}

// ============================================================================
// Custom Errors
// ============================================================================

export class CredentialsExpiredError extends Error {
  constructor(message = 'S3 credentials have expired') {
    super(message)
    this.name = 'CredentialsExpiredError'
  }
}

export class AccessDeniedError extends Error {
  constructor(message = 'Access denied to S3 resource') {
    super(message)
    this.name = 'AccessDeniedError'
  }
}

export class NotFoundError extends Error {
  constructor(message = 'S3 resource not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class RetryExhaustedError extends Error {
  constructor(message = 'Maximum retry attempts exhausted') {
    super(message)
    this.name = 'RetryExhaustedError'
  }
}

// ============================================================================
// Retry Logic
// ============================================================================

const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY_MS = 1000

interface RetryConfig {
  maxRetries?: number
  initialDelay?: number
}

/**
 * Retry a function with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const maxRetries = config.maxRetries ?? MAX_RETRIES
  const initialDelay = config.initialDelay ?? INITIAL_RETRY_DELAY_MS

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry on certain errors
      if (error instanceof AccessDeniedError || error instanceof NotFoundError) {
        throw error
      }

      // Refresh credentials on expired credentials error
      if (error instanceof CredentialsExpiredError) {
        await refreshS3Credentials()
        // Continue to retry with fresh credentials
      }

      // Check if should retry
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      // Max retries exhausted
      throw new RetryExhaustedError(
        `Failed after ${maxRetries} retries: ${lastError.message}`
      )
    }
  }

  throw lastError ?? new Error('Unknown error')
}

// ============================================================================
// S3 Client Factory
// ============================================================================

let s3ClientInstance: S3Client | null = null
let s3ClientConfig: S3ClientConfig | null = null

/**
 * Get or create S3Client with current credentials
 */
async function getS3Client(): Promise<{ client: S3Client; config: S3ClientConfig }> {
  const credentials = await getS3Credentials()

  const newConfig: S3ClientConfig = {
    bucket: credentials.bucket,
    region: credentials.region,
    endpoint: credentials.endpoint,
    credentials: credentials.credentials,
  }

  // Check if we need to recreate client (credentials changed)
  const needsRecreate =
    !s3ClientInstance ||
    !s3ClientConfig ||
    s3ClientConfig.credentials.sessionToken !== newConfig.credentials.sessionToken

  if (needsRecreate) {
    s3ClientInstance = new S3Client({
      region: newConfig.region,
      endpoint: newConfig.endpoint,
      credentials: newConfig.credentials,
      forcePathStyle: true, // Required for Wasabi
    })
    s3ClientConfig = newConfig
  }

  // At this point both are guaranteed to be non-null
  if (!s3ClientInstance || !s3ClientConfig) {
    throw new Error('Failed to initialize S3 client')
  }

  return { client: s3ClientInstance, config: s3ClientConfig }
}

/**
 * Parse S3 error and throw appropriate custom error
 */
function handleS3Error(error: unknown): never {
  if (error instanceof Error) {
    const errorName = (error as { name?: string }).name

    if (errorName === 'NoSuchKey') {
      throw new NotFoundError(error.message)
    }

    if (errorName === 'AccessDenied' || errorName === 'Forbidden') {
      throw new AccessDeniedError(error.message)
    }

    if (errorName === 'ExpiredToken' || errorName === 'InvalidToken') {
      throw new CredentialsExpiredError(error.message)
    }

    throw error
  }

  throw new Error(String(error))
}

// ============================================================================
// Path Builders
// ============================================================================

/**
 * Build S3 path for a resource
 *
 * Examples:
 * - Video: {tenant_id}/client/videos/{video_id}/video.mp4
 * - Layout DB: {tenant_id}/client/videos/{video_id}/layout.db.gz
 * - Full frame: {tenant_id}/client/videos/{video_id}/full_frames/frame_0001.jpg
 * - Cropped frame: {tenant_id}/client/videos/{video_id}/cropped_frames_v2/modulo_16/chunk_0001.webm
 */
export function buildS3Path(params: S3PathParams): string {
  const { tenantId, videoId, type } = params

  const basePath = `${tenantId}/client/videos/${videoId}`

  switch (type) {
    case 'video':
      return `${basePath}/video.mp4`

    case 'layout':
      return `${basePath}/layout.db.gz`

    case 'captions':
      return `${basePath}/captions.db.gz`

    case 'full_frames':
      if (!params.filename) {
        throw new Error('filename required for full_frames type')
      }
      return `${basePath}/full_frames/${params.filename}`

    case 'cropped_frames': {
      const version = params.croppedFramesVersion ?? 2
      const modulo = params.modulo ?? 1
      const chunkIndex = params.chunkIndex

      if (chunkIndex === undefined) {
        throw new Error('chunkIndex required for cropped_frames type')
      }

      const chunkFilename = `chunk_${String(chunkIndex).padStart(4, '0')}.webm`
      return `${basePath}/cropped_frames_v${version}/modulo_${modulo}/${chunkFilename}`
    }

    default:
      throw new Error(`Unknown S3 path type: ${type}`)
  }
}

/**
 * Build S3 path prefix for listing objects
 */
export function buildS3PathPrefix(params: Omit<S3PathParams, 'filename' | 'chunkIndex'>): string {
  const { tenantId, videoId, type } = params

  const basePath = `${tenantId}/client/videos/${videoId}`

  switch (type) {
    case 'full_frames':
      return `${basePath}/full_frames/`

    case 'cropped_frames': {
      const version = params.croppedFramesVersion ?? 2
      const modulo = params.modulo ?? 1
      return `${basePath}/cropped_frames_v${version}/modulo_${modulo}/`
    }

    default:
      return `${basePath}/`
  }
}

// ============================================================================
// S3 Operations
// ============================================================================

/**
 * Get object from S3 (raw bytes)
 */
export async function getObject(key: string): Promise<Uint8Array> {
  return withRetry(async () => {
    try {
      const { client, config } = await getS3Client()

      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })

      const response = await client.send(command)

      if (!response.Body) {
        throw new NotFoundError(`Empty response body for key: ${key}`)
      }

      const bytes = await response.Body.transformToByteArray()
      return bytes
    } catch (error) {
      handleS3Error(error)
    }
  })
}

/**
 * Get signed URL for object (for image/video elements)
 *
 * @param key S3 object key
 * @param expiresIn URL expiration in seconds (default: 1 hour)
 */
export async function getObjectUrl(key: string, expiresIn = 3600): Promise<string> {
  return withRetry(async () => {
    try {
      const { client, config } = await getS3Client()

      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })

      const url = await getSignedUrl(client, command, { expiresIn })
      return url
    } catch (error) {
      handleS3Error(error)
    }
  })
}

/**
 * Get object metadata (without downloading content)
 */
export async function headObject(
  key: string
): Promise<{ contentLength: number; contentType: string | undefined; lastModified: Date | undefined }> {
  return withRetry(async () => {
    try {
      const { client, config } = await getS3Client()

      const command = new HeadObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })

      const response = await client.send(command)

      return {
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType,
        lastModified: response.LastModified,
      }
    } catch (error) {
      handleS3Error(error)
    }
  })
}

/**
 * List objects with prefix
 */
export async function listObjects(prefix: string, maxKeys = 1000): Promise<string[]> {
  return withRetry(async () => {
    try {
      const { client, config } = await getS3Client()

      const command = new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
      })

      const response = await client.send(command)

      const keys = (response.Contents ?? []).map(obj => obj.Key).filter((key): key is string => !!key)

      return keys
    } catch (error) {
      handleS3Error(error)
    }
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get current user's tenant ID (for path building)
 */
export async function getCurrentTenantId(): Promise<string> {
  const user = await getCurrentUser()

  if (!user) {
    throw new Error('No authenticated user')
  }

  const tenantId = await getUserTenantId(user.id)

  if (!tenantId) {
    throw new Error('User has no tenant ID')
  }

  return tenantId
}

/**
 * Build and get signed URL for a video resource
 */
export async function getVideoResourceUrl(
  videoId: string,
  type: S3PathParams['type'],
  params?: Partial<S3PathParams>,
  expiresIn = 3600
): Promise<string> {
  const tenantId = await getCurrentTenantId()

  const key = buildS3Path({
    tenantId,
    videoId,
    type,
    ...params,
  } as S3PathParams)

  return getObjectUrl(key, expiresIn)
}

/**
 * Check if object exists in S3
 */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await headObject(key)
    return true
  } catch (error) {
    if (error instanceof NotFoundError) {
      return false
    }
    throw error
  }
}
