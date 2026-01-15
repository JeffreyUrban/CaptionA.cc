/**
 * Wasabi S3 Client for Video and Database Storage
 *
 * Downloads databases from Wasabi for local annotation work.
 * Uploads modified databases back to Wasabi.
 *
 * Storage structure: {tenant_id}/{video_id}/{resource}
 * Resources: video.db, fullOCR.db, layout.db, captions.db
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'fs'
import { dirname, resolve } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const WASABI_REGION = 'us-east-1'
const WASABI_BUCKET = 'caption-acc-prod'
const WASABI_ENDPOINT = `https://s3.${WASABI_REGION}.wasabisys.com`

// Cache directory for downloaded databases
const CACHE_DIR = resolve(process.cwd(), '..', '..', 'local', 'cache')

/**
 * Get configured S3 client for Wasabi
 */
function getS3Client(): S3Client {
  const accessKey = process.env['WASABI_ACCESS_KEY_READWRITE'] ?? process.env['WASABI_ACCESS_KEY']
  const secretKey = process.env['WASABI_SECRET_KEY_READWRITE'] ?? process.env['WASABI_SECRET_KEY']

  if (!accessKey || !secretKey) {
    throw new Error(
      'Wasabi credentials required. Set WASABI_ACCESS_KEY and WASABI_SECRET_KEY environment variables.'
    )
  }

  return new S3Client({
    endpoint: WASABI_ENDPOINT,
    region: WASABI_REGION,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    forcePathStyle: true, // Required for Wasabi
  })
}

/**
 * Build storage key for a database file
 */
export function buildStorageKey(tenantId: string, videoId: string, dbName: string): string {
  return `${tenantId}/${videoId}/${dbName}`
}

/**
 * Get local cache path for a database
 */
export function getCachePath(tenantId: string, videoId: string, dbName: string): string {
  return resolve(CACHE_DIR, tenantId, videoId, dbName)
}

/**
 * Check if a file exists in Wasabi
 */
export async function fileExistsInWasabi(storageKey: string): Promise<boolean> {
  const client = getS3Client()
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: WASABI_BUCKET,
        Key: storageKey,
      })
    )
    return true
  } catch {
    return false
  }
}

/**
 * Download a database from Wasabi to local cache
 *
 * @param tenantId - Tenant UUID
 * @param videoId - Video UUID
 * @param dbName - Database filename (video.db, fullOCR.db, layout.db, captions.db)
 * @param forceRefresh - If true, download even if cached copy exists
 * @returns Local path to the cached database
 */
