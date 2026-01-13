# Prefect Webhook Architecture

## Overview

Instead of client-side polling, we use **optimistic updates** + **Prefect webhooks** for asynchronous job status updates.

## Current Implementation

### 1. Optimistic Updates (Immediate UI Response)

When a caption frame extents annotation is saved:

```typescript
// annotation-crud-service.ts: markImageForRegeneration()
db.prepare(
  `
  UPDATE captions
  SET caption_ocr_status = 'queued',    // Immediate optimistic update
      image_needs_regen = 1,
      caption_ocr = NULL,
      text_pending = 1
  WHERE id = ?
`
).run(annotationId)

// Queue Prefect flow (async, doesn't block response)
await queueCaptionOcrProcessing({
  videoId,
  dbPath,
  videoDir,
  captionIds: [annotationId],
})
```

**Result**: User sees "queued" status in ~50ms instead of waiting 5-15 seconds for processing.

### 2. Background Processing (Prefect Flow)

The Prefect flow runs asynchronously:

```python
# services/orchestrator/flows/caption_caption_ocr.py
@flow(name="process-caption_ocr")
def caption_caption_ocr_flow(...):
    # 1. Generate median frame
    # 2. Run OCR
    # 3. Update database with results
    # 4. Send webhook notification
```

### 3. Webhook Notification (Flow Completion)

When the flow completes, it sends a webhook to the web app:

```python
webhook_payload = {
    "videoId": video_id,
    "flowName": "caption_ocr",
    "status": "complete" | "error",
    "error": "..." if errors
}

requests.post(f"{WEB_APP_URL}/api/webhooks/prefect", json=webhook_payload)
```

**Endpoint**: `POST /api/webhooks/prefect`

**Handler**: `apps/captionacc-web/app/routes/api.webhooks.prefect.tsx`

Currently, the webhook just logs the completion event.

### 4. Real-Time Updates (Server-Sent Events)

When a flow completes, the webhook broadcasts to all connected clients via SSE:

**Server side** (`api.webhooks.prefect.tsx`):

```typescript
sseBroadcaster.broadcast('video-stats-updated', {
  videoId: payload.videoId,
  flowName: payload.flowName,
  status: payload.status,
  timestamp: new Date().toISOString(),
})
```

**Client side** (`useVideoStats` hook):

```typescript
useVideoStatsSSE({
  onUpdate: videoId => {
    fetchStats(videoId, true) // Force refresh
  },
  enabled: isMounted,
})
```

**Result**: UI updates **instantly** (< 1 second) when flows complete.

**Fallback**: If SSE connection fails, stats still refetch on page navigation.

## Comparison: Polling vs Webhook

### Before (Polling)

```typescript
// Every 5 seconds, for all processing videos
setInterval(() => {
  processingVideos.forEach(videoId => {
    fetch(`/api/videos/${videoId}/stats`) // N requests/5sec
  })
}, 5000)
```

**Problems**:

- Constant server load
- Up to 5-second delay
- Scales poorly (N users × M videos × 12 req/min)

### After (Webhook + Optimistic Updates)

```typescript
// Immediate optimistic update
updateDatabase({ status: 'queued' })

// Background processing (no polling)
await queuePrefectFlow(...)

// Webhook notifies when complete
// User sees fresh data on next page load or after 5-min TTL
```

**Benefits**:

- Instant initial feedback (optimistic update)
- Instant completion feedback (SSE push, < 1 second)
- Zero polling overhead
- Scales linearly with actual processing events
- Automatic reconnection with exponential backoff

## Environment Configuration

Set the web app URL for Prefect to send webhooks:

```bash
export WEB_APP_URL="http://localhost:5173"  # Development
# or
export WEB_APP_URL="https://app.example.com"  # Production
```

Default is `http://localhost:5173`.

## Architecture: Real-Time Updates via SSE

### Components

**1. SSE Endpoint** (`/api/events/video-stats`):

- Keeps persistent connection to browser
- Sends events when stats update
- Auto-reconnects with exponential backoff

**2. SSE Broadcaster** (`services/sse-broadcaster.ts`):

- Manages all active SSE connections
- Broadcasts events to all connected clients
- Tracks client count

**3. Client Hook** (`hooks/useVideoStatsSSE.ts`):

- Subscribes to SSE endpoint on mount
- Listens for `video-stats-updated` events
- Triggers refetch when notified
- Auto-reconnects on disconnect

**4. Integration** (`hooks/useVideoStats.ts`):

- Automatically subscribes to SSE
- Refetches stats when updates received
- No manual setup required

### Event Flow

```
User saves annotation
  ↓
Optimistic update (immediate)
  ↓
Queue Prefect flow (async)
  ↓
Flow runs (5-15s)
  ↓
Flow completes → sends webhook
  ↓
Webhook broadcasts SSE event
  ↓
All connected browsers receive event
  ↓
Browsers refetch affected video stats
  ↓
UI updates (< 1 second after flow completion)
```

## Testing

Start both servers:

```bash
# Terminal 1: Web app
cd apps/captionacc-web
npm run dev

# Terminal 2: Prefect
cd services/orchestrator
python serve_flows.py
```

Then test the real-time updates:

1. **Open videos page** - Check browser console for `[SSE] Connected`
2. **Save a caption frame extents annotation** - Status should show "queued" immediately
3. **Watch Prefect logs** - Flow should start within seconds
4. **Wait for completion** (5-15s depending on caption length)
5. **Watch browser console** - Should see:
   - `[SSE] Video stats updated: {...}`
   - `[useVideoStats] SSE update for <videoId>, refetching...`
6. **Watch UI** - Video stats should update **automatically** (< 1 second)

**No page reload needed!** The UI updates in real-time.

## Monitoring

**Prefect logs**: `services/orchestrator/` (flow execution)

**Webhook logs**: Check dev server output for:

- `[PrefectWebhook]` - Webhook received
- `[SSE] Broadcasting to N clients` - Event broadcast

**SSE logs**: Browser console shows:

- `[SSE] Connected` - Connection established
- `[SSE] Video stats updated` - Event received
- `[useVideoStats] SSE update` - Refetch triggered

**Queue logs**: `local/prefect-queue.log` (flow queuing)

**Connection count**: Webhook response includes `clients: N` field showing active SSE connections
