/**
 * Basic Authentication Middleware for Preview Site
 *
 * Provides HTTP Basic Auth protection for preview/staging environments.
 * Prevents unauthorized access before any application logic runs.
 *
 * Usage:
 * - Set BASIC_AUTH_ENABLED=true to enable
 * - Set BASIC_AUTH_CREDENTIALS=username:password
 * - Call from root loader or entry.server.tsx
 */

/**
 * Check if basic auth is required and validate credentials
 *
 * @param request - The incoming request
 * @returns Response with 401 if auth fails, null if auth passes
 */
export function requireBasicAuth(request: Request): Response | null {
  // Only enable on preview sites or when explicitly enabled
  const isPreview = process.env['FLY_APP_NAME']?.includes('preview')
  const isExplicitlyEnabled = process.env['BASIC_AUTH_ENABLED'] === 'true'

  if (!isPreview && !isExplicitlyEnabled) {
    return null // Basic auth not required
  }

  const authHeader = request.headers.get('authorization')
  const credentials = process.env['BASIC_AUTH_CREDENTIALS']

  if (!credentials) {
    console.warn('BASIC_AUTH_ENABLED but BASIC_AUTH_CREDENTIALS not set')
    return null // Don't block if misconfigured
  }

  if (!authHeader || !validateBasicAuth(authHeader, credentials)) {
    return new Response('Authentication Required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="CaptionA.cc Preview Site"',
        'Content-Type': 'text/plain',
      },
    })
  }

  return null // Auth passed
}

/**
 * Validate Basic Auth header against expected credentials
 *
 * @param authHeader - The Authorization header value
 * @param expectedCredentials - Expected credentials in format "username:password"
 * @returns true if valid, false otherwise
 */
function validateBasicAuth(authHeader: string, expectedCredentials: string): boolean {
  try {
    // Remove "Basic " prefix
    const encodedCredentials = authHeader.replace(/^Basic\s+/i, '')

    // Decode base64
    const decoded = Buffer.from(encodedCredentials, 'base64').toString('utf-8')

    // Compare with expected credentials
    return decoded === expectedCredentials
  } catch (error) {
    console.error('Basic auth validation error:', error)
    return false
  }
}

/**
 * Generate a basic auth response for testing
 *
 * @param username
 * @param password
 * @returns Encoded authorization header value
 */
export function generateBasicAuthHeader(username: string, password: string): string {
  const credentials = `${username}:${password}`
  const encoded = Buffer.from(credentials, 'utf-8').toString('base64')
  return `Basic ${encoded}`
}
