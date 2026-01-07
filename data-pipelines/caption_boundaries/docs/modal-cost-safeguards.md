# Modal Cost Safeguards

**Last Updated:** 2026-01-07

## Configuration File

**IMPORTANT:** All cost and safety limits are centralized in:
```
data-pipelines/caption_boundaries/src/caption_boundaries/inference/config.py
```

This file contains:
- Frame count limits (max video length)
- Concurrency limits (max parallel containers)
- Timeout settings (hung process protection)
- Cost thresholds (job rejection limits)
- Batch sizes (GPU memory optimization)

**Review this file before modifying any limits.** The configuration includes detailed documentation about cost implications and when to adjust each setting.

## Overview

Modal GPU inference costs ~$1.10/hr for A10G. For 25k frame pairs at ~100 pairs/sec, each job takes ~4-5 minutes = **~$0.08-0.10 per video**. While individual jobs are cheap, runaway scenarios could rack up significant costs.

## Cost Scenarios

### Normal Operations
- Single video: ~$0.10
- 10 videos/day: ~$1/day = ~$30/month
- 100 videos/day: ~$10/day = ~$300/month

### Runaway Scenarios
- **Infinite loop bug**: Continuous job submissions → thousands per hour
- **Retry storm**: Failed jobs retrying indefinitely
- **Duplicate submissions**: Same video processed multiple times
- **Memory leak**: Container doesn't release, idle timeout doesn't trigger
- **Malicious actor**: API abuse submitting fake jobs

**Worst case**: Uncapped could hit $1,000+/day ($30k/month)

## Implemented Safeguards

### 1. Deduplication (✅ Implemented)
```python
# Prevents same video+version+model from running twice
existing_run = repo.get_existing_run(video_id, version, model_version)
if existing_run and skip_if_exists:
    return {"status": "skipped", "reason": "run_already_exists"}
```

### 2. Timeout Configuration (✅ Implemented)
```python
@stub.function(
    timeout=3600,  # 1 hour max (safety: 10-15x expected time)
    container_idle_timeout=300,  # 5 min idle shutdown
)
```

**How this prevents hung processes:**
- `timeout`: Hard kill after 1 hour (even if stuck in infinite loop)
- `container_idle_timeout`: Kills idle container if no CPU activity for 5 min
- Combined: If process hangs, container dies within 5 minutes
- If process is in tight loop (using CPU), dies after 1 hour max

**Cost ceiling:** Worst case = 1 hour × $1.10/hr = $1.10 per hung job

### 3. Retry Limits (✅ Implemented)
```python
@task(
    retries=2,  # Maximum 2 retries
    retry_delay_seconds=300,  # 5 min backoff
)
```

## Recommended Additional Safeguards

### 4. Concurrency Limits (RECOMMENDED)

**Problem:** Without limits, could spawn 100s of parallel GPU containers.

**Solution:** Modal concurrency controls
```python
@stub.function(
    gpu="A10G",
    concurrency_limit=10,  # Max 10 parallel containers
    allow_concurrent_inputs=100,  # Queue up to 100 jobs
)
```

**Settings:**
- `concurrency_limit`: Max parallel containers (prevents GPU spike)
- `allow_concurrent_inputs`: Max queued jobs (prevents unbounded queue)

**Recommendation:**
- Start with `concurrency_limit=5` (5 × $1.10/hr = $5.50/hr max)
- Increase gradually as you monitor costs
- Set `allow_concurrent_inputs=50` (reasonable queue depth)

### 5. Rate Limiting (RECOMMENDED)

**Problem:** API abuse or bug could submit thousands of jobs.

**Solution:** Application-level rate limiting
```python
from prefect_redis import RedisBlock
import time

@task
def check_rate_limit(video_id: str) -> bool:
    """Ensure we don't process same video too frequently."""
    redis = RedisBlock.load("rate-limiter")
    key = f"boundary_inference:{video_id}"

    # Check if we processed this video in last 10 minutes
    if redis.exists(key):
        last_run = float(redis.get(key))
        if time.time() - last_run < 600:  # 10 minutes
            raise ValueError(f"Video {video_id} processed too recently")

    # Set cooldown
    redis.setex(key, 600, str(time.time()))
    return True
```

**Recommendation:**
- 10-minute cooldown per video (prevents duplicate storms)
- Global rate limit: 20 jobs/hour across all videos
- Track in Redis or Supabase

