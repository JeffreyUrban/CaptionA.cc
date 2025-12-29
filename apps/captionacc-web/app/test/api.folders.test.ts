import { randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

/**
 * Integration tests for folder API endpoints
 *
 * Tests the create, delete, and rename operations for virtual folders
 * in the UUID-based storage system.
 *
 * Note: These tests require the dev server to be running on localhost:5173
 * Run with: npm run dev (in another terminal)
 */

const DATA_DIR = resolve(process.cwd(), '..', '..', 'local', 'data')
const FOLDERS_META_PATH = resolve(DATA_DIR, '.folders.json')

// Use unique prefixes for test folders to avoid conflicts
const TEST_PREFIX = '__test__'
const testFolders: string[] = []

interface FoldersMetadata {
  emptyFolders: string[]
}

function readFoldersMetadata(): FoldersMetadata {
  try {
    if (existsSync(FOLDERS_META_PATH)) {
      const content = readFileSync(FOLDERS_META_PATH, 'utf-8')
      return JSON.parse(content)
    }
  } catch (error) {
    // Ignore
  }
  return { emptyFolders: [] }
}

function createTestFolder(name: string): string {
  const uuid = randomUUID().substring(0, 8) // Use short UUID for readability
  const folderName = `${TEST_PREFIX}${name}-${uuid}`
  testFolders.push(folderName)
  return folderName
}

describe('Folder API', () => {
  beforeAll(async () => {
    // Clean up any leftover test folders from previous runs
    const metadata = readFoldersMetadata()
    const testFoldersInMetadata = metadata.emptyFolders.filter(f => f.startsWith(TEST_PREFIX))

    for (const folder of testFoldersInMetadata) {
      try {
        await fetch(
          `http://localhost:5173/api/folders/delete?path=${encodeURIComponent(folder)}&confirmed=true`,
          { method: 'DELETE' }
        )
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  })

  afterAll(async () => {
    // Clean up test folders created during tests
    for (const folder of testFolders) {
      try {
        await fetch(
          `http://localhost:5173/api/folders/delete?path=${encodeURIComponent(folder)}&confirmed=true`,
          { method: 'DELETE' }
        )
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  })

  describe('DELETE /api/folders/delete - Confirmation Flow', () => {
    it('should require confirmation before deleting empty folders', async () => {
      // Setup: Create a test folder via API
      const testFolder = createTestFolder('confirm-folder')

      await fetch('http://localhost:5173/api/folders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: testFolder }),
      })

      // Step 1: First DELETE without confirmed - should return requiresConfirmation
      const response1 = await fetch(
        `http://localhost:5173/api/folders/delete?path=${encodeURIComponent(testFolder)}`,
        { method: 'DELETE' }
      )
      expect(response1.status).toBe(200)

      const data1 = await response1.json()
      expect(data1).toEqual({
        requiresConfirmation: true,
        videoCount: 0,
        folderPath: testFolder,
      })

      // Verify folder still exists
      const metadata1 = readFoldersMetadata()
      expect(metadata1.emptyFolders).toContain(testFolder)

      // Step 2: Second DELETE with confirmed=true - should actually delete
      const response2 = await fetch(
        `http://localhost:5173/api/folders/delete?path=${encodeURIComponent(testFolder)}&confirmed=true`,
        { method: 'DELETE' }
      )
      expect(response2.status).toBe(200)

      const data2 = await response2.json()
      expect(data2).toEqual({
        success: true,
        folderPath: testFolder,
        videosDeleted: 0,
        wasEmptyFolder: true,
      })

      // Verify folder is deleted
      const metadata2 = readFoldersMetadata()
      expect(metadata2.emptyFolders).not.toContain(testFolder)
    })

    it('should return 404 when trying to delete non-existent folder', async () => {
      const response = await fetch(
        `http://localhost:5173/api/folders/delete?path=nonexistent-folder&confirmed=true`,
        { method: 'DELETE' }
      )

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data).toEqual({ error: 'Folder not found' })
    })

    it('should not delete folder without confirmation even if folder exists', async () => {
      // Setup: Create a test folder via API
      const testFolder = createTestFolder('no-confirm')

      await fetch('http://localhost:5173/api/folders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: testFolder }),
      })

      // Try to delete without confirmed=true
      const response = await fetch(
        `http://localhost:5173/api/folders/delete?path=${encodeURIComponent(testFolder)}`,
        { method: 'DELETE' }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.requiresConfirmation).toBe(true)

      // Verify folder still exists after "delete" attempt
      const metadata = readFoldersMetadata()
      expect(metadata.emptyFolders).toContain(testFolder)
    })
  })

  describe('PATCH /api/folders/move', () => {
    it('should move an empty folder', async () => {
      const testFolder = createTestFolder('move-empty')
      const targetFolder = 'a_bite_of_china'

      // Create the folder
      await fetch('http://localhost:5173/api/folders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: testFolder }),
      })

      // Move the folder
      const response = await fetch('http://localhost:5173/api/folders/move', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: testFolder,
          targetFolder,
        }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toEqual({
        success: true,
        oldPath: testFolder,
        newPath: `${targetFolder}/${testFolder}`,
        videosUpdated: 0,
        wasEmptyFolder: true,
      })

      // Verify old path is gone and new path exists
      const metadata = readFoldersMetadata()
      expect(metadata.emptyFolders).not.toContain(testFolder)
      expect(metadata.emptyFolders).toContain(`${targetFolder}/${testFolder}`)

      // Cleanup - track the new path for deletion
      testFolders.push(`${targetFolder}/${testFolder}`)
    })

    it('should return 404 when trying to move non-existent folder', async () => {
      const response = await fetch('http://localhost:5173/api/folders/move', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: 'nonexistent-folder',
          targetFolder: 'a_bite_of_china',
        }),
      })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data).toEqual({ error: 'Folder not found' })
    })
  })

  describe('POST /api/folders/create', () => {
    it('should create a new empty folder', async () => {
      const testFolder = createTestFolder('new-folder')

      const response = await fetch('http://localhost:5173/api/folders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: testFolder }),
      })

      expect(response.status).toBe(201)
      const data = await response.json()
      expect(data).toEqual({
        success: true,
        folderPath: testFolder,
      })

      // Verify folder exists in metadata
      const metadata = readFoldersMetadata()
      expect(metadata.emptyFolders).toContain(testFolder)
    })

    it('should reject folder paths with leading/trailing slashes', async () => {
      const response = await fetch('http://localhost:5173/api/folders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: '/invalid/' }),
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('should not start or end with /')
    })

    it('should prevent duplicate folder creation', async () => {
      const testFolder = createTestFolder('duplicate-folder')

      // Create folder first time
      await fetch('http://localhost:5173/api/folders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: testFolder }),
      })

      // Try to create again
      const response = await fetch('http://localhost:5173/api/folders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: testFolder }),
      })

      expect(response.status).toBe(409)
      const data = await response.json()
      expect(data.error).toBe('Folder already exists')
    })
  })
})
