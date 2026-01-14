/**
 * Security Monitoring Dashboard API
 *
 * Platform admin endpoint for viewing security audit logs and detecting threats.
 * Provides access to:
 * - Recent security events (auth failures, cross-tenant attempts)
 * - Critical events requiring immediate attention
 * - Repeated attack patterns
 * - User risk scores
 */

import type { LoaderFunctionArgs } from 'react-router'

import { getCriticalEvents, getRepeatedCrossTenantAttempts } from '~/services/security-audit.server'
import { createServerSupabaseClient } from '~/services/supabase-client'
import { requireAuth } from '~/utils/api-auth'
import { errorResponse, jsonResponse } from '~/utils/api-responses'

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    // Require platform admin access
    const authContext = await requireAuth(request)

    if (!authContext.isPlatformAdmin) {
      return errorResponse('Forbidden: Platform admin access required', 403)
    }

    const url = new URL(request.url)
    const view = url.searchParams.get('view') ?? 'critical'
    const hoursBack = parseInt(url.searchParams.get('hours') ?? '24', 10)
    const minutesBack = parseInt(url.searchParams.get('minutes') ?? '15', 10)

    const supabase = createServerSupabaseClient()

    switch (view) {
      case 'critical': {
        // Get critical security events
        const criticalEvents = await getCriticalEvents(hoursBack)
        return jsonResponse({
          view: 'critical',
          timeWindow: `${hoursBack} hours`,
          events: criticalEvents,
          count: criticalEvents.length,
        })
      }

      case 'attacks': {
        // Detect repeated cross-tenant access attempts (potential attacks)
        const attacks = await getRepeatedCrossTenantAttempts(5, minutesBack)
        return jsonResponse({
          view: 'attacks',
          timeWindow: `${minutesBack} minutes`,
          threshold: 5,
          attacks,
          count: attacks.length,
        })
      }

      case 'recent': {
        // Get recent security events (all severities)
        const { data: recentEvents, error } = await supabase
          .from('security_audit_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100)

        if (error) {
          console.error('[Security Monitoring] Failed to fetch recent events:', error)
          return errorResponse('Failed to fetch security events', 500)
        }

        return jsonResponse({
          view: 'recent',
          events: recentEvents,
          count: recentEvents.length,
        })
      }

      case 'metrics': {
        // Get aggregated security metrics
        const { data: metrics, error: metricsError } = await supabase
          .from('security_metrics')
          .select('*')
          .order('time_bucket', { ascending: false })
          .limit(24) // Last 24 hours

        if (metricsError) {
          console.error('[Security Monitoring] Failed to fetch metrics:', metricsError)
          return errorResponse('Failed to fetch security metrics', 500)
        }

        return jsonResponse({
          view: 'metrics',
          timeWindow: '24 hours',
          buckets: metrics,
          count: metrics.length,
        })
      }

      case 'user': {
        // Get security summary for specific user
        const userId = url.searchParams.get('userId')

        if (!userId) {
          return errorResponse('userId parameter required for user view', 400)
        }

        const { data: userSummary, error: userError } = await supabase.rpc(
          'get_user_security_summary',
          {
            p_user_id: userId,
          }
        )

        if (userError) {
          console.error('[Security Monitoring] Failed to fetch user summary:', userError)
          return errorResponse('Failed to fetch user security summary', 500)
        }

        return jsonResponse({
          view: 'user',
          userId,
          summary: userSummary?.[0] ?? null,
        })
      }

      default:
        return errorResponse(`Unknown view: ${view}`, 400)
    }
  } catch (error) {
    console.error('[Security Monitoring] Error:', error)
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500)
  }
}