### 6. Cost Estimation (RECOMMENDED)

**Problem:** No visibility into cost before running.

**Solution:** Estimate and require approval for expensive jobs
```python
@task
def estimate_cost(frame_pairs: int) -> dict:
    """Estimate job cost before running."""
    # A10G: $1.10/hr, ~100 pairs/sec
    estimated_seconds = frame_pairs / 100
    estimated_hours = estimated_seconds / 3600
    estimated_cost = estimated_hours * 1.10

    return {
        "frame_pairs": frame_pairs,
        "estimated_seconds": estimated_seconds,
        "estimated_cost_usd": round(estimated_cost, 4),
    }

@flow
def boundary_inference_flow(...):
    # Estimate cost
    cost_estimate = estimate_cost(len(frame_pairs))
    print(f"💰 Estimated cost: ${cost_estimate['estimated_cost_usd']:.4f}")

    # Reject if too expensive (safety check)
    if cost_estimate["estimated_cost_usd"] > 1.0:  # $1 threshold
        raise ValueError(f"Job too expensive: ${cost_estimate['estimated_cost_usd']}")
```

### 7. Circuit Breaker (RECOMMENDED)

**Problem:** If Modal API is down or erroring, retries could accumulate.

**Solution:** Circuit breaker pattern
```python
from datetime import datetime, timedelta

# Supabase table: circuit_breaker_state
# Columns: service, state (open/closed), failure_count, last_failure_at

@task
def check_circuit_breaker() -> bool:
    """Check if Modal service is healthy."""
    supabase = get_supabase_client()

    response = supabase.table("circuit_breaker_state").select("*").eq("service", "modal").single().execute()

    if not response.data:
        return True  # No state = healthy

    state = response.data["state"]
    failure_count = response.data["failure_count"]
    last_failure = datetime.fromisoformat(response.data["last_failure_at"])

    # Circuit is open (blocking) if:
    # - 5+ failures in last hour
    if state == "open" and failure_count >= 5:
        if datetime.now() - last_failure < timedelta(hours=1):
            raise ValueError("Circuit breaker OPEN: Modal service unhealthy")
        else:
            # Reset after 1 hour
            supabase.table("circuit_breaker_state").update({"state": "closed", "failure_count": 0}).eq("service", "modal").execute()

    return True
```

### 8. Queue Depth Monitoring (RECOMMENDED)

**Problem:** Jobs piling up in queue indicates backlog/issue.

**Solution:** Monitor and alert on queue depth
```python
@task
def check_queue_depth() -> int:
    """Check Prefect queue depth for boundary inference."""
    # Get pending jobs from Supabase
    supabase = get_supabase_client()
    response = supabase.table("boundary_inference_jobs").select("count").eq("status", "queued").execute()

    queue_depth = response.data[0]["count"] if response.data else 0

    # Alert if queue is backing up
    if queue_depth > 20:
        print(f"⚠️  WARNING: Queue depth = {queue_depth} (threshold: 20)")
        # TODO: Send alert to monitoring

    # Block new submissions if queue is too deep
    if queue_depth > 50:
        raise ValueError(f"Queue depth too high ({queue_depth}). Blocking new submissions.")

    return queue_depth
```

### 9. Modal Spending Limits (PLATFORM LEVEL)

**Problem:** No hard cap on Modal spending.

**Solution:** Use Modal's built-in controls
```bash
# Set via Modal dashboard or CLI
modal config set-spending-limit 100  # $100/month hard cap

# Or set alert thresholds
modal config set-budget-alert 50  # Alert at $50/month
```

**Recommendation:**
- Start with $100/month hard limit
- Set alerts at $25, $50, $75
- Increase gradually as usage stabilizes

### 10. Job Validation (RECOMMENDED)

**Problem:** Malformed requests could waste resources.

**Solution:** Validate inputs before submission
```python
@task
def validate_inference_request(
    video_id: str,
    frame_pairs: list[tuple[int, int]],
    model_version: str,
) -> bool:
    """Validate request before expensive GPU submission."""

    # 1. Check video exists
    supabase = get_supabase_client()
    video = supabase.table("videos").select("id").eq("id", video_id).single().execute()
    if not video.data:
        raise ValueError(f"Video not found: {video_id}")

    # 2. Check reasonable frame pair count
    if len(frame_pairs) == 0:
        raise ValueError("No frame pairs to process")
    if len(frame_pairs) > 100_000:  # Sanity check: 100k pairs = ~2.7hr video at 10Hz
        raise ValueError(f"Unreasonable frame pair count: {len(frame_pairs)}")

    # 3. Check model checkpoint exists (if possible)
    # Modal volume check would be expensive, skip for now

    # 4. Check frame pairs are valid
    for f1, f2 in frame_pairs[:10]:  # Sample check
        if f1 < 0 or f2 < 0 or f1 >= f2:
            raise ValueError(f"Invalid frame pair: ({f1}, {f2})")

    return True
```

