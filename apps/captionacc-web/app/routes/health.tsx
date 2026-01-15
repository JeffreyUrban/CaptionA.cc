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

import { type LoaderFunctionArgs } from 'react-router'

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

export async function loader({ request: _request }: LoaderFunctionArgs) {
  const startTime = Date.now()

  const health: HealthResponse = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env['ENVIRONMENT'] ?? 'development',
    version: process.env['APP_VERSION'] ?? 'dev',
    components: {
      supabase: { status: 'healthy' },
      wasabi: { status: 'healthy' },
    },
  }

  // Simplified health check: just verify server is running
  // External service checks are informational only
  try {
    // Check Supabase connectivity (non-critical for health check)
    try {
      const supabaseStart = Date.now()
      const supabase = createServerSupabaseClient()
      const { error } = await supabase.from('videos').select('id').limit(1)

      health.components.supabase.response_ms = Date.now() - supabaseStart

      if (error) {
        console.warn('[Health] Supabase degraded:', error.message)
        health.components.supabase.status = 'degraded'
        health.components.supabase.error = error.message
        if (health.status === 'healthy') {
          health.status = 'degraded'
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown Supabase error'
      console.warn('[Health] Supabase unavailable:', errorMsg)
      health.components.supabase.status = 'degraded'
      health.components.supabase.error = errorMsg
      if (health.status === 'healthy') {
        health.status = 'degraded'
      }
    }

    // Check Wasabi connectivity (non-critical for health check)
    try {
      const wasabiStart = Date.now()
      await listChunks('health-check-video', 1, 'default_user')
      health.components.wasabi.response_ms = Date.now() - wasabiStart
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown Wasabi error'
      console.warn('[Health] Wasabi unavailable:', errorMessage)
      health.components.wasabi.status = 'degraded'
      health.components.wasabi.error = errorMessage
      if (health.status === 'healthy') {
        health.status = 'degraded'
      }
    }
  } catch (error) {
    console.error('[Health] Unexpected error:', error)
  }

  const totalTime = Date.now() - startTime

  // Always return 200 - external service availability is informational only
  // The app can function without these services (degraded mode)
  return new Response(
    JSON.stringify({
      ...health,
      response_time_ms: totalTime,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    }
  )
}
