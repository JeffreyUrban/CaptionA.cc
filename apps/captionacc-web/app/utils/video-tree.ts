import { existsSync } from 'fs'
import { resolve } from 'path'

import Database from 'better-sqlite3'

import { type VideoStats } from './video-stats'

export interface VideoInfo {
  videoId: string
}

export type { VideoStats }

export type TreeNode = FolderNode | VideoNode

export interface FolderNode {
  type: 'folder'
  name: string
  path: string
  children: TreeNode[]
  stats: VideoStats // Aggregated stats
  videoCount: number // Total videos recursively
}

export interface VideoNode {
  type: 'video'
  name: string
  path: string
  videoId: string
  stats: VideoStats | null // Individual video stats (loaded async)
}

/**
 * Builds a tree structure from a flat list of videos
 */
export function buildVideoTree(videos: VideoInfo[]): TreeNode[] {
  const root: Map<string, TreeNode> = new Map()

  for (const video of videos) {
    const segments = video.videoId.split('/')
    let currentLevel = root
    let parentFolder: FolderNode | null = null

    // Build intermediate folder nodes
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]
      if (!segment) continue
      const path = segments.slice(0, i + 1).join('/')

      if (!currentLevel.has(segment)) {
        const folderNode: FolderNode = {
          type: 'folder',
          name: segment,
          path,
          children: [],
          stats: {
            totalAnnotations: 0,
            pendingReview: 0,
            confirmedAnnotations: 0,
            predictedAnnotations: 0,
            gapAnnotations: 0,
            progress: 0,
            totalFrames: 0,
            coveredFrames: 0,
            hasOcrData: false,
            layoutApproved: false,
            boundaryPendingReview: 0,
            textPendingReview: 0,
            badges: [],
          },
          videoCount: 0,
        }
        currentLevel.set(segment, folderNode)
      }

      const folderNode = currentLevel.get(segment) as FolderNode

      // Update parent's children array if needed
      if (parentFolder && !parentFolder.children.includes(folderNode)) {
        parentFolder.children.push(folderNode)
      }

      parentFolder = folderNode
      currentLevel = new Map(folderNode.children.map(child => [child.name, child]))
    }

    // Add video node as leaf
    const videoName = segments[segments.length - 1]
    if (!videoName) continue
    const videoNode: VideoNode = {
      type: 'video',
      name: videoName,
      path: video.videoId,
      videoId: video.videoId,
      stats: null, // Will be loaded async
    }

    if (parentFolder && !parentFolder.children.some(c => c.path === videoNode.path)) {
      parentFolder.children.push(videoNode)
    } else if (!parentFolder) {
      // Video at root level
      currentLevel.set(videoName, videoNode)
    }
  }

  return Array.from(root.values())
}

/**
 * Gets stats for a single video
 */