## Monitoring & Alerts

### Key Metrics to Track

1. **Cost Metrics**
   - Daily Modal spend
   - Cost per video
   - Cost per frame pair
   - Month-to-date spend

2. **Performance Metrics**
   - Jobs per hour/day
   - Average job duration
   - Queue depth
   - Failure rate

3. **Anomaly Indicators**
   - Sudden spike in job count
   - Jobs running longer than expected
   - High failure rate
   - Queue depth growing

### Recommended Alerts

```python
# Cost alerts
if daily_spend > 20:  # $20/day = $600/month
    send_alert("CRITICAL: Daily Modal spend exceeds $20")

# Performance alerts
if queue_depth > 20:
    send_alert("WARNING: Inference queue backing up")

if failure_rate > 0.2:  # 20% failures
    send_alert("WARNING: High inference failure rate")

# Anomaly alerts
if jobs_last_hour > 50:  # 50 jobs/hr unexpected
    send_alert("ANOMALY: Unusual spike in inference jobs")
```

### Dashboard Queries

```sql
-- Daily Modal cost (track in Supabase)
SELECT
    DATE(completed_at) as date,
    COUNT(*) as job_count,
    AVG(processing_time_seconds) as avg_duration,
    SUM(processing_time_seconds) / 3600 * 1.10 as estimated_cost_usd
FROM boundary_inference_runs
WHERE completed_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(completed_at)
ORDER BY date DESC;

-- Expensive videos (outliers)
SELECT
    video_id,
    processing_time_seconds,
    total_pairs,
    processing_time_seconds / 3600 * 1.10 as cost_usd
FROM boundary_inference_runs
WHERE processing_time_seconds / 3600 * 1.10 > 0.20  -- Over $0.20
ORDER BY cost_usd DESC;

-- Queue health
SELECT
    status,
    priority,
    COUNT(*) as count,
    AVG(EXTRACT(EPOCH FROM (NOW() - created_at))) as avg_wait_seconds
FROM boundary_inference_jobs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY status, priority;
```

## Implementation Priority

### Phase 1 (Immediate - Before Production)
1. ✅ Deduplication (already implemented)
2. ✅ Timeout configuration (already implemented)
3. ✅ Retry limits (already implemented)
4. **Concurrency limits** (add to Modal function)
5. **Modal spending limits** (set via dashboard)
6. **Job validation** (add to flow)

### Phase 2 (Week 1)
7. **Rate limiting** (per-video cooldown)
8. **Cost estimation** (add to flow start)
9. **Queue depth monitoring** (add alerts)

### Phase 3 (Month 1)
10. **Circuit breaker** (add health checks)
11. **Cost dashboard** (Supabase + Grafana)
12. **Anomaly detection** (alerts on spikes)

## Configuration Example

```python
# modal_config.py
MODAL_SAFEGUARDS = {
    # Hard limits
    "concurrency_limit": 5,  # Max 5 parallel GPUs ($5.50/hr max)
    "allow_concurrent_inputs": 50,  # Queue up to 50 jobs
    "timeout_seconds": 3600,  # 1 hour max per job

    # Soft limits (alerts)
    "max_daily_spend": 20.0,  # $20/day alert threshold
    "max_hourly_jobs": 20,  # 20 jobs/hr alert threshold
    "max_queue_depth": 20,  # Alert when queue > 20

    # Rate limiting
    "per_video_cooldown_seconds": 600,  # 10 min between runs
    "max_jobs_per_hour": 20,  # Global rate limit

    # Validation
    "max_frame_pairs": 100_000,  # Sanity check
    "max_cost_per_job": 1.0,  # $1 threshold (reject if over)
}
```

## Testing Safeguards

