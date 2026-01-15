/**
 * Video Tree Utility - Client-side stub
 * Server-side functionality removed for SPA mode
 */

export interface VideoInfo {
  videoId: string
  displayPath: string
  isDemo: boolean
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
}

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
