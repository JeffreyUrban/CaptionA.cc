# State Management Architecture

**Implementation Date:** 2025-12-31
**Status:** Phase 1 & 2 Complete

## Overview

Global state management using Zustand to support long-running background operations (uploads, video processing pipelines) that persist across page navigation.

## Problem

- Users upload 30+ videos (200MB-1GB each) = 30-90+ minute batches
- Need to navigate between pages while uploads continue
- Original: upload state in component → navigate away → lost state ❌

## Solution: Zustand + Upload Manager Service

### Architecture

```
Zustand Store (localStorage)     Upload Manager (singleton)
- Upload metadata                 - TUS upload instances
- Video pipeline state            - Concurrent upload queue
- User preferences                - Retry + stall detection
      ↓                                  ↓
   Persists                        Survives navigation
      ↓                                  ↓
React Components ← Subscribe to store + call manager
```

### Files

```
app/
├── types/store.ts              # Global state interfaces
├── stores/app-store.ts         # Zustand store + persistence
├── services/upload-manager.ts  # TUS upload orchestration
├── hooks/useUploadManager.ts   # React integration
└── components/
    ├── AppLayout.tsx           # Added: UploadProgress
    └── UploadProgress.tsx      # Navbar upload indicator
```

## Key Features

1. **Uploads continue during navigation** - Manager survives component unmounts
2. **Resume after refresh** - Metadata in localStorage, TUS resumes from checkpoint
3. **Navbar progress** - Visible from any page
4. **Redux DevTools** - State inspection and time-travel debugging
5. **Pipeline foundation** - Ready for video processing state tracking

## Usage

### Start Upload

```typescript
const { startUpload } = useUploadManager()

await startUpload(file, {
  fileName: file.name,
  fileType: file.type,
  targetFolder: '/videos/2024',
  relativePath: file.webkitRelativePath,
})
```

### Monitor Progress

```typescript
const activeUploads = useAppStore(selectActiveUploads)

activeUploads.map(u => `${u.fileName}: ${u.progress}%`)
```

### Resume Detection

```typescript
const { incompleteUploads } = useIncompleteUploadDetection()
// Automatically detects on mount, prompts user to resume
```

## Trade-offs

✅ **Uploads continue** when navigating `/upload` → `/videos`
⚠️ **Uploads pause** if browser tab closes (JavaScript stops)
✅ **Auto-resume** when browser reopens (TUS protocol + localStorage)

**Acceptable** for 30-90 min batches where users keep browser open.

**Alternative considered:** Service Worker (true background uploads even when tab closed)
**Why not chosen:** Over-engineering for this use case, high complexity, limited benefit

## Development Status

### Phase 1 & 2 Complete ✅

- Zustand store with localStorage persistence
- Upload Manager singleton service
- React integration hooks (useUploadManager, useIncompleteUploadDetection)
- Navbar progress indicator
- Redux DevTools integration
- TypeScript types

### Phase 3 Complete ✅

- Upload page integration with new hooks (useUploadQueueV2)
- Incomplete upload detection UI (useIncompleteUploadsV2)
- Compatibility layer for gradual migration

### Ready for Testing 🧪

- Upload flow with navigation
- Resume after browser refresh
- Navbar progress updates across pages
- Incomplete upload detection on mount

### Future ⏸️

- Pipeline state tracking (video processing stages)
- User notifications
- Performance optimization

## References

- **Implementation:** `app/stores/app-store.ts`, `app/services/upload-manager.ts`
- **Zustand:** https://github.com/pmndrs/zustand
- **TUS Protocol:** https://tus.io/protocols/resumable-upload.html
