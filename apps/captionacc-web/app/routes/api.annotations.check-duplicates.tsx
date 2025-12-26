/**
 * Check if video paths already exist (duplicate detection)
 */
import type { LoaderFunctionArgs } from 'react-router'
import { resolve } from 'path'
import { existsSync } from 'fs'
import Database from 'better-sqlite3'

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const pathsParam = url.searchParams.get('paths')

  if (!pathsParam) {
    return Response.json({ error: 'Missing paths parameter' }, { status: 400 })
  }

  const videoPaths = pathsParam.split(',')
  const results: Record<string, { exists: boolean; filename?: string; uploadedAt?: string }> = {}

  for (const videoPath of videoPaths) {
    const dbPath = resolve(
      process.cwd(),
      '..',
      '..',
      'local',
      'data',
      ...videoPath.split('/'),
      'annotations.db'
    )

    if (existsSync(dbPath)) {
      const db = new Database(dbPath, { readonly: true })
      try {
        const metadata = db.prepare(`
          SELECT original_filename, uploaded_at
          FROM video_metadata
          WHERE id = 1
        `).get() as { original_filename: string; uploaded_at: string } | undefined

        if (metadata) {
          results[videoPath] = {
            exists: true,
            filename: metadata.original_filename,
            uploadedAt: metadata.uploaded_at,
          }
        } else {
          results[videoPath] = { exists: false }
        }
      } finally {
        db.close()
      }
    } else {
      results[videoPath] = { exists: false }
    }
  }

  return Response.json(results)
}
