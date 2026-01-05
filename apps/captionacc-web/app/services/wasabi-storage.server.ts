/**
 * Wasabi Storage Service - Generate signed URLs for VP9 frame chunks
 *
 * This service:
 * - Generates presigned URLs for Wasabi S3-compatible storage
 * - Supports batch URL generation for efficient frame loading
 * - Uses temporary user ID (default_user) until Supabase auth integration
 */

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'

// Environment configuration
const WASABI_REGION = process.env['WASABI_REGION'] || 'us-east-1'
const WASABI_ENDPOINT = `https://s3.${WASABI_REGION}.wasabisys.com`
const WASABI_BUCKET = process.env['WASABI_BUCKET'] || 'caption-acc-prod'
const ENVIRONMENT = process.env['ENVIRONMENT'] || 'dev'

// Initialize S3 client
const s3Client = new S3Client({
  region: WASABI_REGION,
  endpoint: WASABI_ENDPOINT,
  credentials: {
    accessKeyId: process.env['WASABI_ACCESS_KEY'] || '',
    secretAccessKey: process.env['WASABI_SECRET_KEY'] || '',
  },
  forcePathStyle: true, // Required for Wasabi - use path-style URLs instead of virtual-hosted-style
})

// Constants
const SIGNED_URL_EXPIRY = 3600 // 1 hour
const PLACEHOLDER_USER_ID = 'default_user' // TODO: Replace with session.user.id after Supabase auth

/**
 * Build S3 key for a frame chunk
 */
export function buildChunkKey(
  videoId: string,
  modulo: number,
  chunkIndex: number,
  userId: string = PLACEHOLDER_USER_ID
): string {
  const chunkFileName = `chunk_${chunkIndex.toString().padStart(10, '0')}.webm`
  return `${ENVIRONMENT}/users/${userId}/videos/${videoId}/cropped_frames/modulo_${modulo}/${chunkFileName}`
}

/**
 * Generate a signed URL for a single chunk
 */
export async function generateSignedUrl(
  videoId: string,
  modulo: number,
  chunkIndex: number,
  userId: string = PLACEHOLDER_USER_ID
): Promise<string> {
  const key = buildChunkKey(videoId, modulo, chunkIndex, userId)

  const command = new GetObjectCommand({
    Bucket: WASABI_BUCKET,
    Key: key,
  })

  return await getSignedUrl(s3Client, command, { expiresIn: SIGNED_URL_EXPIRY })
}

/**
 * Generate signed URLs for multiple chunks in batch
 */
export async function generateBatchSignedUrls(
  videoId: string,
  modulo: number,
  chunkIndices: number[],
  userId: string = PLACEHOLDER_USER_ID
): Promise<Array<{ chunkIndex: number; signedUrl: string }>> {
  const promises = chunkIndices.map(async chunkIndex => ({
    chunkIndex,
    signedUrl: await generateSignedUrl(videoId, modulo, chunkIndex, userId),
  }))

  return await Promise.all(promises)
}

/**
 * List all chunks for a video at a specific modulo level
 */
export async function listChunks(
  videoId: string,
  modulo: number,
  userId: string = PLACEHOLDER_USER_ID
): Promise<number[]> {
  const prefix = `${ENVIRONMENT}/users/${userId}/videos/${videoId}/cropped_frames/modulo_${modulo}/`

  const command = new ListObjectsV2Command({
    Bucket: WASABI_BUCKET,
    Prefix: prefix,
  })

  const response = await s3Client.send(command)

  if (!response.Contents) {
    return []
  }

  // Extract chunk indices from filenames
  const chunkIndices: number[] = []
  for (const obj of response.Contents) {
    if (!obj.Key) continue

    const match = obj.Key.match(/chunk_(\d+)\.webm$/)
    if (match && match[1]) {
      chunkIndices.push(parseInt(match[1], 10))
    }
  }

  return chunkIndices.sort((a, b) => a - b)
}

/**
 * Get metadata about available chunks for a video
 */
export async function getVideoChunkMetadata(
  videoId: string,
  userId: string = PLACEHOLDER_USER_ID
): Promise<{
  modulo_16: number[]
  modulo_4: number[]
  modulo_1: number[]
}> {
  const [modulo16, modulo4, modulo1] = await Promise.all([
    listChunks(videoId, 16, userId),
    listChunks(videoId, 4, userId),
    listChunks(videoId, 1, userId),
  ])

  return {
    modulo_16: modulo16,
    modulo_4: modulo4,
    modulo_1: modulo1,
  }
}
