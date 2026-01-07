# Better Stack Monitoring Setup

This guide walks you through setting up Better Stack (betterstack.com) for monitoring CaptionA.cc infrastructure.

## Overview

Better Stack provides:
- **Uptime Monitoring** - Ping health endpoints, get alerts on downtime
- **Heartbeat Monitoring** - Verify scheduled tasks run successfully
- **On-Call Scheduling** - Route alerts via email, SMS, phone call, Slack
- **Status Pages** - Optional public status page
- **Incident Management** - Group related failures into incidents

## Free Tier Limits

Better Stack Uptime free tier includes:
- ✅ 10 monitors
- ✅ 3-minute check interval
- ✅ Email and Slack notifications
- ✅ Phone call escalation (3/month)
- ✅ 30-day data retention

Perfect for our needs (we only need 2-3 monitors).

## Setup Instructions

### 1. Create Better Stack Account

1. Go to https://betterstack.com/uptime
2. Click "Start free trial" (no credit card required)
3. Sign up with email or GitHub
4. Verify email

### 2. Set Up Orchestrator Health Monitor

The orchestrator is always running, so we can monitor it continuously.

**Steps:**

1. **Dashboard → Create Monitor**
   - Click "Create Monitor" button

2. **Configure Monitor**:
   ```
   Monitor Type: HTTP(S)
   Name: CaptionA.cc Orchestrator
   URL: https://captionacc-orchestrator.fly.dev/health
   Pronounceable name: orchestrator

   Check frequency: Every 3 minutes (free tier)
   Request timeout: 10 seconds

   Expected status code: 200
   Confirmation period: 30 seconds (1 check)

   HTTP method: GET
   Follow redirects: Yes (default)
   Verify SSL: Yes (default)
   ```

3. **Configure Notifications** (on same page):
   - **Policy**: Default (or create custom)
   - **Incident notifications**: Enable
   - **Recovery notifications**: Enable
   - **Channels**: Add your email, phone, or Slack

4. **Advanced Settings** (optional):
   ```
   Request headers: (none needed)
   Request body: (none needed)

   Content matching: (optional - validate response)
   ├─ Expected phrase: "healthy"
   └─ Match type: Contains

   Custom status page: (skip for now)
   ```

5. **Click "Create Monitor"**

### 3. Set Up GitHub Actions Heartbeat Monitor

This monitors the daily health check workflow. If it doesn't run or fails, Better Stack alerts.

**Steps:**

1. **Dashboard → Create Monitor**
   - Click "Create Monitor" button
   - Select **"Heartbeat"** type

2. **Configure Heartbeat**:
   ```
   Name: Daily Health Check Workflow
   Pronounceable name: daily-health-check

   Heartbeat period: 25 hours
   (Slightly longer than 24h to account for timing variations)

   Grace period: 1 hour
   (Alert if no ping received within 25h + 1h = 26h total)
   ```

3. **Click "Create Heartbeat"**

4. **Copy Heartbeat URL**:
   - Better Stack will show a URL like:
     `https://uptime.betterstack.com/api/v1/heartbeat/abc123xyz`
   - Copy this URL

5. **Add to GitHub Secrets**:
   ```bash
   # Go to GitHub repo → Settings → Secrets → Actions
   # Add new secret:
   Name: BETTERSTACK_HEARTBEAT_URL
   Value: https://uptime.betterstack.com/api/v1/heartbeat/abc123xyz
   ```

6. **Test Heartbeat**:
   ```bash
   # Manually trigger workflow
   gh workflow run health-check-and-keepalive.yml

   # Wait 1-2 minutes, then check Better Stack dashboard
   # Should show "Last ping: 1 minute ago"
   ```

### 4. (Optional) Set Up Web App Health Monitor

**Important**: The web app auto-sleeps when idle. Continuous monitoring would keep it awake 24/7.

**Options**:

**Option A: Don't monitor web app separately** (Recommended)
- GitHub Actions workflow already checks it daily
- Heartbeat monitor covers this
- Allows web app to sleep (cost savings)

