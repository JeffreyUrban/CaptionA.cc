/**
 * API response utilities for consistent response formatting.
 *
 * This module provides helper functions for creating standardized JSON responses
 * across all API routes, reducing boilerplate and ensuring consistent error handling.
 */

// =============================================================================
// Response Creation Functions
// =============================================================================

/**
 * Create a successful JSON response.
 *
 * @param data - Response body data (will be JSON serialized)
 * @param status - HTTP status code (default: 200)
 * @returns Response object with JSON content type
 *
 * @example
 * return jsonResponse({ annotations, total: annotations.length })
 * return jsonResponse({ created: true }, 201)
 */
export function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create an error JSON response.
 *
 * Wraps the error message in a standardized { error: message } format.
 *
 * @param message - Error message to include in response
 * @param status - HTTP status code (default: 500)
 * @returns Response object with error body
 *
 * @example
 * return errorResponse('Database connection failed', 503)
 * return errorResponse(error.message)
 */
export function errorResponse(message: string, status: number = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create a 404 Not Found response.
 *
 * @param message - Error message (default: 'Not found')
 * @returns Response object with 404 status
 *
 * @example
 * return notFoundResponse('Video not found')
 * return notFoundResponse(`Frame ${frameIndex} not found`)
 */
export function notFoundResponse(message: string = 'Not found'): Response {
  return errorResponse(message, 404)
}

/**
 * Create a 400 Bad Request response.
 *
 * @param message - Error message describing the validation failure
 * @returns Response object with 400 status
 *
 * @example
 * return badRequestResponse('Missing videoId parameter')
 * return badRequestResponse('Invalid annotations format')
 */
export function badRequestResponse(message: string): Response {
  return errorResponse(message, 400)
}

/**
 * Create a 401 Unauthorized response.
 *
 * @param message - Error message (default: 'Unauthorized')
 * @returns Response object with 401 status
 */
export function unauthorizedResponse(message: string = 'Unauthorized'): Response {
  return errorResponse(message, 401)
}

/**
 * Create a 403 Forbidden response.
 *
 * @param message - Error message (default: 'Forbidden')
 * @returns Response object with 403 status
 */
export function forbiddenResponse(message: string = 'Forbidden'): Response {
  return errorResponse(message, 403)
}

/**
 * Create a 409 Conflict response.
 *
 * @param message - Error message describing the conflict
 * @returns Response object with 409 status
 */
export function conflictResponse(message: string): Response {
  return errorResponse(message, 409)
}

/**
 * Create a 422 Unprocessable Entity response.
 *
 * Used when the request is well-formed but contains semantic errors.
 *
 * @param message - Error message describing the issue
 * @returns Response object with 422 status
 */
export function unprocessableResponse(message: string): Response {
  return errorResponse(message, 422)
}

// =============================================================================
// Parameter Extraction Functions
// =============================================================================

/**
 * Result type for parameter extraction.
 * Either contains the extracted value or a Response for the error case.
 */
export type ExtractResult<T> = { success: true; value: T } | { success: false; response: Response }

/**
 * Extract and validate videoId from route params.
 *
 * Handles URL decoding and validation. Returns a bad request response
 * if the videoId is missing or empty.
 *
 * @param params - Route params object (from LoaderFunctionArgs/ActionFunctionArgs)
 * @returns ExtractResult with decoded videoId or error response
 *
 * @example
 * const result = extractVideoId(params)
 * if (!result.success) return result.response
 * const videoId = result.value
 */
export function extractVideoId(params: Record<string, string | undefined>): ExtractResult<string> {
  const encodedVideoId = params['videoId']
  if (!encodedVideoId) {
    return {
      success: false,
      response: badRequestResponse('Missing videoId'),
    }
  }

  const videoId = decodeURIComponent(encodedVideoId)
  if (!videoId) {
    return {
      success: false,
      response: badRequestResponse('Invalid videoId'),
    }
  }

  return { success: true, value: videoId }
}

/**
 * Extract and validate multiple required parameters from route params.
 *
 * Returns a bad request response if any required parameter is missing.
 *
 * @param params - Route params object
 * @param required - Array of required parameter names
 * @returns ExtractResult with decoded params object or error response
 *
 * @example
 * const result = extractParams(params, ['videoId', 'frameIndex'])
 * if (!result.success) return result.response
 * const { videoId, frameIndex } = result.value
 */
export function extractParams<K extends string>(
  params: Record<string, string | undefined>,
  required: K[]
): ExtractResult<Record<K, string>> {
  const result = {} as Record<K, string>
  const missing: string[] = []

  for (const key of required) {
    const value = params[key]
    if (!value) {
      missing.push(key)
    } else {
      result[key] = decodeURIComponent(value)
    }
  }

  if (missing.length > 0) {
    return {
      success: false,
      response: badRequestResponse(`Missing required parameters: ${missing.join(', ')}`),
    }
  }

  return { success: true, value: result }
}

/**
 * Parse an integer parameter with validation.
 *
 * @param value - String value to parse
 * @param paramName - Parameter name for error messages
 * @returns ExtractResult with parsed integer or error response
 *
 * @example
 * const result = parseIntParam(frameIndexStr, 'frameIndex')
 * if (!result.success) return result.response
 * const frameIndex = result.value
 */
export function parseIntParam(value: string | undefined, paramName: string): ExtractResult<number> {
  if (value === undefined || value === '') {
    return {
      success: false,
      response: badRequestResponse(`Missing ${paramName}`),
    }
  }

  const parsed = parseInt(value, 10)
  if (isNaN(parsed)) {
    return {
      success: false,
      response: badRequestResponse(`Invalid ${paramName}: must be an integer`),
    }
  }

  return { success: true, value: parsed }
}

// =============================================================================
// Error Handling Utilities
// =============================================================================

/**
 * Wrap an async handler with standard error handling.
 *
 * Catches errors and returns appropriate error responses.
 * Logs errors to console for debugging.
 *
 * @param handler - Async function that may throw
 * @param context - Context string for error logging (e.g., 'GET /api/annotations')
 * @returns Response from handler or error response
 *
 * @example
 * export async function loader(args: LoaderFunctionArgs) {
 *   return withErrorHandling(async () => {
 *     // ... handler logic
 *   }, 'GET annotations')
 * }
 */
export async function withErrorHandling(
  handler: () => Promise<Response>,
  context: string
): Promise<Response> {
  try {
    return await handler()
  } catch (error) {
    console.error(`Error in ${context}:`, error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return errorResponse(message)
  }
}

/**
 * Create an error response from an unknown error value.
 *
 * Safely extracts error message from Error instances or converts
 * other values to strings.
 *
 * @param error - Error value (may be Error, string, or other)
 * @param status - HTTP status code (default: 500)
 * @returns Error response with appropriate message
 */
export function errorResponseFromUnknown(error: unknown, status: number = 500): Response {
  const message = error instanceof Error ? error.message : String(error)
  return errorResponse(message, status)
}

// =============================================================================
// Streaming Response Helpers
// =============================================================================

/**
 * Create a Server-Sent Events (SSE) response.
 *
 * Sets appropriate headers for SSE streaming.
 *
 * @param stream - ReadableStream for SSE events
 * @returns Response configured for SSE
 */
export function sseResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

/**
 * Format data as an SSE event string.
 *
 * @param data - Data to send (will be JSON serialized)
 * @param event - Optional event type name
 * @returns Formatted SSE event string
 */
export function formatSSEEvent(data: unknown, event?: string): string {
  const lines: string[] = []
  if (event) {
    lines.push(`event: ${event}`)
  }
  lines.push(`data: ${JSON.stringify(data)}`)
  lines.push('')
  return lines.join('\n') + '\n'
}
