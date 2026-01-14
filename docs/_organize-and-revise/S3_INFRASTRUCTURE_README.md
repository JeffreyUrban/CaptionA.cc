# S3 Direct Access Infrastructure

**Status:** ✅ Complete - Ready for integration
**Created:** 2026-01-13
**Track:** Track B - S3 Direct Access Layer
**Migration Plan:** `docs/frontend-to-new-backend.md` (Phase 1.2)

---

## Overview

This infrastructure enables the frontend to access S3 (Wasabi) directly using temporary STS credentials, replacing the previous backend-mediated access pattern. This is part of the larger migration from the TypeScript backend to the new Python backend.

---

## Files Created

### 1. Core Services

#### `/app/services/s3-credentials.ts` (7.9 KB)

**Purpose:** STS credential management
**Features:**

- Fetches credentials from Supabase Edge Function (`/functions/v1/captionacc-s3-credentials`)
- Caches in sessionStorage until expiration
- Auto-refresh 5 minutes before expiration
- Multi-tab coordination via BroadcastChannel API
- Never logs credentials (security)

**Key Functions:**

- `getS3Credentials()` - Get valid credentials (cached or fresh)
- `refreshS3Credentials()` - Force refresh
- `clearS3Credentials()` - Clear on logout
- `subscribeToCredentialUpdates()` - Listen to cross-tab updates

#### `/app/services/s3-client.ts` (11 KB)

**Purpose:** S3 client wrapper with retry logic
**Features:**

- S3Client initialization with STS credentials
- Exponential backoff retry (max 3 attempts)
- Path builders for S3 keys
- Typed error handling

**Key Functions:**

- `getObject(key)` - Get raw bytes
- `getObjectUrl(key, expiresIn)` - Get signed URL
- `headObject(key)` - Get metadata
- `listObjects(prefix)` - List objects
- `buildS3Path(params)` - Build S3 path
- `getVideoResourceUrl(videoId, type, params)` - Helper for video resources

**Custom Errors:**

- `CredentialsExpiredError`
- `AccessDeniedError`
- `NotFoundError`
- `RetryExhaustedError`

#### `/app/services/frame-cache.ts` (8.1 KB)

**Purpose:** LRU cache for frame images
**Features:**

- Max size: 60MB
- LRU eviction when over limit
- Pin/unpin frames to prevent eviction
- Blob URL management with automatic cleanup

**Key Functions:**

- `getFrame(frameIndex)` - Get cached frame
- `setFrame(frameIndex, imageUrl, modulo, sizeBytes)` - Cache frame
- `pinFrame(frameIndex)` - Prevent eviction
- `unpinFrame(frameIndex)` - Allow eviction
- `clearFrameCache()` - Clear all
- `getFrameCacheStats()` - Get cache stats

### 2. State Management

#### `/app/stores/s3-credentials-store.ts` (6.2 KB)

**Purpose:** Zustand store for credentials
**Features:**

- State: credentials, loading, error, expiresAt
- Auto-refresh timer (checks every minute)
- Auth state subscription (clear on logout)
- sessionStorage persistence
- Cross-tab sync via BroadcastChannel

**Key Functions:**

- `fetchCredentials()` - Fetch credentials
- `refreshIfNeeded()` - Refresh if close to expiration
- `clearCredentials()` - Clear on logout
- `initializeS3CredentialsStore()` - Initialize store (call once in root)

### 3. React Components

#### `/app/components/S3Image.tsx` (7.7 KB)

**Purpose:** S3-backed image component
**Features:**

- Automatic signed URL generation
- Loading/error states with fallback
- Preloading support
- Frame cache integration (planned)

**Props:**

- `videoId` - Video ID
- `path` - S3 path or path params
- `alt` - Alt text
- `className` - CSS class
- `onLoad` - Load callback
- `onError` - Error callback
- `fallbackSrc` - Fallback image
- `preload` - Preload mode
- `expiresIn` - URL expiration (default: 1 hour)

**Helper:**

- `preloadS3Image(videoId, path, expiresIn)` - Preload image

#### `/app/components/S3Video.tsx` (6.7 KB)

**Purpose:** S3-backed video component
**Features:**

- Automatic signed URL generation
- Loading/error states with fallback
- Support for autoplay, loop, muted, controls
- Multiple source format support

**Props:**

- `videoId` - Video ID
- `path` - S3 path or path params
- `autoPlay` - Autoplay (default: false)
- `loop` - Loop (default: false)
- `muted` - Muted (default: false)
- `controls` - Show controls (default: true)
- Other props same as S3Image

