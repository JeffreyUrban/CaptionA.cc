/**
 * Security Audit Logging Service
 *
 * Logs security events to Supabase for monitoring and alerting.
 * Used by authentication/authorization middleware to track:
 * - Authentication failures
 * - Authorization failures
 * - Cross-tenant access attempts
 * - Suspicious activity patterns
 */

import { createServerSupabaseClient } from '~/services/supabase-client'

export type SecurityEventType =
  | 'auth_success'
  | 'auth_failure'
  | 'authz_failure'
  | 'cross_tenant_attempt'
  | 'suspicious_activity'

export type SecuritySeverity = 'info' | 'warning' | 'critical'

export interface SecurityAuditEvent {
  eventType: SecurityEventType
  severity: SecuritySeverity
  userId?: string
  tenantId?: string
  resourceType?: string
  resourceId?: string
  targetTenantId?: string // For cross-tenant attempts
  ipAddress?: string
  userAgent?: string
  requestPath?: string
  requestMethod?: string
  errorMessage?: string
  metadata?: Record<string, unknown>
}

/**
 * Log a security event to the audit log
 *
 * This uses the service role client to bypass RLS and write audit logs.
 * Never throws - logs errors to console to prevent audit failures from breaking requests.
 */
export async function logSecurityEvent(event: SecurityAuditEvent): Promise<void> {
  try {
    const supabase = createServerSupabaseClient()

    await supabase.from('security_audit_log').insert({
      event_type: event.eventType,
      severity: event.severity,
      user_id: event.userId || null,
      tenant_id: event.tenantId || null,
      resource_type: event.resourceType || null,
      resource_id: event.resourceId || null,
      target_tenant_id: event.targetTenantId || null,
      ip_address: event.ipAddress || null,
      user_agent: event.userAgent || null,
      request_path: event.requestPath || null,
      request_method: event.requestMethod || null,
      error_message: event.errorMessage || null,
      metadata: event.metadata || null,
    })

    // Log critical events to console for immediate visibility
    if (event.severity === 'critical') {
      console.warn('[SECURITY AUDIT - CRITICAL]', {
        eventType: event.eventType,
        userId: event.userId,
        tenantId: event.tenantId,
        targetTenantId: event.targetTenantId,
        resourceId: event.resourceId,
        errorMessage: event.errorMessage,
      })
    }
  } catch (error) {
    // Never throw from audit logging - log error but don't break request
    console.error('[Security Audit] Failed to log event:', error, event)
  }
}

/**
 * Extract request metadata for audit logging
 */
export function extractRequestMetadata(request: Request): {
  ipAddress?: string
  userAgent?: string
  requestPath: string
  requestMethod: string
} {
  const url = new URL(request.url)

  return {
    ipAddress:
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
    requestPath: url.pathname,
    requestMethod: request.method,
  }
}

/**
 * Log successful authentication
 */
export async function logAuthSuccess(
  request: Request,
  userId: string,
  tenantId: string
): Promise<void> {
  const metadata = extractRequestMetadata(request)

  await logSecurityEvent({
    eventType: 'auth_success',
    severity: 'info',
    userId,
    tenantId,
    ...metadata,
  })
}

/**
 * Log authentication failure
 */
export async function logAuthFailure(request: Request, errorMessage?: string): Promise<void> {
  const metadata = extractRequestMetadata(request)

  await logSecurityEvent({
    eventType: 'auth_failure',
    severity: 'warning',
    errorMessage,
    ...metadata,
  })
}

/**
 * Log authorization failure (authenticated but not authorized)
 */
export async function logAuthzFailure(
  request: Request,
  userId: string,
  tenantId: string,
  resourceType: string,
  resourceId: string,
  errorMessage?: string
): Promise<void> {
  const metadata = extractRequestMetadata(request)

  await logSecurityEvent({
    eventType: 'authz_failure',
    severity: 'warning',
    userId,
    tenantId,
    resourceType,
    resourceId,
    errorMessage,
    ...metadata,
  })
}

/**
 * Log cross-tenant access attempt (CRITICAL)
 *
 * This is logged when a user from one tenant attempts to access
 * resources belonging to a different tenant.
 */
export async function logCrossTenantAttempt(
  request: Request,
  userId: string,
  userTenantId: string,
  targetTenantId: string,
  resourceType: string,
  resourceId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const requestMetadata = extractRequestMetadata(request)

  await logSecurityEvent({
    eventType: 'cross_tenant_attempt',
    severity: 'critical',
    userId,
    tenantId: userTenantId,
    targetTenantId,
    resourceType,
    resourceId,
    errorMessage: `User from tenant ${userTenantId} attempted to access ${resourceType} ${resourceId} from tenant ${targetTenantId}`,
    metadata: {
      ...metadata,
      ...requestMetadata,
    },
    ...requestMetadata,
  })
}

/**
 * Log suspicious activity pattern
 */
export async function logSuspiciousActivity(
  request: Request,
  userId: string | undefined,
  tenantId: string | undefined,
  description: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const requestMetadata = extractRequestMetadata(request)

  await logSecurityEvent({
    eventType: 'suspicious_activity',
    severity: 'critical',
    userId,
    tenantId,
    errorMessage: description,
    metadata: {
      ...metadata,
      ...requestMetadata,
    },
    ...requestMetadata,
  })
}

/**
 * Check for repeated cross-tenant access attempts
 * Returns users who have made multiple cross-tenant access attempts recently
 */
export async function getRepeatedCrossTenantAttempts(
  threshold: number = 5,
  minutesBack: number = 15
): Promise<
  Array<{
    user_id: string
    user_email: string | null
    tenant_id: string
    attempt_count: number
    distinct_targets: number
    last_attempt: string
  }>
> {
  try {
    const supabase = createServerSupabaseClient()

    const { data, error } = await supabase.rpc('detect_repeated_cross_tenant_attempts', {
      threshold,
      minutes_back: minutesBack,
    })

    if (error) {
      console.error('[Security Audit] Failed to check repeated attempts:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('[Security Audit] Error checking repeated attempts:', error)
    return []
  }
}

/**
 * Get critical security events within time window
 */
export async function getCriticalEvents(hoursBack: number = 24): Promise<
  Array<{
    event_id: number
    event_type: string
    user_id: string | null
    tenant_id: string | null
    target_tenant_id: string | null
    resource_type: string | null
    resource_id: string | null
    error_message: string | null
    created_at: string
  }>
> {
  try {
    const supabase = createServerSupabaseClient()

    const { data, error } = await supabase.rpc('get_critical_security_events', {
      hours_back: hoursBack,
    })

    if (error) {
      console.error('[Security Audit] Failed to get critical events:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('[Security Audit] Error getting critical events:', error)
    return []
  }
}
