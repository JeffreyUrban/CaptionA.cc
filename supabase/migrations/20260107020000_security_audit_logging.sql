-- Security Audit Logging
-- Tracks authentication events, authorization failures, and suspicious access patterns

-- ============================================================================
-- Security Audit Log Table
-- ============================================================================

CREATE TABLE captionacc_production.security_audit_log (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,  -- 'auth_success', 'auth_failure', 'authz_failure', 'cross_tenant_attempt', 'suspicious_activity'
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  user_id UUID REFERENCES auth.users(id),
  tenant_id UUID REFERENCES captionacc_production.tenants(id),
  resource_type TEXT,  -- 'video', 'annotation', 'database', etc.
  resource_id TEXT,  -- UUID of resource being accessed
  target_tenant_id UUID,  -- For cross-tenant attempts: which tenant they tried to access
  ip_address INET,
  user_agent TEXT,
  request_path TEXT,
  request_method TEXT,  -- GET, POST, DELETE, etc.
  error_message TEXT,
  metadata JSONB,  -- Additional context (e.g., {"video_owner": "...", "attempted_by": "..."})
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying and alerting
CREATE INDEX idx_security_audit_event_type ON captionacc_production.security_audit_log(event_type, created_at DESC);
CREATE INDEX idx_security_audit_severity ON captionacc_production.security_audit_log(severity, created_at DESC);
CREATE INDEX idx_security_audit_user ON captionacc_production.security_audit_log(user_id, created_at DESC);
CREATE INDEX idx_security_audit_tenant ON captionacc_production.security_audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_security_audit_target_tenant ON captionacc_production.security_audit_log(target_tenant_id, created_at DESC) WHERE target_tenant_id IS NOT NULL;
CREATE INDEX idx_security_audit_created ON captionacc_production.security_audit_log(created_at DESC);

-- Enable RLS
ALTER TABLE captionacc_production.security_audit_log ENABLE ROW LEVEL SECURITY;

-- Only platform admins can view audit logs
CREATE POLICY "Platform admins view audit logs"
  ON captionacc_production.security_audit_log FOR SELECT
  USING (is_platform_admin());

-- Service role can insert audit logs (used by application)
CREATE POLICY "Service role inserts audit logs"
  ON captionacc_production.security_audit_log FOR INSERT
  WITH CHECK (true);  -- Service role bypasses RLS, but explicit policy for clarity

COMMENT ON TABLE captionacc_production.security_audit_log IS 'Security audit trail for auth/authz events, cross-tenant access attempts, and suspicious activity';
COMMENT ON COLUMN captionacc_production.security_audit_log.event_type IS 'Type of security event: auth_success, auth_failure, authz_failure, cross_tenant_attempt, suspicious_activity';
COMMENT ON COLUMN captionacc_production.security_audit_log.severity IS 'Event severity for alerting: info (normal), warning (review), critical (immediate attention)';
COMMENT ON COLUMN captionacc_production.security_audit_log.target_tenant_id IS 'For cross-tenant attempts: the tenant_id they tried to access (different from their own tenant_id)';

-- ============================================================================
-- Security Metrics View
-- ============================================================================

CREATE VIEW captionacc_production.security_metrics AS
SELECT
  DATE_TRUNC('hour', created_at) as time_bucket,
  event_type,
  severity,
  COUNT(*) as event_count,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(DISTINCT tenant_id) as unique_tenants
FROM captionacc_production.security_audit_log
GROUP BY DATE_TRUNC('hour', created_at), event_type, severity
ORDER BY time_bucket DESC;

COMMENT ON VIEW captionacc_production.security_metrics IS 'Aggregated security metrics for monitoring dashboards';

-- ============================================================================
-- Alert Functions
-- ============================================================================

-- Function to get recent critical security events
CREATE OR REPLACE FUNCTION get_critical_security_events(
  hours_back INTEGER DEFAULT 24
)
RETURNS TABLE (
  event_id BIGINT,
  event_type TEXT,
  user_id UUID,
  tenant_id UUID,
  target_tenant_id UUID,
  resource_type TEXT,
  resource_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sal.id,
    sal.event_type,
    sal.user_id,
    sal.tenant_id,
    sal.target_tenant_id,
    sal.resource_type,
    sal.resource_id,
    sal.error_message,
    sal.created_at
  FROM captionacc_production.security_audit_log sal
  WHERE sal.severity = 'critical'
    AND sal.created_at > NOW() - (hours_back || ' hours')::INTERVAL
  ORDER BY sal.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION get_critical_security_events IS 'Get critical security events within specified time window for alerting';

-- Function to detect repeated cross-tenant access attempts (potential attack)
CREATE OR REPLACE FUNCTION detect_repeated_cross_tenant_attempts(
  threshold INTEGER DEFAULT 5,
  minutes_back INTEGER DEFAULT 15
)
RETURNS TABLE (
  user_id UUID,
  user_email TEXT,
  tenant_id UUID,
  attempt_count BIGINT,
  distinct_targets INTEGER,
  last_attempt TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sal.user_id,
    au.email as user_email,
    sal.tenant_id,
    COUNT(*) as attempt_count,
    COUNT(DISTINCT sal.target_tenant_id)::INTEGER as distinct_targets,
    MAX(sal.created_at) as last_attempt
  FROM captionacc_production.security_audit_log sal
  LEFT JOIN auth.users au ON au.id = sal.user_id
  WHERE sal.event_type = 'cross_tenant_attempt'
    AND sal.created_at > NOW() - (minutes_back || ' minutes')::INTERVAL
  GROUP BY sal.user_id, au.email, sal.tenant_id
  HAVING COUNT(*) >= threshold
  ORDER BY attempt_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION detect_repeated_cross_tenant_attempts IS 'Detect users making repeated cross-tenant access attempts (potential security threat)';

-- Function to get user security summary
CREATE OR REPLACE FUNCTION get_user_security_summary(p_user_id UUID)
RETURNS TABLE (
  total_events BIGINT,
  auth_failures BIGINT,
  authz_failures BIGINT,
  cross_tenant_attempts BIGINT,
  last_suspicious_activity TIMESTAMPTZ,
  risk_score INTEGER
) AS $$
DECLARE
  v_total BIGINT;
  v_auth_fail BIGINT;
  v_authz_fail BIGINT;
  v_cross_tenant BIGINT;
  v_last_suspicious TIMESTAMPTZ;
  v_risk INTEGER;
BEGIN
  -- Get event counts
  SELECT COUNT(*) INTO v_total
  FROM captionacc_production.security_audit_log
  WHERE user_id = p_user_id;

  SELECT COUNT(*) INTO v_auth_fail
  FROM captionacc_production.security_audit_log
  WHERE user_id = p_user_id AND event_type = 'auth_failure';

  SELECT COUNT(*) INTO v_authz_fail
  FROM captionacc_production.security_audit_log
  WHERE user_id = p_user_id AND event_type = 'authz_failure';

  SELECT COUNT(*) INTO v_cross_tenant
  FROM captionacc_production.security_audit_log
  WHERE user_id = p_user_id AND event_type = 'cross_tenant_attempt';

  SELECT MAX(created_at) INTO v_last_suspicious
  FROM captionacc_production.security_audit_log
  WHERE user_id = p_user_id AND severity IN ('warning', 'critical');

  -- Calculate simple risk score (0-100)
  v_risk := LEAST(100, (v_auth_fail * 2) + (v_authz_fail * 5) + (v_cross_tenant * 10));

  RETURN QUERY SELECT v_total, v_auth_fail, v_authz_fail, v_cross_tenant, v_last_suspicious, v_risk;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION get_user_security_summary IS 'Get security summary and risk score for a user';