export async function getVideoStats(videoId: string): Promise<VideoStats> {
  const dbPath = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'annotations.db'
  )

  if (!existsSync(dbPath)) {
    return {
      totalAnnotations: 0,
      pendingReview: 0,
      confirmedAnnotations: 0,
      predictedAnnotations: 0,
      gapAnnotations: 0,
      progress: 0,
      totalFrames: 0,
      coveredFrames: 0,
      hasOcrData: false,
      layoutApproved: false,
      boundaryPendingReview: 0,
      textPendingReview: 0,
      badges: [],
    }
  }

  const db = new Database(dbPath, { readonly: true })

  // Count cropped frames from database (not filesystem)
  // Frames are written to DB and filesystem is cleaned up after processing
  let totalFrames = 0
  try {
    const frameCount = db.prepare(`SELECT COUNT(*) as count FROM cropped_frames`).get() as
      | { count: number }
      | undefined
    totalFrames = frameCount?.count ?? 0
  } catch {
    // Table doesn't exist yet
    totalFrames = 0
  }

  try {
    const result = db
      .prepare(
        `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN boundary_pending = 1 THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN boundary_state = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN boundary_state = 'predicted' THEN 1 ELSE 0 END) as predicted,
        SUM(CASE WHEN boundary_state = 'gap' THEN 1 ELSE 0 END) as gaps
      FROM captions
    `
      )
      .get() as {
      total: number
      pending: number
      confirmed: number
      predicted: number
      gaps: number
    }

    // Calculate frame coverage for non-gap, non-pending annotations
    const frameCoverage = db
      .prepare(
        `
      SELECT
        SUM(end_frame_index - start_frame_index + 1) as covered_frames
      FROM captions
      WHERE boundary_state != 'gap' AND boundary_pending = 0
    `
      )
      .get() as { covered_frames: number | null }

    const coveredFrames = frameCoverage.covered_frames ?? 0
    const progress = totalFrames > 0 ? Math.round((coveredFrames / totalFrames) * 100) : 0

    return {
      totalAnnotations: result.total,
      pendingReview: result.pending,
      confirmedAnnotations: result.confirmed,
      predictedAnnotations: result.predicted,
      gapAnnotations: result.gaps,
      progress,
      totalFrames,
      coveredFrames,
      hasOcrData: false,
      layoutApproved: false,
      boundaryPendingReview: 0,
      textPendingReview: 0,
      badges: [],
    }
  } finally {
    db.close()
  }
}

/**
 * Recursively calculates aggregate stats for a folder node
 */
export function calculateFolderStats(node: FolderNode): void {
  let totalAnnotations = 0
  let pendingReview = 0
  let confirmedAnnotations = 0
  let predictedAnnotations = 0
  let gapAnnotations = 0
  let totalFrames = 0
  let coveredFrames = 0
  let videoCount = 0

  for (const child of node.children) {
    if (child.type === 'folder') {
      // Recursively calculate stats for child folders first
      calculateFolderStats(child)
      totalAnnotations += child.stats.totalAnnotations
      pendingReview += child.stats.pendingReview
      confirmedAnnotations += child.stats.confirmedAnnotations
      predictedAnnotations += child.stats.predictedAnnotations
      gapAnnotations += child.stats.gapAnnotations
      totalFrames += child.stats.totalFrames
      coveredFrames += child.stats.coveredFrames
      videoCount += child.videoCount
    } else {
      // Video node
      if (child.stats) {
        totalAnnotations += child.stats.totalAnnotations
        pendingReview += child.stats.pendingReview
        confirmedAnnotations += child.stats.confirmedAnnotations
        predictedAnnotations += child.stats.predictedAnnotations
        gapAnnotations += child.stats.gapAnnotations
        totalFrames += child.stats.totalFrames
        coveredFrames += child.stats.coveredFrames
      }
      videoCount += 1
    }
  }

  const progress = totalFrames > 0 ? Math.round((coveredFrames / totalFrames) * 100) : 0

  node.stats = {
    totalAnnotations,
    pendingReview,
    confirmedAnnotations,
    predictedAnnotations,
    gapAnnotations,
    progress,
    totalFrames,
    coveredFrames,
    hasOcrData: false,
    layoutApproved: false,
    boundaryPendingReview: 0,
    textPendingReview: 0,
    badges: [],
  }
  node.videoCount = videoCount
}

/**
 * Calculates video count for each folder recursively
 */
export function calculateVideoCounts(node: FolderNode): number {
  let count = 0
  for (const child of node.children) {
    if (child.type === 'video') {
      count += 1
    } else {
      count += calculateVideoCounts(child)
    }
  }
  node.videoCount = count
  return count
}

/**
 * Sorts tree nodes: folders first (alphabetically), then videos (alphabetically)
 */
export function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  const folders = nodes.filter(n => n.type === 'folder') as FolderNode[]
  const videos = nodes.filter(n => n.type === 'video') as VideoNode[]

  folders.sort((a, b) => a.name.localeCompare(b.name))
  videos.sort((a, b) => a.name.localeCompare(b.name))

  // Recursively sort children of folders
  for (const folder of folders) {
    folder.children = sortTreeNodes(folder.children)
  }

  return [...folders, ...videos]
}
