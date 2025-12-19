import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Regular expression to find anchor tags with href attributes
const ANCHOR_TAG_REGEX = /<a\s+([^>]*?)>/gi
const HREF_REGEX = /href=["']([^"']+)["']/i
const TARGET_REGEX = /target=["']([^"']+)["']/i
const REL_REGEX = /rel=["']([^"']+)["']/i

interface LinkIssue {
  file: string
  line: number
  href: string
  issue: string
  suggestion: string
}

function isExternalLink(href: string): boolean {
  return (
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('//')
  )
}

function getAllFiles(dir: string, fileList: string[] = []): string[] {
  const files = readdirSync(dir)

  files.forEach((file) => {
    const filePath = join(dir, file)
    const stat = statSync(filePath)

    if (stat.isDirectory()) {
      // Skip node_modules, build directories, and hidden directories
      if (
        !file.startsWith('.') &&
        file !== 'node_modules' &&
        file !== 'build' &&
        file !== 'dist'
      ) {
        getAllFiles(filePath, fileList)
      }
    } else if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
      fileList.push(filePath)
    }
  })

  return fileList
}

function checkExternalLinks(filePath: string): LinkIssue[] {
  const content = readFileSync(filePath, 'utf-8')
  const issues: LinkIssue[] = []

  let match
  while ((match = ANCHOR_TAG_REGEX.exec(content)) !== null) {
    const attributes = match[1]

    const hrefMatch = attributes?.match(HREF_REGEX)
    if (!hrefMatch) continue

    const href = hrefMatch[1]
    if (!href || !isExternalLink(href)) continue

    // Find the line number
    const position = match.index
    const lineNumber =
      content.substring(0, position).split('\n').length

    const hasTarget = TARGET_REGEX.test(attributes || '')
    const relMatch = attributes?.match(REL_REGEX)
    const rel = relMatch ? relMatch[1] : null

    const hasNoopener = rel?.includes('noopener') ?? false
    const hasNoreferrer = rel?.includes('noreferrer') ?? false

    if (!hasTarget) {
      issues.push({
        file: filePath,
        line: lineNumber,
        href,
        issue: 'Missing target="_blank"',
        suggestion:
          'External links should open in a new tab: add target="_blank"',
      })
    }

    if (!hasNoopener || !hasNoreferrer) {
      const missing = []
      if (!hasNoopener) missing.push('noopener')
      if (!hasNoreferrer) missing.push('noreferrer')

      issues.push({
        file: filePath,
        line: lineNumber,
        href,
        issue: `Missing rel="${missing.join(' ')}"`,
        suggestion: `Security: add rel="noopener noreferrer" to prevent tab-napping attacks`,
      })
    }
  }

  return issues
}

describe('External Link Validation', () => {
  it('should have target="_blank" and rel="noopener noreferrer" on all external links', () => {
    const appDir = join(process.cwd(), 'app')
    const files = getAllFiles(appDir)
    const allIssues: LinkIssue[] = []

    files.forEach((file) => {
      const issues = checkExternalLinks(file)
      allIssues.push(...issues)
    })

    if (allIssues.length > 0) {
      const errorMessage = [
        '\n❌ External link validation failed:\n',
        ...allIssues.map((issue) => {
          const relativePath = issue.file.replace(process.cwd(), '.')
          return [
            `\n  File: ${relativePath}:${issue.line}`,
            `  Link: ${issue.href}`,
            `  Issue: ${issue.issue}`,
            `  Fix: ${issue.suggestion}`,
          ].join('\n')
        }),
        '\n',
      ].join('\n')

      expect(allIssues, errorMessage).toHaveLength(0)
    }

    // If we get here, all external links are properly configured
    expect(allIssues).toHaveLength(0)
  })

  it('should identify external links correctly', () => {
    expect(isExternalLink('https://example.com')).toBe(true)
    expect(isExternalLink('http://example.com')).toBe(true)
    expect(isExternalLink('//example.com')).toBe(true)
    expect(isExternalLink('/about')).toBe(false)
    expect(isExternalLink('about')).toBe(false)
    expect(isExternalLink('#section')).toBe(false)
  })
})