```python
# tests/test_cost_safeguards.py

def test_deduplication():
    """Ensure duplicate runs are rejected."""
    # Run inference
    result1 = boundary_inference_flow(video_id, version, model)
    assert result1["status"] == "success"

    # Try again - should skip
    result2 = boundary_inference_flow(video_id, version, model)
    assert result2["status"] == "skipped"
    assert result2["reason"] == "run_already_exists"

def test_rate_limiting():
    """Ensure videos can't be processed too frequently."""
    boundary_inference_flow(video_id, version, model)

    # Immediate retry should fail
    with pytest.raises(ValueError, match="processed too recently"):
        boundary_inference_flow(video_id, version, model, skip_if_exists=False)

def test_cost_validation():
    """Ensure expensive jobs are rejected."""
    # Try to process 200k pairs (would cost ~$2)
    with pytest.raises(ValueError, match="Job too expensive"):
        boundary_inference_flow(
            video_id,
            version,
            model,
            frame_pairs=[(i, i+1) for i in range(200_000)]
        )

def test_concurrency_limit():
    """Ensure Modal respects concurrency limits."""
    # Submit 10 jobs simultaneously
    jobs = [boundary_inference_flow.submit(...) for _ in range(10)]

    # Check that only 5 are running at once
    # (Modal API check - implementation depends on monitoring)
```

## Process Hang Protection

### Built-in Safeguards (✅ Implemented)

Modal provides multiple layers of protection against hung processes:

1. **Hard Timeout** (`timeout=3600`)
   - Unconditional kill after 1 hour
   - Works even if process is in infinite loop
   - Cannot be bypassed

2. **Idle Timeout** (`container_idle_timeout=300`)
   - Kills container if no CPU activity for 5 minutes
   - Catches deadlocks, network hangs, I/O waits
   - Most hung processes are idle (waiting on something)

3. **Automatic Cleanup**
   - Modal automatically cleans up GPU memory on exit
   - No orphaned processes or zombie containers
   - Resources immediately released for new jobs

### Failure Scenarios Covered

| Scenario | Protection | Max Cost |
|----------|-----------|----------|
| Process hangs (deadlock) | idle_timeout (5 min) | $0.09 |
| Infinite loop (CPU active) | timeout (1 hour) | $1.10 |
| OOM (out of memory) | Immediate crash | $0 extra |
| Network timeout | idle_timeout (5 min) | $0.09 |
| Stuck download | idle_timeout (5 min) | $0.09 |
| GPU hang | timeout (1 hour) | $1.10 |

**Worst case cost:** $1.10 (1 hour hard limit)

### Additional Monitoring (Optional)

For extra visibility into hung processes:

```python
import signal
import time
from threading import Thread

# Heartbeat thread to detect hangs
def heartbeat_monitor(job_id: str, timeout_seconds: int = 600):
    """Monitor job heartbeat and force exit if stalled."""
    last_heartbeat = time.time()

    def check_heartbeat():
        while True:
            time.sleep(60)  # Check every minute
            if time.time() - last_heartbeat > timeout_seconds:
                print(f"❌ HEARTBEAT TIMEOUT: No progress for {timeout_seconds}s")
                print(f"   Forcing exit to prevent runaway costs")
                os._exit(1)  # Hard exit

    # Start monitor thread
    monitor = Thread(target=check_heartbeat, daemon=True)
    monitor.start()

    return lambda: nonlocal last_heartbeat; last_heartbeat = time.time()

# Usage in Modal function
def run_boundary_inference_batch(...):
    # Start heartbeat
    update_heartbeat = heartbeat_monitor(run_id, timeout_seconds=600)

    # Update heartbeat at each step
    print("[1/8] Downloading layout.db...")
    download_layout_db(...)
    update_heartbeat()  # Signal progress

    print("[2/8] Loading model...")
    load_model(...)
    update_heartbeat()  # Signal progress

    # ... etc
```

**When to use:**
- Only if you observe actual hangs in production
- Adds complexity, usually not needed
- Modal's built-in timeouts are sufficient for most cases

## Rejection Monitoring & Alerting (✅ Implemented)

**Problem:** Team doesn't know when jobs are rejected until users report issues.

**Solution:** Automatic rejection logging and monitoring dashboard.

### How It Works

When jobs are rejected (frame count exceeded, cost exceeded, etc.):
1. **Log to Supabase** - Creates record in `boundary_inference_rejections` table
2. **Print alert** - Logs 🚨 REJECTION LOGGED to Prefect output
3. **Track metadata** - Stores video ID, rejection type, cost estimate, etc.
4. **Enable monitoring** - Dashboard queries and CLI tools for visibility

