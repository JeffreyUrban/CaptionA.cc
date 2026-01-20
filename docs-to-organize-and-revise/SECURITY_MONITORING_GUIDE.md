# Security Monitoring & Incident Response Guide

Quick reference for platform administrators to monitor security, detect threats, and respond to incidents.

## Quick Links

- [Security Dashboard](#accessing-the-security-dashboard)
- [Daily Monitoring](#daily-monitoring-routine)
- [Alert Types](#understanding-alert-severity)
- [Incident Response](#incident-response-procedures)

---

## Accessing the Security Dashboard

### Web Interface

```bash
# Access security monitoring dashboard
https://your-app.fly.dev/api/admin/security
```

**Authentication required**: Platform admin access only

### API Endpoints

```bash
# Critical events (last 24 hours)
GET /api/admin/security?view=critical&hours=24

# Detect ongoing attacks (last 15 minutes)
GET /api/admin/security?view=attacks&minutes=15

# Recent events (all severities, last 100)
GET /api/admin/security?view=recent

# Hourly metrics
GET /api/admin/security?view=metrics

# User security summary
GET /api/admin/security?view=user&userId=<uuid>
```

### Direct Database Access

```bash
# SSH into Fly.io app
fly ssh console

# Connect to Supabase
psql $SUPABASE_URL
```

```sql
-- View recent critical events
SELECT * FROM get_critical_security_events(24);

-- Detect repeated cross-tenant attempts
SELECT * FROM detect_repeated_cross_tenant_attempts(5, 15);

-- Query audit log directly
SELECT
  event_type,
  severity,
  user_id,
  tenant_id,
  target_tenant_id,
  error_message,
  created_at
FROM captionacc_prod.security_audit_log
WHERE severity = 'critical'
ORDER BY created_at DESC
LIMIT 50;
```

---

## Daily Monitoring Routine

### Morning Check (5 minutes)

**1. Critical Events** (zero tolerance - investigate immediately)

```bash
curl "https://your-app.fly.dev/api/admin/security?view=critical&hours=24" \
  -H "Authorization: Bearer $TOKEN"
```

**Look for**:
- `cross_tenant_attempt` - User trying to access another tenant's data
- `suspicious_activity` - Unusual patterns detected

**Action**: If any critical events found, proceed to [Incident Response](#incident-response-procedures)

**2. Attack Detection** (repeated failed attempts)

```bash
curl "https://your-app.fly.dev/api/admin/security?view=attacks&minutes=15" \
  -H "Authorization: Bearer $TOKEN"
```

**Look for**:
- Users with 5+ cross-tenant attempts in 15 minutes
- Same user attempting access to multiple different tenants

**Action**: Review user account, consider suspending if malicious

### Weekly Review (15 minutes)

**3. Authentication Failures**

```sql
-- Users with repeated auth failures
SELECT
  user_id,
  COUNT(*) as failure_count,
  MAX(created_at) as last_failure
FROM captionacc_prod.security_audit_log
WHERE event_type = 'auth_failure'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY user_id
HAVING COUNT(*) > 10
ORDER BY failure_count DESC;
```

**Look for**:
- Brute force attempts (many failures for same user)
- Credential stuffing (many failures across different users)

**Action**: Consider rate limiting, temporary account lock

**4. Authorization Patterns**

```sql
-- Authorization failures by resource type
SELECT
  resource_type,
  COUNT(*) as failure_count,
  COUNT(DISTINCT user_id) as unique_users
FROM captionacc_prod.security_audit_log
WHERE event_type = 'authz_failure'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY resource_type
ORDER BY failure_count DESC;
```

**Look for**:
- Spikes in authz failures (application bug or attack)
- Unusual resource types being accessed

### Monthly Review (30 minutes)

**5. Security Metrics Trends**

```sql
-- Weekly security event trends
SELECT
  DATE_TRUNC('week', created_at) as week,
  event_type,
  severity,
  COUNT(*) as event_count
FROM captionacc_prod.security_audit_log
WHERE created_at > NOW() - INTERVAL '3 months'
GROUP BY week, event_type, severity
ORDER BY week DESC, event_count DESC;
```

**Look for**:
- Increasing trends in failures
- New attack patterns emerging
- Changes in user behavior

**6. User Risk Scores**

```sql
-- Top 10 highest risk users
SELECT
  u.email,
  s.total_events,
  s.auth_failures,
  s.authz_failures,
  s.cross_tenant_attempts,
  s.risk_score
FROM auth.users u
CROSS JOIN LATERAL (
  SELECT * FROM get_user_security_summary(u.id)
) s
WHERE s.risk_score > 20
ORDER BY s.risk_score DESC
LIMIT 10;
```

**Action**: Review high-risk users, investigate suspicious accounts

---

## Understanding Alert Severity

### INFO (Informational)

**Event Types**: `auth_success`

**What it means**: Normal system operation

**Action required**: None - logged for audit trail

**Example**:
```json
{
  "event_type": "auth_success",
  "severity": "info",
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "tenant_id": "00000000-0000-0000-0000-000000000001"
}
```

### WARNING (Review Recommended)

**Event Types**: `auth_failure`, `authz_failure`

**What it means**: Failed access attempt (could be legitimate mistake or attack probe)

**Action required**: Review if repeated (5+ attempts), investigate pattern

**Example**:
```json
{
  "event_type": "auth_failure",
  "severity": "warning",
  "error_message": "Invalid password",
  "ip_address": "192.168.1.100"
}
```

**When to escalate**:
- Same user failing auth 10+ times in 1 hour (possible brute force)
- Same IP failing auth for 100+ different users (credential stuffing)
- Authorization failures to same resource repeatedly (broken client)

### CRITICAL (Immediate Action Required)

**Event Types**: `cross_tenant_attempt`, `suspicious_activity`

**What it means**: Potential security breach or active attack

**Action required**: Investigate immediately, follow incident response procedures

**Example - Cross-Tenant Attempt**:
```json
{
  "event_type": "cross_tenant_attempt",
  "severity": "critical",
  "user_id": "user_from_tenant_A",
  "tenant_id": "tenant_A",
  "target_tenant_id": "tenant_B",
  "resource_type": "video",
  "resource_id": "video_in_tenant_B",
  "error_message": "User from tenant A attempted to access video from tenant B"
}
```

**Red flags**:
- Same user attempting cross-tenant access to 3+ different tenants
- User attempting to access videos immediately after signup
- Patterns of sequential UUID guessing (e.g., incrementing last digit)

---

## Incident Response Procedures

### CRITICAL: Cross-Tenant Access Attempt

**Detection**: `cross_tenant_attempt` event in audit log

**Immediate Actions** (within 15 minutes):

1. **Identify the user**

   ```sql
   SELECT
     u.id,
     u.email,
     u.created_at,
     up.tenant_id,
     up.role,
     up.approval_status
   FROM auth.users u
   JOIN captionacc_prod.user_profiles up ON up.id = u.id
   WHERE u.id = '<user_id_from_alert>';
   ```

2. **Get full context**

   ```sql
   -- All security events for this user
   SELECT *
   FROM captionacc_prod.security_audit_log
   WHERE user_id = '<user_id_from_alert>'
   ORDER BY created_at DESC
   LIMIT 100;
   ```

3. **Check if data was actually accessed**

   RLS should have blocked, but verify:

   ```sql
   -- Did user successfully query videos table?
   SELECT * FROM captionacc_prod.videos
   WHERE tenant_id = '<target_tenant_id>'
     AND id IN (
       SELECT resource_id::UUID
       FROM captionacc_prod.security_audit_log
       WHERE user_id = '<user_id_from_alert>'
         AND event_type = 'cross_tenant_attempt'
     );
   -- Should return 0 rows (RLS blocked access)
   ```

4. **Containment** (choose based on severity)

   **Option A - Suspend approval** (reversible):
   ```sql
   UPDATE captionacc_prod.user_profiles
   SET approval_status = 'rejected'
   WHERE id = '<user_id_from_alert>';
   ```

   **Option B - Revoke session** (forces re-login):
   ```sql
   -- Via Supabase Dashboard or API
   -- Auth > Users > [select user] > Sign out
   ```

   **Option C - Delete account** (if clearly malicious):
   ```sql
   -- Soft delete all videos first
   UPDATE captionacc_prod.videos
   SET deleted_at = NOW()
   WHERE uploaded_by_user_id = '<user_id_from_alert>';

   -- Delete user (cascades to profile)
   DELETE FROM auth.users WHERE id = '<user_id_from_alert>';
   ```

5. **Notify**

   - Post in #security Slack channel
   - Document in incident log
   - If data breach suspected, follow breach notification procedures

**Follow-up Actions** (within 24 hours):

1. **Root cause analysis**

   - Was this a malicious attempt or application bug?
   - How did user discover the target video ID?
   - Was this targeted or random UUID guessing?

2. **Verify RLS effectiveness**

   - Confirm RLS policies blocked actual data access
   - Test RLS policies manually in staging

3. **Review detection**

   - Did monitoring detect it quickly?
   - Are there other similar patterns we missed?

4. **Harden if needed**

   - Add rate limiting if pattern detected
   - Implement additional validation
   - Update RLS policies if weakness found

### WARNING: Repeated Authentication Failures

**Detection**: 10+ auth failures for same user in 1 hour

**Actions**:

1. **Determine cause**

   ```sql
   SELECT
     ip_address,
     user_agent,
     error_message,
     COUNT(*) as attempts
   FROM captionacc_prod.security_audit_log
   WHERE event_type = 'auth_failure'
     AND created_at > NOW() - INTERVAL '1 hour'
   GROUP BY ip_address, user_agent, error_message
   ORDER BY attempts DESC;
   ```

2. **Legitimate user** (forgot password):
   - No action needed - normal behavior
   - User will use password reset flow

3. **Brute force attack**:
   - Implement rate limiting for this IP
   - Consider blocking IP at Fly.io level
   - Notify user if account targeted

4. **Credential stuffing** (many users, same IP):
   - Block IP immediately
   - Force password reset for affected accounts
   - Add to threat intelligence list

### Suspicious Activity Patterns

**Pattern 1: Sequential UUID Guessing**

```sql
-- Detect users accessing videos in sequential pattern
SELECT
  user_id,
  ARRAY_AGG(resource_id ORDER BY created_at) as accessed_ids,
  COUNT(*) as access_count
FROM captionacc_prod.security_audit_log
WHERE event_type IN ('authz_failure', 'cross_tenant_attempt')
  AND resource_type = 'video'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY user_id
HAVING COUNT(*) > 10;
```

**Action**: If detected, suspend user immediately, investigate pattern

**Pattern 2: Rapid Account Creation**

```sql
-- Multiple signups from same IP
SELECT
  ip_address,
  COUNT(DISTINCT user_id) as user_count,
  ARRAY_AGG(DISTINCT user_id) as user_ids
FROM captionacc_prod.security_audit_log
WHERE event_type = 'auth_success'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY ip_address
HAVING COUNT(DISTINCT user_id) > 5;
```

**Action**: May be legitimate (office network) or malicious (bot signups). Investigate.

**Pattern 3: Unusual Access Hours**

```sql
-- Access during off-hours (midnight - 6am)
SELECT
  user_id,
  COUNT(*) as night_access_count
FROM captionacc_prod.security_audit_log
WHERE event_type = 'auth_success'
  AND EXTRACT(HOUR FROM created_at) BETWEEN 0 AND 6
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY user_id
HAVING COUNT(*) > 20;
```

**Action**: May be normal for global users, but investigate if combined with other red flags

---

## Alerting Setup (Future)

### Slack Integration

```sql
-- Function to send Slack alert (example)
CREATE OR REPLACE FUNCTION send_slack_alert(
  webhook_url TEXT,
  message TEXT
) RETURNS VOID AS $$
BEGIN
  -- Use HTTP extension to POST to Slack webhook
  PERFORM http_post(
    webhook_url,
    jsonb_build_object('text', message)::TEXT,
    'application/json'
  );
END;
$$ LANGUAGE plpgsql;
```

**Trigger on critical events**:

```sql
-- Notify Slack on cross-tenant attempts
CREATE OR REPLACE FUNCTION notify_critical_events()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.severity = 'critical' THEN
    PERFORM send_slack_alert(
      'https://hooks.slack.com/services/YOUR/WEBHOOK/URL',
      format(
        '🚨 CRITICAL SECURITY EVENT: %s\nUser: %s\nTenant: %s\nTarget: %s\nResource: %s %s',
        NEW.event_type,
        NEW.user_id,
        NEW.tenant_id,
        NEW.target_tenant_id,
        NEW.resource_type,
        NEW.resource_id
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER alert_critical_events
AFTER INSERT ON captionacc_prod.security_audit_log
FOR EACH ROW
WHEN (NEW.severity = 'critical')
EXECUTE FUNCTION notify_critical_events();
```

---

## Security Contacts

**On-Call Rotation**: TBD

**Escalation Path**:
1. Platform Admin (immediate response)
2. CTO (major incidents)
3. Legal/Compliance (data breach)

**Communication Channels**:
- #security (Slack)
- security@yourcompany.com
- PagerDuty (critical alerts)

---

**Last Updated**: 2026-01-07
**Maintained By**: Platform Admin Team
