/**
 * Input sanitization utilities using DOMPurify
 *
 * Protects against XSS attacks by sanitizing user input before rendering.
 * Use this when you need to render user-generated content as HTML.
 */

import DOMPurify from 'dompurify'

/**
 * Sanitize HTML content to prevent XSS attacks
 *
 * @param dirty - The potentially unsafe HTML string
 * @returns A sanitized HTML string safe for rendering
 *
 * @example
 * ```tsx
 * const userInput = '<script>alert("xss")</script><p>Safe content</p>'
 * const clean = sanitizeHtml(userInput)
 * // Returns: '<p>Safe content</p>'
 *
 * <div dangerouslySetInnerHTML={{ __html: clean }} />
 * ```
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    // Allow safe HTML tags for rich text
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'em',
      'u',
      'a',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
    // Always open links in new tab with security
    ADD_ATTR: ['target', 'rel'],
    // Prevent javascript: and data: URLs
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  })
}

/**
 * Sanitize text content - strips all HTML tags
 *
 * @param dirty - The potentially unsafe string
 * @returns Plain text with all HTML removed
 *
 * @example
 * ```tsx
 * const userInput = '<script>alert("xss")</script>Hello World'
 * const clean = sanitizeText(userInput)
 * // Returns: 'Hello World'
 *
 * <div>{clean}</div>
 * ```
 */
export function sanitizeText(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [], // No HTML tags allowed
  })
}

/**
 * Sanitize URL to prevent javascript: and data: schemes
 *
 * @param url - The potentially unsafe URL
 * @returns A safe URL or empty string if unsafe
 *
 * @example
 * ```tsx
 * const userUrl = 'javascript:alert("xss")'
 * const safeUrl = sanitizeUrl(userUrl)
 * // Returns: ''
 *
 * const goodUrl = 'https://example.com'
 * const stillGood = sanitizeUrl(goodUrl)
 * // Returns: 'https://example.com'
 * ```
 */
export function sanitizeUrl(url: string): string {
  const sanitized = DOMPurify.sanitize(url, {
    ALLOWED_TAGS: [],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  })

  // If the URL was sanitized to empty or doesn't match safe pattern, return empty
  if (!sanitized || /^(javascript|data|vbscript):/i.test(sanitized)) {
    return ''
  }

  return sanitized
}
