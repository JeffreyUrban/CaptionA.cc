/**
 * Tus resumable upload endpoint
 *
 * Handles chunked, resumable video uploads using the tus protocol
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router'

// Lazy-load Node.js modules to avoid Vite bundling issues
let uploadDir: string | null = null

async function getUploadDir(): Promise<string> {
  if (uploadDir) return uploadDir

  const { resolve } = await import('path')
  const { mkdirSync } = await import('fs')

  uploadDir = resolve(process.cwd(), '..', '..', 'local', 'uploads')
  mkdirSync(uploadDir, { recursive: true })

  return uploadDir
}

interface UploadMetadata {
  videoPath: string // display_path (user-facing path like "level1/video")
  filename: string
  filetype?: string
  videoId?: string // UUID for this video
  storagePath?: string // hash-bucketed path like "a4/a4f2b8c3-..."
}

// Simple tus protocol implementation without tus-node-server
// This avoids the Node.js/Web API incompatibility issue

async function handleTusRequest(request: Request): Promise<Response> {
  const method = request.method
  const url = new URL(request.url)
  const uploadId = url.pathname.split('/').pop() ?? ''

  console.log(`[tus] ${method} ${url.pathname}`)

  if (method === 'POST') {
    // Create new upload
    return handleCreateUpload(request)
  } else if (method === 'HEAD') {
    // Get upload offset
    return handleHeadRequest(uploadId)
  } else if (method === 'PATCH') {
    // Upload chunk
    return handlePatchRequest(request, uploadId)
  } else if (method === 'OPTIONS') {
    // CORS preflight
    return new Response(null, {
      status: 204,
      headers: {
        'Tus-Resumable': '1.0.0',
        'Tus-Version': '1.0.0',
        'Tus-Extension': 'creation,termination',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST,HEAD,PATCH,OPTIONS',
        'Access-Control-Allow-Headers':
          'Upload-Offset,Upload-Length,Tus-Resumable,Upload-Metadata,Content-Type',
        'Access-Control-Expose-Headers': 'Upload-Offset,Location,Upload-Length,Tus-Resumable',
      },
    })
  }

  return new Response('Method not allowed', { status: 405 })
}

async function handleCreateUpload(request: Request): Promise<Response> {
  const uploadLength = request.headers.get('Upload-Length')
  const uploadMetadata = request.headers.get('Upload-Metadata')

  if (!uploadLength) {
    return new Response('Upload-Length header required', { status: 400 })
  }

  // Parse metadata
  const metadata: UploadMetadata = parseUploadMetadata(uploadMetadata ?? '')

  if (!metadata.videoPath || !metadata.filename) {
    return new Response('videoPath and filename metadata required', { status: 400 })
  }

  // Load Node.js modules
  const { resolve } = await import('path')
  const { createWriteStream, mkdirSync } = await import('fs')
  const { readFile } = await import('fs/promises')
  const { randomUUID } = await import('crypto')
  const Database = (await import('better-sqlite3')).default

  // Generate upload ID and video UUID
  const uploadDir = await getUploadDir()
  const uploadId = randomUUID()
  const uploadPath = resolve(uploadDir, uploadId)
  const metadataPath = resolve(uploadDir, `${uploadId}.json`)

  // Generate UUID for video storage (stable identifier)
  const videoId = randomUUID()
  const storagePath = `${videoId.slice(0, 2)}/${videoId}` // Hash-bucketed path

  // Save metadata (including videoId and storagePath)
  await writeJSON(metadataPath, {
    uploadId,
    uploadLength: parseInt(uploadLength),
    metadata: {
      ...metadata,
      videoId,
      storagePath,
    },
    createdAt: new Date().toISOString(),
    offset: 0,
  })

  // Create empty file
  createWriteStream(uploadPath).end()

  // Initialize database at storage path (not display path)
  const displayPath = metadata.videoPath // User-facing path
  const videoDir = resolve(process.cwd(), '..', '..', 'local', 'data', ...storagePath.split('/'))
  mkdirSync(videoDir, { recursive: true })

  const dbPath = resolve(videoDir, 'annotations.db')
  const db = new Database(dbPath)

  try {
    // Load schema
    const schemaPath = resolve(process.cwd(), 'app', 'db', 'annotations-schema.sql')
    const schema = await readFile(schemaPath, 'utf-8')
    db.exec(schema)

    // Insert video metadata with UUID-based storage
    db.prepare(
      `
      INSERT OR REPLACE INTO video_metadata (
        id, video_id, video_hash, storage_path, display_path,
        original_filename, file_size_bytes, upload_method
      ) VALUES (1, ?, '', ?, ?, ?, ?, 'web_upload')
    `
    ).run(videoId, storagePath, displayPath, metadata.filename, parseInt(uploadLength))

    // Insert initial processing status
    db.prepare(
      `
      INSERT OR REPLACE INTO processing_status (
        id, status, upload_progress, upload_started_at
      ) VALUES (1, 'uploading', 0.0, datetime('now'))
    `
    ).run()
  } finally {
    db.close()
  }

  console.log(`[tus] Created upload: ${uploadId} (${metadata.videoPath})`)

  return new Response(null, {
    status: 201,
    headers: {
      'Tus-Resumable': '1.0.0',
      Location: `/api/upload/${uploadId}`,
      'Upload-Offset': '0',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Location,Upload-Offset,Tus-Resumable',
    },
  })
}

async function handleHeadRequest(uploadId: string): Promise<Response> {
  const { resolve } = await import('path')
  const { existsSync, statSync } = await import('fs')

  const uploadDir = await getUploadDir()
  const metadataPath = resolve(uploadDir, `${uploadId}.json`)

  if (!existsSync(metadataPath)) {
    return new Response('Upload not found', { status: 404 })
  }

  const metadata = await readJSON(metadataPath)
  const uploadPath = resolve(uploadDir, uploadId)
  const currentSize = existsSync(uploadPath) ? statSync(uploadPath).size : 0

  return new Response(null, {
    status: 200,
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Offset': currentSize.toString(),
      'Upload-Length': metadata.uploadLength.toString(),
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Upload-Offset,Upload-Length,Tus-Resumable',
    },
  })
}

async function handlePatchRequest(request: Request, uploadId: string): Promise<Response> {
  const { resolve } = await import('path')
  const { existsSync, statSync, createWriteStream, unlinkSync } = await import('fs')
  const Database = (await import('better-sqlite3')).default

  const uploadDir = await getUploadDir()
  const metadataPath = resolve(uploadDir, `${uploadId}.json`)

  if (!existsSync(metadataPath)) {
    return new Response('Upload not found', { status: 404 })
  }

  const metadata = await readJSON(metadataPath)
  const uploadPath = resolve(uploadDir, uploadId)
  const uploadOffset = parseInt(request.headers.get('Upload-Offset') ?? '0')
  const currentSize = existsSync(uploadPath) ? statSync(uploadPath).size : 0

  if (uploadOffset !== currentSize) {
    return new Response('Upload-Offset mismatch', { status: 409 })
  }

  // Append chunk to file
  const arrayBuffer = await request.arrayBuffer()
  const chunk = Buffer.from(arrayBuffer)

  await new Promise((resolve, reject) => {
    const stream = createWriteStream(uploadPath, { flags: 'a' })
    stream.write(chunk, err => {
      if (err) reject(err)
      else resolve(undefined)
    })
    stream.end()
  })

  const newSize = currentSize + chunk.length
  const complete = newSize >= metadata.uploadLength

  // Update progress in database (use storagePath, not displayPath)
  const storagePath = metadata.metadata.storagePath
  if (!storagePath) {
    throw new Error('Storage path missing from metadata')
  }
  const dbPath = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...storagePath.split('/'),
    'annotations.db'
  )

  const db = new Database(dbPath)
  try {
    const progress = newSize / metadata.uploadLength
    db.prepare(
      `
      UPDATE processing_status
      SET upload_progress = ?
      WHERE id = 1
    `
    ).run(progress)
  } finally {
    db.close()
  }

  if (complete) {
    // Upload complete - move file to UUID-based storage and compute hash
    const completeStoragePath = metadata.metadata.storagePath
    const displayPath = metadata.metadata.videoPath
    if (!completeStoragePath) {
      throw new Error('Storage path missing from metadata')
    }

    const finalVideoPath = resolve(
      process.cwd(),
      '..',
      '..',
      'local',
      'data',
      ...completeStoragePath.split('/'),
      metadata.metadata.filename
    )

    const fs = await import('fs/promises')
    await fs.rename(uploadPath, finalVideoPath)
    unlinkSync(metadataPath)

    // Compute video hash for deduplication detection
    const { spawn } = await import('child_process')
    const computeHashProcess = spawn(
      'uv',
      [
        'run',
        'python',
        '-c',
        `from video_utils import compute_video_hash; from pathlib import Path; print(compute_video_hash(Path("${finalVideoPath.replace(/"/g, '\\"')}")))`,
      ],
      {
        cwd: resolve(process.cwd(), '..', '..', 'packages', 'video_utils'),
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )

    let videoHash = ''
    computeHashProcess.stdout?.on('data', data => {
      videoHash += data.toString().trim()
    })

    await new Promise<void>(resolve => {
      computeHashProcess.on('close', () => resolve())
    })

    console.log(`[tus] Computed video hash: ${videoHash.slice(0, 16)}...`)

    // Update status and video hash
    const db = new Database(dbPath)
    try {
      db.prepare(
        `
        UPDATE processing_status
        SET status = 'upload_complete',
            upload_progress = 1.0,
            upload_completed_at = datetime('now')
        WHERE id = 1
      `
      ).run()

      // Update video hash
      if (videoHash) {
        db.prepare(
          `
          UPDATE video_metadata
          SET video_hash = ?
          WHERE id = 1
        `
        ).run(videoHash)
      }
    } finally {
      db.close()
    }

    console.log(`[tus] Upload complete: ${displayPath} (storage: ${completeStoragePath})`)

    // Queue video for background processing (respects concurrency limits)
    const { queueVideoProcessing } = await import('~/services/video-processing')
    queueVideoProcessing({
      videoPath: displayPath, // Pass display path for logging
      videoFile: finalVideoPath,
      videoId: metadata.metadata.videoId, // Pass UUID for tracking
    })
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Offset': newSize.toString(),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Upload-Offset,Tus-Resumable',
    },
  })
}

function parseUploadMetadata(metadataHeader: string): UploadMetadata {
  const metadata: Record<string, string> = {}
  const pairs = metadataHeader.split(',')

  for (const pair of pairs) {
    const [key, value] = pair.trim().split(' ')
    if (key && value) {
      // Use atob for browser compatibility (though this only runs server-side)
      const decoded =
        typeof Buffer !== 'undefined' ? Buffer.from(value, 'base64').toString('utf-8') : atob(value)
      metadata[key] = decoded
    }
  }

  return metadata as unknown as UploadMetadata
}

interface UploadMetadataFile {
  uploadId: string
  uploadLength: number
  metadata: UploadMetadata
  createdAt: string
  offset: number
}

async function readJSON(path: string): Promise<UploadMetadataFile> {
  const { readFile } = await import('fs/promises')
  const content = await readFile(path, 'utf-8')
  return JSON.parse(content) as UploadMetadataFile
}

async function writeJSON(path: string, data: unknown): Promise<void> {
  const fs = await import('fs/promises')
  await fs.writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
}

// Handle all tus protocol methods
export async function loader({ request }: LoaderFunctionArgs) {
  return handleTusRequest(request)
}

export async function action({ request }: ActionFunctionArgs) {
  return handleTusRequest(request)
}
