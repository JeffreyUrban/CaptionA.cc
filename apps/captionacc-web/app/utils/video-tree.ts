/**
 * Video Tree Utility - Client-side stub
 * Server-side functionality removed for SPA mode
 */

import type { WorkflowStatus } from './video-badges'

export interface VideoInfo {
  videoId: string
  displayPath: string
  isDemo: boolean
  // Workflow status
  layout_status?: WorkflowStatus
  boundaries_status?: WorkflowStatus
  text_status?: WorkflowStatus
  // Stats
  total_frames?: number
  covered_frames?: number
  total_annotations?: number
  confirmed_annotations?: number
  predicted_annotations?: number
  boundary_pending_count?: number
  text_pending_count?: number
  // Error details
  layout_error_details?: { message?: string; [key: string]: unknown } | null
  boundaries_error_details?: { message?: string; [key: string]: unknown } | null
  text_error_details?: { message?: string; [key: string]: unknown } | null
}

export interface TreeNode {
  type: 'folder' | 'video'
  name: string
  path: string
  children?: TreeNode[]
  videoId?: string
  isDemo?: boolean
  videoCount?: number
  demoCount?: number
  // Video workflow data (only for video nodes)
  layout_status?: WorkflowStatus
  boundaries_status?: WorkflowStatus
  text_status?: WorkflowStatus
  total_frames?: number
  covered_frames?: number
  total_annotations?: number
  confirmed_annotations?: number
  predicted_annotations?: number
  boundary_pending_count?: number
  text_pending_count?: number
  layout_error_details?: { message?: string; [key: string]: unknown } | null
  boundaries_error_details?: { message?: string; [key: string]: unknown } | null
  text_error_details?: { message?: string; [key: string]: unknown } | null
}

export type FolderNode = TreeNode & { type: 'folder' }

export function buildVideoTree(videos: VideoInfo[]): TreeNode[] {
  const tree: TreeNode[] = []

  for (const video of videos) {
    const parts = video.displayPath.split('/')
    let current = tree

    // Build folder structure
    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i]
      if (!folderName) continue

      let folder = current.find(n => n.type === 'folder' && n.name === folderName)
      if (!folder) {
        folder = {
          type: 'folder',
          name: folderName,
          path: parts.slice(0, i + 1).join('/'),
          children: [],
        }
        current.push(folder)
      }
      current = folder.children!
    }

    // Add video leaf
    const videoName = parts[parts.length - 1]
    if (videoName) {
      current.push({
        type: 'video',
        name: videoName,
        path: video.displayPath,
        videoId: video.videoId,
        isDemo: video.isDemo,
        layout_status: video.layout_status,
        boundaries_status: video.boundaries_status,
        text_status: video.text_status,
        total_frames: video.total_frames,
        covered_frames: video.covered_frames,
        total_annotations: video.total_annotations,
        confirmed_annotations: video.confirmed_annotations,
        predicted_annotations: video.predicted_annotations,
        boundary_pending_count: video.boundary_pending_count,
        text_pending_count: video.text_pending_count,
        layout_error_details: video.layout_error_details,
        boundaries_error_details: video.boundaries_error_details,
        text_error_details: video.text_error_details,
      })
    }
  }

  return tree
}

export function calculateVideoCounts(node: TreeNode): void {
  if (node.type === 'video') return

  let videoCount = 0
  let demoCount = 0

  for (const child of node.children || []) {
    if (child.type === 'folder') {
      calculateVideoCounts(child)
      videoCount += child.videoCount || 0
      demoCount += child.demoCount || 0
    } else {
      videoCount++
      if (child.isDemo) demoCount++
    }
  }

  node.videoCount = videoCount
  node.demoCount = demoCount
}

export function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    // Folders first
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1
    }
    // Then alphabetically
    return a.name.localeCompare(b.name)
  })
}
