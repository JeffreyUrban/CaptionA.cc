/**
 * Hook for managing tree navigation state.
 * Handles folder expansion/collapse, localStorage persistence,
 * and expand/collapse all functionality.
 */

import { useState, useEffect, useCallback } from 'react'

import type { TreeNode } from '~/utils/video-tree'

/** Collect all folder paths from tree nodes */
function collectAllFolderPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.type === 'folder') {
      paths.push(node.path)
      paths.push(...collectAllFolderPaths(node.children))
    }
  }
  return paths
}

interface UseTreeNavigationParams {
  /** The video tree structure */
  tree: TreeNode[]
}

interface UseTreeNavigationReturn {
  /** Set of expanded folder paths */
  expandedPaths: Set<string>
  /** Toggle expansion state of a folder */
  toggleExpand: (path: string) => void
  /** Expand all folders */
  expandAll: () => void
  /** Collapse all folders */
  collapseAll: () => void
}

/**
 * Hook for managing tree navigation and expansion state.
 */
export function useTreeNavigation({ tree }: UseTreeNavigationParams): UseTreeNavigationReturn {
  // Initialize with empty Set to avoid hydration mismatch
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  // Load expansion state from localStorage after mount
  useEffect(() => {
    const saved = localStorage.getItem('video-tree-expanded')
    if (saved) {
      try {
        setExpandedPaths(new Set(JSON.parse(saved)))
      } catch {
        // Invalid JSON, ignore
      }
    }
  }, [])

  // Toggle expansion and save to localStorage
  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('video-tree-expanded', JSON.stringify(Array.from(next)))
      }
      return next
    })
  }, [])

  // Expand all folders
  const expandAll = useCallback(() => {
    const allPaths = new Set(collectAllFolderPaths(tree))
    setExpandedPaths(allPaths)
    if (typeof window !== 'undefined') {
      localStorage.setItem('video-tree-expanded', JSON.stringify(Array.from(allPaths)))
    }
  }, [tree])

  // Collapse all folders
  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set())
    if (typeof window !== 'undefined') {
      localStorage.setItem('video-tree-expanded', JSON.stringify([]))
    }
  }, [])

  return {
    expandedPaths,
    toggleExpand,
    expandAll,
    collapseAll,
  }
}