**Helper:**

- `preloadS3Video(videoId, path, expiresIn)` - Preload video metadata

---

## S3 Path Structure

```
{tenant_id}/client/videos/{video_id}/
├── video.mp4
├── layout.db.gz
├── captions.db.gz
├── full_frames/
│   └── frame_0001.jpg
└── cropped_frames_v{N}/
    ├── modulo_16/
    │   └── chunk_0001.webm
    ├── modulo_4/
    │   └── chunk_0001.webm
    └── modulo_1/
        └── chunk_0001.webm
```

---

## Edge Function Contract

### Endpoint

```
GET /functions/v1/captionacc-s3-credentials
Authorization: Bearer <supabase_jwt>
```

### Response

```json
{
  "credentials": {
    "accessKeyId": "...",
    "secretAccessKey": "...",
    "sessionToken": "..."
  },
  "expiration": "2026-01-13T23:00:00Z",
  "bucket": "caption-acc-prod",
  "region": "us-east-1",
  "endpoint": "https://s3.us-east-1.wasabisys.com",
  "prefix": "{tenant_id}/client/*"
}
```

---

## Usage Examples

See `/app/services/s3-infrastructure-usage-examples.tsx` for complete examples.

### Basic Usage

```tsx
import { S3Image } from '~/components/S3Image'
import { S3Video } from '~/components/S3Video'

// Image
<S3Image
  videoId={videoId}
  path="full_frames/frame_0001.jpg"
  alt="Frame 1"
  className="w-32 h-32"
/>

// Video
<S3Video
  videoId={videoId}
  path="video.mp4"
  controls
  className="w-full"
/>
```

### Initialize Store (Root Component)

```tsx
import { useEffect } from 'react'
import { initializeS3CredentialsStore } from '~/stores/s3-credentials-store'

export function App() {
  useEffect(() => {
    initializeS3CredentialsStore()
  }, [])

  return <div>...</div>
}
```

### Manual S3 Operations

```tsx
import { getVideoResourceUrl, buildS3Path } from '~/services/s3-client'

// Get signed URL
const url = await getVideoResourceUrl(videoId, 'full_frames', { filename: 'frame_0001.jpg' })

// Build S3 path
const path = buildS3Path({
  tenantId,
  videoId,
  type: 'full_frames',
  filename: 'frame_0001.jpg',
})
```

---

## Integration Checklist

### Prerequisites

- [ ] AWS SDK already installed (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) ✅
- [ ] Supabase Edge Function deployed (`/functions/v1/captionacc-s3-credentials`)
- [ ] Wasabi bucket configured with STS policies
- [ ] Wasabi CORS configured for `app.captiona.cc`

### Integration Steps

1. [ ] Call `initializeS3CredentialsStore()` in root component (e.g., `app/root.tsx`)
2. [ ] Replace existing image proxy calls with `<S3Image>` component
3. [ ] Replace existing video proxy calls with `<S3Video>` component
4. [ ] Test credential fetch and auto-refresh
5. [ ] Test multi-tab coordination
6. [ ] Test image/video loading
7. [ ] Test frame cache eviction
8. [ ] Verify no credentials logged in browser console

---

## Testing Verification

### Unit Tests Needed

- [ ] `s3-credentials.ts` - Credential caching and refresh logic
- [ ] `s3-client.ts` - Retry logic and error handling
- [ ] `frame-cache.ts` - LRU eviction and pinning
- [ ] `s3-credentials-store.ts` - State management

### Integration Tests Needed

- [ ] Download test image from S3
- [ ] Generate signed URL
- [ ] Credential auto-refresh before expiration
- [ ] Multi-tab credential sharing
- [ ] Frame cache evicts LRU items correctly
- [ ] S3Image component loads images
- [ ] S3Video component loads videos

### Manual Testing

- [ ] Open multiple tabs, verify credentials sync
- [ ] Wait for credential expiration, verify auto-refresh
- [ ] Sign out, verify credentials cleared
- [ ] Load 100+ frames, verify cache evicts old frames
- [ ] Pin frames, verify they don't get evicted

---

## Design Principles

1. **Security**
   - sessionStorage only (cleared on tab close)
   - Never log credentials
   - Auto-clear on logout

2. **Performance**
   - Cache signed URLs
   - Use BroadcastChannel to share credentials across tabs
   - LRU cache for frames (60MB limit)