### Rejection Types Tracked

```python
# Rejection types with automatic logging:
- frame_count_exceeded   # Video too long for configured limit
- cost_exceeded          # Estimated job cost too high
- validation_failed      # Input validation error
- rate_limited           # Too many recent requests
- queue_full             # Inference queue at capacity
```

### Checking for Rejections

**CLI Monitor (recommended for daily checks):**
```bash
python services/orchestrator/monitoring/check_rejections.py
```

Output:
```
═══════════════════════════════════════════════════════
   Boundary Inference Rejections Monitor
═══════════════════════════════════════════════════════

Total rejections: 5

By type:
  • frame_count_exceeded: 3
  • cost_exceeded: 2

⚠️  5 unacknowledged rejection(s)

┌────────────┬──────────────────────┬──────────────┬────────┐
│ Age        │ Type                 │ Video ID     │ Frames │
├────────────┼──────────────────────┼──────────────┼────────┤
│ 2h ago     │ frame_count_exceeded │ 61c3123f     │ 250,000│
└────────────┴──────────────────────┴──────────────┴────────┘

Recommendations:
  1. Review rejections to determine if limits need adjustment
  2. Check if videos are valid or data errors
  3. Update config.py if supporting longer videos
```

**Dashboard Query (Supabase):**
```sql
-- Unacknowledged rejections
SELECT
  created_at,
  rejection_type,
  video_id,
  frame_count,
  estimated_cost_usd,
  LEFT(rejection_message, 100) as message
FROM captionacc_production.boundary_inference_rejections
WHERE NOT acknowledged
ORDER BY created_at DESC;
```

**Programmatic Access:**
```python
from services.orchestrator.monitoring import get_unacknowledged_rejections

rejections = get_unacknowledged_rejections(limit=50)
if rejections:
    print(f"⚠️  {len(rejections)} unacknowledged rejections")
```

### Acknowledging Rejections

After reviewing and taking action:
```python
from services.orchestrator.monitoring import acknowledge_rejection

acknowledge_rejection(
    rejection_id="550e8400-e29b-41d4-a716-446655440000",
    acknowledged_by="admin-uuid"  # optional
)
```

### Alerting Setup

**Option 1: Cron job (simple)**
```bash
# Check daily at 9am
0 9 * * * cd /path/to/project && python services/orchestrator/monitoring/check_rejections.py
```

**Option 2: Prefect scheduled flow**
```python
@flow(schedule=IntervalSchedule(interval=timedelta(hours=12)))
def monitor_rejections():
    rejections = get_unacknowledged_rejections(limit=10)
    if rejections:
        send_alert(f"{len(rejections)} unacknowledged rejections")
```

**Option 3: Real-time webhook (Supabase trigger)**
```sql
-- Trigger notification on new rejection
CREATE TRIGGER rejection_alert
  AFTER INSERT ON boundary_inference_rejections
  FOR EACH ROW
  EXECUTE FUNCTION notify_team();
```

### Response Workflow

1. **Detect** - Alert fires or daily check shows rejections
2. **Investigate** - Review rejection details via CLI or dashboard
3. **Categorize**:
   - Valid video, limit too low → Increase `config.py` limit
   - Bad data/corruption → Fix video metadata
   - Edge case → Document and acknowledge
4. **Act** - Update config, fix data, or deploy fix
5. **Acknowledge** - Mark as reviewed to clear from queue

See [services/orchestrator/monitoring/README.md](../../../services/orchestrator/monitoring/README.md) for complete monitoring documentation.

## Summary

**Critical safeguards (implement before production):**
1. Concurrency limits (5 parallel max = $5.50/hr ceiling)
2. Modal spending limits ($100/month hard cap)
3. Job validation (reject malformed requests)
4. Cost estimation (log expected cost)

**Important safeguards (implement week 1):**
5. Rate limiting (10 min cooldown per video)
6. Queue depth monitoring (alert at 20, block at 50)
7. Cost dashboard (track daily spend)

**Long-term safeguards (implement month 1):**
8. Circuit breaker (auto-disable on failures)
9. Anomaly detection (alert on spikes)
10. Advanced monitoring (per-video cost tracking)

With these safeguards, worst-case monthly cost is capped at $100 (hard limit), and alerts trigger well before reaching that.
