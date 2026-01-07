/**
 * Health Check Endpoint
 *
 * Provides application health status for:
 * - Fly.io internal health checks (auto-restart on failure)
 * - External monitoring (GitHub Actions, manual checks)
 * - Key rotation verification
 *
 * Returns:
 * - 200 OK: All critical systems operational
 * - 503 Service Unavailable: Critical system failure
 */

import { json, type LoaderFunctionArgs } from '@remix-run/node'

import { createServerSupabaseClient } from '~/services/supabase-client'
import { listChunks } from '~/services/wasabi-storage.server'

interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  response_ms?: number
  error?: string
  details?: Record<string, unknown>
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  environment: string
  version: string
  components: {
    supabase: ComponentHealth
    wasabi: ComponentHealth
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const startTime = Date.now()

  const health: HealthResponse = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env['ENVIRONMENT'] || 'development',
    version: process.env['APP_VERSION'] || 'dev',
    components: {
      supabase: { status: 'healthy' },
      wasabi: { status: 'healthy' },
    },
  }

  // Check Supabase connectivity
  try {
    const supabaseStart = Date.now()
    const supabase = createServerSupabaseClient()

    // Lightweight query to verify connection
    const { error } = await supabase.from('videos').select('id').limit(1)

    health.components.supabase.response_ms = Date.now() - supabaseStart

    if (error) {
      health.components.supabase.status = 'unhealthy'
      health.components.supabase.error = error.message
      health.status = 'unhealthy'
    }
  } catch (error) {
    health.components.supabase.status = 'unhealthy'
    health.components.supabase.error =
      error instanceof Error ? error.message : 'Unknown Supabase error'
    health.status = 'unhealthy'
  }

  // Check Wasabi connectivity (readonly credentials)
  try {
    const wasabiStart = Date.now()

    // Lightweight operation: list chunks for a test video
    // If no test video exists, this will return empty array (still validates credentials)
    await listChunks('health-check-video', 1, 'default_user')

    health.components.wasabi.response_ms = Date.now() - wasabiStart
  } catch (error) {
    // Check if it's a credentials error vs just no chunks found
    const errorMessage = error instanceof Error ? error.message : 'Unknown Wasabi error'

    // Credentials errors will contain specific AWS error codes
    if (
      errorMessage.includes('InvalidAccessKeyId') ||
      errorMessage.includes('SignatureDoesNotMatch') ||
      errorMessage.includes('AccessDenied')
    ) {
      health.components.wasabi.status = 'unhealthy'
      health.components.wasabi.error = 'Invalid or expired Wasabi credentials'
      health.status = 'unhealthy'
    } else {
      // Other errors (network, timeout) are degraded but not critical
      health.components.wasabi.status = 'degraded'
      health.components.wasabi.error = errorMessage
      if (health.status === 'healthy') {
        health.status = 'degraded'
      }
    }
  }

  const totalTime = Date.now() - startTime

  // Return appropriate HTTP status
  const httpStatus = health.status === 'unhealthy' ? 503 : 200

  return json(
    {
      ...health,
      response_time_ms: totalTime,
    },
    {
      status: httpStatus,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    }
  )
}