**Option B: Monitor with longer interval**
- Create monitor like orchestrator
- Set check frequency to **30 minutes** (max on free tier)
- This still prevents meaningful sleep time
- Not recommended unless web app should stay awake

**Option C: Monitor only /health calls from GitHub Actions**
- Don't create separate monitor
- Web app health is verified by the daily workflow
- Heartbeat covers this indirectly

**Recommendation**: Use Option A (no separate web app monitor)

### 5. Configure Notification Channels

Better Stack supports multiple notification methods:

**Email** (Built-in):
- Already enabled by default
- Uses your sign-up email
- Add more emails: Settings → Team → Invite members

**Phone Call** (Free tier: 3/month):
1. Dashboard → Settings → On-call → Escalation policies
2. Add phone number
3. Configure escalation timing (e.g., call after 10 min if email ignored)

**SMS** (Paid feature):
- Not available on free tier
- Upgrade if needed

**Slack** (Recommended):
1. Dashboard → Settings → Integrations → Slack
2. Click "Add to Slack"
3. Authorize Better Stack
4. Select Slack channel (e.g., #alerts, #monitoring)
5. Configure which alerts go to Slack

**Webhook** (Advanced):
- Dashboard → Settings → Integrations → Webhook
- Add webhook URL for custom integrations

### 6. Set Up On-Call Schedule (Optional)

If you have a team or want escalation:

1. **Dashboard → On-call → Create schedule**
2. **Configure**:
   ```
   Name: CaptionA.cc On-Call
   Timezone: Your timezone
   Rotation: None (solo dev) or Weekly/Daily
   Members: Add team members
   ```

3. **Configure Escalation Policy**:
   ```
   Level 1: Email → Wait 5 minutes
   Level 2: Phone call → Wait 10 minutes
   Level 3: Page on-call engineer (if multiple people)
   ```

### 7. Verify Setup

**Test Orchestrator Monitor**:
```bash
# Simulate failure by killing orchestrator
fly scale count 0 -a captionacc-orchestrator

# Wait 3-6 minutes
# Should receive Better Stack alert

# Restore
fly scale count 1 -a captionacc-orchestrator

# Should receive recovery notification
```

**Test Heartbeat Monitor**:
```bash
# Trigger workflow manually
gh workflow run health-check-and-keepalive.yml

# Check Better Stack dashboard
# Should show recent heartbeat ping

# To test failure: wait 26+ hours without running workflow
# (or temporarily disable workflow and wait)
```

## Better Stack Dashboard

After setup, your dashboard shows:

```
┌─────────────────────────────────────────────────┐
│ CaptionA.cc Orchestrator                        │
│ Status: ✅ UP (99.9% uptime)                    │
│ Last check: 2 minutes ago                       │
│ Response time: 145ms (avg)                      │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ Daily Health Check Workflow                     │
│ Status: ✅ BEATING                              │
│ Last ping: 3 hours ago                          │
│ Next expected: in 21 hours                      │
└─────────────────────────────────────────────────┘
```

## Alert Examples

### Orchestrator Down Alert

**Email Subject**: `🚨 [Incident] CaptionA.cc Orchestrator is DOWN`

**Email Body**:
```
Your monitor "CaptionA.cc Orchestrator" is reporting downtime.

URL: https://captionacc-orchestrator.fly.dev/health
Status: 503 Service Unavailable
Started: 2026-01-07 10:35:00 UTC
Duration: 5 minutes

Response: {"status":"unhealthy","components":{"wasabi":{"status":"unhealthy","error":"Invalid credentials"}}}

View incident: https://betterstack.com/incidents/12345
```

### Heartbeat Missing Alert

**Email Subject**: `🚨 [Incident] Daily Health Check Workflow missed`

**Email Body**:
```
Your heartbeat "Daily Health Check Workflow" hasn't checked in.

Expected: Every 25 hours
Last ping: 27 hours ago (2026-01-06 03:47 UTC)
Grace period: Exceeded by 1 hour

This usually means:
- GitHub Actions workflow failed
- Workflow was disabled
- GitHub Actions is down

View incident: https://betterstack.com/incidents/12346
```

## Incident Management

Better Stack groups related failures into incidents:

**Single Incident Example**:
```
Incident #12345: CaptionA.cc Orchestrator DOWN
Started: 10:35:00 UTC
Duration: 8 minutes

Timeline:
├─ 10:35:00 - First failure detected (check #1)
├─ 10:38:00 - Second failure (check #2)
├─ 10:38:30 - Incident created + alert sent
├─ 10:41:00 - Still down (check #3)
├─ 10:43:00 - Service recovered
└─ 10:43:00 - Incident resolved + recovery notification sent

Total downtime: 8 minutes
Checks during incident: 3 failed, 1 recovered
```

This prevents alert spam (you get 1 notification per incident, not per failed check).

## Integration with Fly.io

Better Stack complements Fly.io health checks:

| Feature | Fly.io Health Checks | Better Stack |
|---------|---------------------|--------------|
| Auto-restart on failure | ✅ Yes | ❌ No |
| External monitoring | ❌ No | ✅ Yes |
| Alert on downtime | ❌ No | ✅ Yes |
| Detect restart loops | ❌ No | ✅ Yes (via incidents) |
| Phone/email notifications | ❌ No | ✅ Yes |
| Historical uptime data | ❌ No | ✅ Yes |

**Together they provide**:
- Fly.io: Self-healing (auto-restart)
- Better Stack: Visibility + alerting

## Cost Analysis

**Free Tier (Current Setup)**:
- 2 monitors (orchestrator + heartbeat)
- 3-minute intervals
- Email + phone notifications (3 calls/month)
- 30-day retention
- **Cost**: $0/month

**If You Outgrow Free Tier**:
- Paid tier: $18/month
- Includes:
  - Unlimited monitors
  - 1-minute intervals
  - Unlimited phone calls
  - SMS notifications
  - 1-year retention
  - Status pages

## Maintenance

### Weekly
- ✅ Check Better Stack dashboard for uptime %
- ✅ Review any incidents from past week

### Monthly
- ✅ Review notification channels (still correct?)
- ✅ Test escalation (send test alert)
- ✅ Update on-call schedule if needed

### When Rotating Keys
- ✅ Check Better Stack immediately after rotation
- ✅ Verify monitors show "healthy" within 5 minutes
- ✅ If alerts fire, rollback credentials immediately

## Troubleshooting

### Monitor Shows "Paused"
**Cause**: Monitor was manually paused or hit free tier limits

**Fix**:
```bash
# Check monitor status
Dashboard → Monitors → Click monitor → Check "Status"

# If paused, click "Resume monitoring"
```

### False Positive Alerts
**Cause**: Transient network issues, aggressive timeout

**Fix**:
```bash
# Increase timeout
Dashboard → Edit Monitor → Request timeout: 10s → 15s

# Increase confirmation period
Dashboard → Edit Monitor → Confirmation period: 30s → 60s
# (Requires 2 consecutive failures before alerting)
```

### Heartbeat Not Updating
**Cause**: Wrong URL in GitHub secret, or workflow not running

**Fix**:
```bash
# Verify secret is set
gh secret list | grep BETTERSTACK

# Test URL manually
curl -fsS "$BETTERSTACK_HEARTBEAT_URL?status=success"

# Check workflow runs
gh run list --workflow=health-check-and-keepalive.yml --limit 5
```

## Related Documentation

- [Health Checks & Monitoring](./HEALTH_CHECKS.md)
- [Key Rotation Process](./KEY_ROTATION.md)
- [Better Stack Official Docs](https://betterstack.com/docs/uptime/)

## Summary

After completing this setup, you'll have:

1. ✅ **Continuous monitoring** of orchestrator health endpoint
2. ✅ **Daily verification** that GitHub Actions workflow runs
3. ✅ **Email/phone alerts** when issues detected
4. ✅ **Historical uptime data** for troubleshooting
5. ✅ **Incident management** (grouped alerts, not spam)
6. ✅ **Zero cost** (free tier is sufficient)

**Next Steps**:
1. Sign up at https://betterstack.com/uptime
2. Create 2 monitors (orchestrator + heartbeat)
3. Add `BETTERSTACK_HEARTBEAT_URL` secret to GitHub
4. Test both monitors
5. Done!