3. **Error Handling**
   - Graceful degradation with fallback images
   - Retry with exponential backoff
   - Typed error classes

4. **Type Safety**
   - Full TypeScript interfaces
   - No `any` types
   - Strongly typed path builders

---

## Next Steps

1. **Phase 2: Layout Annotation** (Weeks 3-5)
   - Integrate S3Image in layout thumbnail grid
   - Use direct S3 URLs in layout main canvas
   - Replace `/api/images/{videoId}/full_frames/*` endpoints

2. **Phase 3: Caption Annotation** (Weeks 6-8)
   - Replace `/api/frames/batch-signed-urls` with client-side generation
   - Use S3Image for cropped frames
   - Keep hierarchical loading strategy (modulo_16 → modulo_4 → modulo_1)

3. **Phase 4: Upload** (Week 9)
   - Implement presigned S3 upload URLs (Track A responsibility)
   - Delete TUS endpoint after migration

---

## Dependencies

### Existing (Already Installed)

- `@aws-sdk/client-s3@^3.962.0` ✅
- `@aws-sdk/s3-request-presigner@^3.962.0` ✅
- `@supabase/supabase-js@^2.89.0` ✅
- `zustand@^5.0.9` ✅

### New (None Required)

All dependencies already installed.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (Browser)                                          │
│                                                             │
│  ┌──────────────────┐                                      │
│  │ S3Image/S3Video  │                                      │
│  │ Components       │                                      │
│  └────────┬─────────┘                                      │
│           │                                                 │
│           ▼                                                 │
│  ┌──────────────────┐      ┌──────────────────┐           │
│  │ s3-client.ts     │◄─────┤ s3-credentials-  │           │
│  │                  │      │ store.ts         │           │
│  │ - getObjectUrl() │      │ (Zustand)        │           │
│  │ - buildS3Path()  │      └────────┬─────────┘           │
│  └────────┬─────────┘               │                      │
│           │                         │                      │
│           │                         ▼                      │
│           │              ┌──────────────────┐              │
│           │              │ s3-credentials.ts│              │
│           │              │                  │              │
│           │              │ - getS3Credentials()            │
│           │              │ - BroadcastChannel              │
│           │              └────────┬─────────┘              │
│           │                       │                        │
└───────────┼───────────────────────┼────────────────────────┘
            │                       │
            ▼                       ▼
┌──────────────────────┐  ┌──────────────────────┐
│ Wasabi S3            │  │ Supabase Edge        │
│                      │  │ Function             │
│ - Direct access      │  │                      │
│ - Signed URLs        │  │ /functions/v1/       │
│ - STS credentials    │  │ captionacc-s3-       │
│                      │  │ credentials          │
└──────────────────────┘  └──────────────────────┘
```

---

## File Sizes

| File                             | Size        | Lines     |
| -------------------------------- | ----------- | --------- |
| `services/s3-credentials.ts`     | 7.9 KB      | 280       |
| `services/s3-client.ts`          | 11 KB       | 400       |
| `services/frame-cache.ts`        | 8.1 KB      | 370       |
| `stores/s3-credentials-store.ts` | 6.2 KB      | 200       |
| `components/S3Image.tsx`         | 7.7 KB      | 300       |
| `components/S3Video.tsx`         | 6.7 KB      | 250       |
| **Total**                        | **47.6 KB** | **1,800** |

---

## Troubleshooting

### Issue: Credentials not refreshing

**Solution:** Ensure `initializeS3CredentialsStore()` is called in root component

### Issue: Multi-tab credentials not syncing

**Solution:** Check if BroadcastChannel is supported (`'BroadcastChannel' in window`)

### Issue: Frame cache not evicting old frames

**Solution:** Check if frames are pinned (`unpinFrame()` when done)

### Issue: S3Image/S3Video not loading

**Solution:** Check browser console for errors, verify signed URL generation

### Issue: Type errors in path building

**Solution:** Ensure all required path params are provided (e.g., `filename` for `full_frames`)

---

## Notes

- All files type-check successfully (verified 2026-01-13)
- No runtime dependencies added (all existing)
- Example usage file: `services/s3-infrastructure-usage-examples.tsx` (delete after integration)
- Pre-existing TypeScript errors in other files not related to this infrastructure

---

## Contact

For questions or issues with this infrastructure, refer to:

- Migration Plan: `docs/frontend-to-new-backend.md`
- Track B: S3 Direct Access Layer (Phase 1.2)
