/**
 * Thumbnail Upload Service
 *
 * Handles thumbnail uploads to Supabase Storage:
 * - Upload thumbnail images to 'thumbnails' bucket
 * - Get public URLs for thumbnails
 * - Delete thumbnails when videos are removed
 */

import { supabase } from './supabase-client'

const THUMBNAILS_BUCKET = 'thumbnails'

interface UploadThumbnailOptions {
  tenantId: string
  videoId: string
  file: File | Blob
  filename?: string
}

interface ThumbnailUploadResult {
  storageKey: string
  publicUrl: string
}

/**
 * Generate storage path for thumbnail
 * Format: {tenant_id}/{video_id}/thumbnail.jpg
 */
function getThumbnailStoragePath(tenantId: string, videoId: string, filename?: string): string {
  const name = filename || 'thumbnail.jpg'
  return `${tenantId}/${videoId}/${name}`
}

/**
 * Upload a thumbnail to Supabase Storage
 *
 * @param options - Upload options including tenant ID, video ID, and file
 * @returns Storage key and public URL for the uploaded thumbnail
 */
export async function uploadThumbnail(
  options: UploadThumbnailOptions
): Promise<ThumbnailUploadResult> {
  const { tenantId, videoId, file, filename } = options

  const storagePath = getThumbnailStoragePath(tenantId, videoId, filename)

  // Upload to Supabase Storage
  const { data, error } = await supabase.storage.from(THUMBNAILS_BUCKET).upload(storagePath, file, {
    contentType: file.type || 'image/jpeg',
    upsert: true, // Overwrite if exists
  })

  if (error) {
    throw new Error(`Failed to upload thumbnail: ${error.message}`)
  }

  // Get public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from(THUMBNAILS_BUCKET).getPublicUrl(storagePath)

  return {
    storageKey: data.path,
    publicUrl,
  }
}

/**
 * Get public URL for an existing thumbnail
 *
 * @param tenantId - Tenant ID
 * @param videoId - Video ID
 * @param filename - Optional filename (defaults to 'thumbnail.jpg')
 * @returns Public URL for the thumbnail
 */
export function getThumbnailUrl(tenantId: string, videoId: string, filename?: string): string {
  const storagePath = getThumbnailStoragePath(tenantId, videoId, filename)
  const {
    data: { publicUrl },
  } = supabase.storage.from(THUMBNAILS_BUCKET).getPublicUrl(storagePath)
  return publicUrl
}

/**
 * Delete a thumbnail from storage
 *
 * @param tenantId - Tenant ID
 * @param videoId - Video ID
 * @param filename - Optional filename (defaults to 'thumbnail.jpg')
 */
export async function deleteThumbnail(
  tenantId: string,
  videoId: string,
  filename?: string
): Promise<void> {
  const storagePath = getThumbnailStoragePath(tenantId, videoId, filename)

  const { error } = await supabase.storage.from(THUMBNAILS_BUCKET).remove([storagePath])

  if (error) {
    throw new Error(`Failed to delete thumbnail: ${error.message}`)
  }
}

/**
 * Delete all thumbnails for a video
 *
 * @param tenantId - Tenant ID
 * @param videoId - Video ID
 */
export async function deleteAllVideoThumbnails(tenantId: string, videoId: string): Promise<void> {
  const folderPath = `${tenantId}/${videoId}`

  // List all files in the video's thumbnail folder
  const { data: files, error: listError } = await supabase.storage
    .from(THUMBNAILS_BUCKET)
    .list(folderPath)

  if (listError) {
    throw new Error(`Failed to list thumbnails: ${listError.message}`)
  }

  if (!files || files.length === 0) {
    return // No thumbnails to delete
  }

  // Delete all files
  const filePaths = files.map((file: { name: string }) => `${folderPath}/${file.name}`)
  const { error: deleteError } = await supabase.storage.from(THUMBNAILS_BUCKET).remove(filePaths)

  if (deleteError) {
    throw new Error(`Failed to delete thumbnails: ${deleteError.message}`)
  }
}