export async function downloadDatabase(
  tenantId: string,
  videoId: string,
  dbName: string,
  forceRefresh = false
): Promise<string> {
  const storageKey = buildStorageKey(tenantId, videoId, dbName)
  const localPath = getCachePath(tenantId, videoId, dbName)

  // Check if already cached
  if (!forceRefresh && existsSync(localPath)) {
    console.log(`[Wasabi] Using cached database: ${localPath}`)
    return localPath
  }

  console.log(`[Wasabi] Downloading ${storageKey} to ${localPath}`)

  const client = getS3Client()

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: WASABI_BUCKET,
        Key: storageKey,
      })
    )

    if (!response.Body) {
      throw new Error(`Empty response body for ${storageKey}`)
    }

    // Ensure cache directory exists
    const dir = dirname(localPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // Stream to file
    const writeStream = createWriteStream(localPath)
    await pipeline(response.Body as Readable, writeStream)

    console.log(`[Wasabi] Downloaded ${storageKey} to ${localPath}`)
    return localPath
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Failed to download ${storageKey}: ${message}`)
  }
}

/**
 * Upload a database from local cache back to Wasabi
 *
 * @param tenantId - Tenant UUID
 * @param videoId - Video UUID
 * @param dbName - Database filename
 */
export async function uploadDatabase(
  tenantId: string,
  videoId: string,
  dbName: string
): Promise<void> {
  const storageKey = buildStorageKey(tenantId, videoId, dbName)
  const localPath = getCachePath(tenantId, videoId, dbName)

  if (!existsSync(localPath)) {
    throw new Error(`Local database not found: ${localPath}`)
  }

  console.log(`[Wasabi] Uploading ${localPath} to ${storageKey}`)

  const client = getS3Client()
  const fileContent = readFileSync(localPath)

  await client.send(
    new PutObjectCommand({
      Bucket: WASABI_BUCKET,
      Key: storageKey,
      Body: fileContent,
      ContentType: 'application/x-sqlite3',
    })
  )

  console.log(`[Wasabi] Uploaded ${storageKey}`)
}

/** Valid database names in the split architecture */
export type DatabaseName = 'video.db' | 'fullOCR.db' | 'cropping.db' | 'layout.db' | 'captions.db'

/** Databases needed for each workflow */
export const WORKFLOW_DATABASES = {
  /** Layout annotation: read video/OCR, write layout */
  layout: {
    readonly: ['video.db', 'fullOCR.db'] as DatabaseName[],
    writable: ['layout.db'] as DatabaseName[],
  },
  /** Caption annotation: read video, write captions */
  caption: {
    readonly: ['video.db'] as DatabaseName[],
    writable: ['captions.db'] as DatabaseName[],
  },
  /** View only: read all */
  view: {
    readonly: [
      'video.db',
      'fullOCR.db',
      'cropping.db',
      'layout.db',
      'captions.db',
    ] as DatabaseName[],
    writable: [] as DatabaseName[],
  },
} as const

export type WorkflowType = keyof typeof WORKFLOW_DATABASES

/**
 * Download all databases needed for a workflow.
 *
 * @param tenantId - Tenant UUID
 * @param videoId - Video UUID
 * @param workflow - Workflow type determining which databases to download
 * @param forceRefresh - Force re-download even if cached
 * @returns Map of database name to local path
 */
export async function downloadWorkflowDatabases(
  tenantId: string,
  videoId: string,
  workflow: WorkflowType,
  forceRefresh = false
): Promise<Map<DatabaseName, string>> {
  const config = WORKFLOW_DATABASES[workflow]
  const allDatabases = [...config.readonly, ...config.writable]
  const paths = new Map<DatabaseName, string>()

  console.log(`[Wasabi] Downloading databases for ${workflow} workflow: ${allDatabases.join(', ')}`)

  for (const dbName of allDatabases) {
    const storageKey = buildStorageKey(tenantId, videoId, dbName)

    // Check if exists in Wasabi
    const exists = await fileExistsInWasabi(storageKey)
    if (!exists) {
      console.log(`[Wasabi] Database not found (may be optional): ${storageKey}`)
      continue
    }

    // Download to cache (force refresh for writable databases)
    const shouldForceRefresh = forceRefresh || config.writable.includes(dbName)
    const localPath = await downloadDatabase(tenantId, videoId, dbName, shouldForceRefresh)
    paths.set(dbName, localPath)
  }

  return paths
}

/**
 * Upload modified databases back to Wasabi after a workflow.
 *
 * @param tenantId - Tenant UUID
 * @param videoId - Video UUID
 * @param workflow - Workflow type determining which databases to upload
 */
export async function syncWorkflowDatabases(
  tenantId: string,
  videoId: string,
  workflow: WorkflowType
): Promise<void> {
  const config = WORKFLOW_DATABASES[workflow]

  for (const dbName of config.writable) {
    const localPath = getCachePath(tenantId, videoId, dbName)
    if (existsSync(localPath)) {
      await uploadDatabase(tenantId, videoId, dbName)
    }
  }
}

/**
 * Check the last modified time of a cached database
 */
export function getCacheModifiedTime(
  tenantId: string,
  videoId: string,
  dbName: string
): Date | null {
  const localPath = getCachePath(tenantId, videoId, dbName)
  if (!existsSync(localPath)) {
    return null
  }
  const stats = statSync(localPath)
  return stats.mtime
}

/**
 * Clear cached database for a video
 */
export function clearCache(tenantId: string, videoId: string, dbName?: string): void {
  if (dbName) {
    const localPath = getCachePath(tenantId, videoId, dbName)
    if (existsSync(localPath)) {
      rmSync(localPath)
      console.log(`[Wasabi] Cleared cache: ${localPath}`)
    }
  } else {
    const videoDir = resolve(CACHE_DIR, tenantId, videoId)
    if (existsSync(videoDir)) {
      rmSync(videoDir, { recursive: true })
      console.log(`[Wasabi] Cleared cache directory: ${videoDir}`)
    }
  }
}
