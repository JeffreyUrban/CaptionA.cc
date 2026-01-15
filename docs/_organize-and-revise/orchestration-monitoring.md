# Inference Monitoring & Alerting

Tools for monitoring caption frame extents inference jobs and detecting operational issues.

## Quick Start

### Check for Rejected Jobs

```bash
python services/orchestrator/monitoring/check_rejections.py
```

This displays:
- Total rejections in last 7 days
- Breakdown by rejection type
- Unacknowledged rejections requiring review
- Recommendations for action

**Run this regularly** (daily or via cron) to catch issues proactively.

## Rejection Types

| Type | Cause | Action |
|------|-------|--------|
| `frame_count_exceeded` | Video too long for configured limit | Review if legitimate; increase `max_frame_count` in `config.py` if needed |
| `cost_exceeded` | Estimated job cost too high | Check video validity; increase `max_cost_per_job_usd` if legitimate |
| `validation_failed` | Input validation error | Investigate video metadata or frame data |
| `rate_limited` | Too many requests for same video | Check for retry loops or duplicate submissions |
| `queue_full` | Inference queue at capacity | Scale up concurrency or investigate backlog |

## Monitoring Queries

### Unacknowledged Rejections (Dashboard)

```sql
-- Rejections requiring review
SELECT
  created_at,
  rejection_type,
  video_id,
  frame_count,
  estimated_cost_usd,
  LEFT(rejection_message, 100) as message_preview
FROM captionacc_production.caption_frame_extents_inference_rejections
WHERE NOT acknowledged
ORDER BY created_at DESC
LIMIT 20;
```

### Rejection Trends (Weekly Report)

```sql
-- Rejections by type over last 7 days
SELECT
  rejection_type,
  COUNT(*) as count,
  AVG(frame_count) as avg_frame_count,
  MAX(frame_count) as max_frame_count,
  AVG(estimated_cost_usd) as avg_cost
FROM captionacc_production.caption_frame_extents_inference_rejections
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY rejection_type
ORDER BY count DESC;
```

### Daily Rejection Rate

```sql
-- Rejection rate by day
SELECT
  DATE(created_at) as date,
  COUNT(*) as rejections,
  COUNT(DISTINCT video_id) as unique_videos,
  ARRAY_AGG(DISTINCT rejection_type) as types
FROM captionacc_production.caption_frame_extents_inference_rejections
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

### Videos Hitting Limits

```sql
-- Videos that exceed frame count limit
SELECT
  video_id,
  frame_count,
  estimated_cost_usd,
  COUNT(*) as rejection_count,
  MAX(created_at) as last_rejection
FROM captionacc_production.caption_frame_extents_inference_rejections
WHERE rejection_type = 'frame_count_exceeded'
GROUP BY video_id, frame_count, estimated_cost_usd
ORDER BY frame_count DESC;
```

## Programmatic Access

### Get Unacknowledged Rejections

```python
from services.orchestrator.monitoring.rejection_logger import get_unacknowledged_rejections

rejections = get_unacknowledged_rejections(limit=100)

for rejection in rejections:
    print(f"Video {rejection['video_id']}: {rejection['rejection_type']}")
    print(f"  {rejection['rejection_message']}")
```

### Acknowledge Rejection

```python
from services.orchestrator.monitoring.rejection_logger import acknowledge_rejection

# Mark as reviewed
acknowledge_rejection(
    rejection_id="550e8400-e29b-41d4-a716-446655440000",
    acknowledged_by="user-uuid-here"  # Optional
)
```

### Get Summary Statistics

```python
from services.orchestrator.monitoring.rejection_logger import get_rejection_summary

summary = get_rejection_summary(days=7)
print(f"Total rejections: {summary['total_rejections']}")
print(f"By type: {summary['by_type']}")
```

## Alerting Setup

### Option 1: Cron Job (Simple)

Add to crontab to check daily:

```bash
# Check rejections daily at 9am
0 9 * * * cd /path/to/project && python services/orchestrator/monitoring/check_rejections.py
```

### Option 2: Prefect Scheduled Flow

Create a monitoring flow that runs periodically:

```python
from prefect import flow
from prefect.schedules import IntervalSchedule
from datetime import timedelta

@flow(schedule=IntervalSchedule(interval=timedelta(hours=12)))
def monitor_rejections():
    rejections = get_unacknowledged_rejections(limit=10)

    if rejections:
        # Send alert (email, Slack, PagerDuty, etc.)
        send_alert(f"{len(rejections)} unacknowledged rejections")
```

### Option 3: Supabase Edge Function (Real-time)

Create webhook that triggers on new rejection:

```sql
-- Create notification function
CREATE OR REPLACE FUNCTION notify_rejection()
RETURNS TRIGGER AS $$
BEGIN
  -- Call webhook or send notification
  PERFORM http_post(
    'https://your-alerting-service.com/webhook',
    json_build_object(
      'rejection_type', NEW.rejection_type,
      'video_id', NEW.video_id,
      'message', NEW.rejection_message
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on insert
CREATE TRIGGER rejection_alert
  AFTER INSERT ON captionacc_production.caption_frame_extents_inference_rejections
  FOR EACH ROW
  EXECUTE FUNCTION notify_rejection();
```

## Response Workflow

When rejection alert fires:

1. **Investigate** - Review rejection details and video metadata
   ```python
   python services/orchestrator/monitoring/check_rejections.py
   ```

2. **Categorize**:
   - **Valid video, limit too low** → Increase limit in `config.py`
   - **Bad data/corruption** → Fix video metadata or exclude
   - **Edge case** → Document and acknowledge
   - **System issue** → Fix bug in validation logic

3. **Take action**:
   - Update configuration if limits need adjustment
   - Fix data quality issues
   - Deploy fix if validation bug

4. **Acknowledge**:
   ```python
   from services.orchestrator.monitoring.rejection_logger import acknowledge_rejection
   acknowledge_rejection(rejection_id="...", acknowledged_by="admin-uuid")
   ```

## Escalation

Automatic alerts should fire for:

- **High rejection rate** (>10 rejections/hour) → Possible systemic issue
- **Same video rejected repeatedly** → Retry loop or bug
- **Unacknowledged for 24h** → Team hasn't reviewed

Configure alerting thresholds based on your operational needs.
