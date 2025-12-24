import { resolve } from 'path'
import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import Database from 'better-sqlite3'

export interface VideoStats {
  totalAnnotations: number
  pendingReview: number
  confirmedAnnotations: number
  predictedAnnotations: number
  gapAnnotations: number
  progress: number
  totalFrames: number
  coveredFrames: number
}

export interface VideoInfo {
  videoId: string
}

export type TreeNode = FolderNode | VideoNode

export interface FolderNode {
  type: 'folder'
  name: string
  path: string
  children: TreeNode[]
  stats: VideoStats  // Aggregated stats
  videoCount: number  // Total videos recursively
}

export interface VideoNode {
  type: 'video'
  name: string
  path: string
  videoId: string
  stats: VideoStats | null  // Individual video stats (loaded async)
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
            coveredFrames: 0
          },
          videoCount: 0
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
    const videoNode: VideoNode = {
      type: 'video',
      name: videoName,
      path: video.videoId,
      videoId: video.videoId,
      stats: null  // Will be loaded async
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

  // Get total frames from caption_frames directory
  const framesDir = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'caption_frames'
  )

  let totalFrames = 0
  if (existsSync(framesDir)) {
    const files = await readdir(framesDir)
    totalFrames = files.filter(f => f.startsWith('frame_') && f.endsWith('.jpg')).length
  }

  if (!existsSync(dbPath)) {
    return {
      totalAnnotations: 0,
      pendingReview: 0,
      confirmedAnnotations: 0,
      predictedAnnotations: 0,
      gapAnnotations: 0,
      progress: 0,
      totalFrames,
      coveredFrames: 0
    }
  }

  const db = new Database(dbPath, { readonly: true })

  try {
    const result = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN pending = 1 THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN state = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN state = 'predicted' THEN 1 ELSE 0 END) as predicted,
        SUM(CASE WHEN state = 'gap' THEN 1 ELSE 0 END) as gaps
      FROM annotations
    `).get() as {
      total: number
      pending: number
      confirmed: number
      predicted: number
      gaps: number
    }

    // Calculate frame coverage for non-gap, non-pending annotations
    const frameCoverage = db.prepare(`
      SELECT
        SUM(end_frame_index - start_frame_index + 1) as covered_frames
      FROM annotations
      WHERE state != 'gap' AND pending = 0
    `).get() as { covered_frames: number | null }

    const coveredFrames = frameCoverage.covered_frames || 0
    const progress = totalFrames > 0
      ? Math.round((coveredFrames / totalFrames) * 100)
      : 0

    return {
      totalAnnotations: result.total,
      pendingReview: result.pending,
      confirmedAnnotations: result.confirmed,
      predictedAnnotations: result.predicted,
      gapAnnotations: result.gaps,
      progress,
      totalFrames,
      coveredFrames
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

  const progress = totalFrames > 0
    ? Math.round((coveredFrames / totalFrames) * 100)
    : 0

  node.stats = {
    totalAnnotations,
    pendingReview,
    confirmedAnnotations,
    predictedAnnotations,
    gapAnnotations,
    progress,
    totalFrames,
    coveredFrames
  }
  node.videoCount = videoCount
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
