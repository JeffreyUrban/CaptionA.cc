# Configuration Guide

All configuration is centralized in `fly.toml` with sensible defaults.

## Quick Reference

| Setting | Default | Purpose |
|---------|---------|---------|
| `DAILY_API_CALLS_LIMIT` | 1000 | Max GCP API calls per day |
| `JOBS_PER_MINUTE_LIMIT` | 10 | Rate limit per minute |
| `JOBS_PER_HOUR_LIMIT` | 100 | Rate limit per hour |
| `MAX_FRAMES_PER_JOB` | 950 | Max frames in one montage |

## Cost Protection Settings

### `DAILY_API_CALLS_LIMIT` (default: 1000)

**Primary cost protection.** Limits total API calls to Google Vision per day.

**Calculation:**
- 1000 calls/day × 300 frames/call (avg) = 300,000 images/day
- Cost: 300,000 / 1,000 × $1.50 = $450/day max
- At 950 frames/call (max): 950,000 images/day = $1,425/day max

**Adjust based on budget:**
```toml
[env]
  DAILY_API_CALLS_LIMIT = "100"   # $45-145/day
  DAILY_API_CALLS_LIMIT = "500"   # $225-712/day
  DAILY_API_CALLS_LIMIT = "2000"  # $900-2850/day
```

### `JOBS_PER_MINUTE_LIMIT` (default: 10)

**Prevents runaway loops.** If a bug causes infinite job submissions, this stops it quickly.

- 10/minute = 600/hour = reasonable for batch processing
- If hit: Returns 429 error, client must wait 60s

**Adjust for high-throughput:**
```toml
[env]
  JOBS_PER_MINUTE_LIMIT = "20"  # Higher throughput
  JOBS_PER_MINUTE_LIMIT = "5"   # More conservative
```

### `JOBS_PER_HOUR_LIMIT` (default: 100)

**Secondary rate limit.** Prevents sustained high usage.

- 100/hour = 2400/day (higher than daily limit, acts as safety)
- Usually not hit if daily limit is lower

## Technical Limits

### `MAX_FRAMES_PER_JOB` (default: 950)

**Technical constraint.** Based on testing (JPEG height limit).

⚠️ **Don't change** without re-testing. Limit is ~992 frames before hitting JPEG 65,500px height limit.

### `HEIGHT_LIMIT_PX` (default: 50000)

Conservative height limit for montages.

### `FILE_SIZE_LIMIT_MB` (default: 15)

Conservative file size limit (GCP allows 20MB).

## Job Management

### `JOB_RESULT_TTL_SECONDS` (default: 3600)

How long to keep job results (1 hour).

- Longer = more deduplication benefit
- Shorter = less memory usage

### `MAX_CONCURRENT_JOBS` (default: 5)

Max jobs processing in parallel.

- Limited by CPU/memory
- Fly.io shared-cpu-2x handles 5 well

## Circuit Breaker

### `CIRCUIT_BREAKER_THRESHOLD` (default: 5)

Failures before stopping all processing.

- 5 consecutive failures → stop accepting jobs for 5 minutes
- Prevents cascading failures if GCP Vision API is down

### `CIRCUIT_BREAKER_TIMEOUT_SECONDS` (default: 300)

How long to wait before trying again (5 minutes).

## How to Change Settings

### Option 1: Edit fly.toml (Recommended)

```toml
[env]
  DAILY_API_CALLS_LIMIT = "2000"  # Double the limit
```

Then deploy:
```bash
flyctl deploy
```

### Option 2: Override with Secrets (for sensitive values)

```bash
flyctl secrets set DAILY_API_CALLS_LIMIT=2000
```

**Note:** Secrets override `fly.toml` values.

### Option 3: Local Development (.env file)

```bash
# .env
DAILY_API_CALLS_LIMIT=10000
JOBS_PER_MINUTE_LIMIT=100
```

Load with:
```bash
set -a; source .env; set +a
python app.py
```

## Monitoring Current Limits

Check active configuration:

```bash
curl https://captionacc-ocr.fly.dev/health
```

Returns:
```json
{
  "status": "healthy",
  "config": {
    "daily_api_calls_limit": 1000,
    "jobs_per_minute_limit": 10,
    ...
  }
}
```

## Cost Estimation

| Daily Limit | Images/day (avg 300/job) | Images/day (max 950/job) | Cost/day |
|-------------|--------------------------|--------------------------|----------|
| 100 | 30,000 | 95,000 | $45-143 |
| 500 | 150,000 | 475,000 | $225-713 |
| 1000 | 300,000 | 950,000 | $450-1425 |
| 2000 | 600,000 | 1,900,000 | $900-2850 |

## GCP Budget Alerts (TODO - Set Up Manually)

**IMPORTANT:** Also set up GCP budget alerts as a safety net:

1. Go to: https://console.cloud.google.com/billing/budgets
2. Create Budget
   - Name: "Vision API Monthly Budget"
   - Budget amount: $500/month (or your preferred limit)
   - Alert thresholds: 50%, 90%, 100%, 110%
   - Email notifications: your-team@example.com

3. Optional: Set up programmatic notifications:
   - Pub/Sub topic for budget alerts
   - Cloud Function to disable service if budget exceeded

**This is your last line of defense** if service limits are bypassed or misconfigured.

## Phase 3 (Optional Future Work)

Consider implementing:

1. **GCP Pub/Sub Integration**
   - Auto-disable service when budget alert triggers
   - Requires Cloud Function + Pub/Sub setup

2. **Multi-level Quotas**
   - Per-user limits
   - Per-video limits
   - Per-project limits

3. **Advanced Monitoring**
   - Prometheus metrics export
   - Grafana dashboards
   - PagerDuty alerts

4. **Redis Backend**
   - Persistent job storage
   - Multi-instance coordination
   - Better deduplication across restarts

## Troubleshooting

### "Daily limit reached" error

Current usage exceeds `DAILY_API_CALLS_LIMIT`.

**Solution:** Wait until next day OR increase limit temporarily:

```bash
flyctl secrets set DAILY_API_CALLS_LIMIT=2000
```

### "Rate limit" error

Too many jobs submitted in short time.

**Solution:** Implement client-side backoff OR increase limits if intentional.

### Jobs stuck in "processing"

Check logs:
```bash
flyctl logs
```

Might be circuit breaker open or GCP API issues.

## Best Practices

1. **Start conservative** (default 1000/day) and increase based on actual usage
2. **Monitor costs** via GCP Console billing dashboard
3. **Set GCP budget alerts** as backup protection
4. **Review logs weekly** to understand usage patterns
5. **Adjust limits seasonally** if usage varies
