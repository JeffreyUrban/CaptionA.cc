# State Management Architecture

**Status:** Implementation in progress (2025-12-31)
**Implementation:** `apps/captionacc-web/`

## Decision: Global State with Zustand

We've chosen **Option 2: Global State Management** using Zustand for managing application-wide state including uploads, video processing pipelines, and user preferences.

### Problem Statement

**Multi-page workflow with long-running background operations:**
- Users upload 30+ videos simultaneously (200MB-1GB each, 6-30GB total)
- Total batch upload time: 30-90+ minutes over remote connections
- Users need to navigate between pages while uploads continue
- Multiple pipelines (crop, OCR, caption extraction) need coordinated state tracking
- Professional/enterprise tool requiring reliable state management

**Original architecture limitation:**
- Upload state lived in `upload.tsx` component
- Navigating to `/videos` unmounted upload component → lost all upload state
- No visibility into background processing from other pages

### Requirements

1. **Upload persistence across navigation** - Uploads continue when user navigates between pages
2. **Resume capability** - Detect and resume interrupted uploads on page reload
3. **Cross-page visibility** - Show upload/pipeline progress in navbar from any page
4. **Pipeline orchestration** - Track video processing state across multiple stages
5. **State persistence** - Survive page refreshes (metadata only, not connection objects)
6. **Debuggability** - Inspect state changes for complex workflows
7. **Maintainability** - Clear architecture for solo developer

### Options Evaluated

#### Option 1: Nested Layout with Persistent Upload State
- Parent route with upload context, children render in `<Outlet />`
- **Pros:** React-only, no dependencies, automatic cleanup
- **Cons:** State lost on refresh, requires route restructuring
- **Verdict:** Insufficient - doesn't persist across refreshes

#### Option 2: Global State Management (Zustand) ✅ **CHOSEN**
- Global store with localStorage persistence
- Separate UploadManager service handling TUS instances
- **Pros:** Persists metadata across refreshes, supports debugging, solves broader state needs
- **Cons:** TUS instances must be recreated (not serializable)
- **Verdict:** Best fit for professional tool with complex workflows

#### Option 3: Service Worker + IndexedDB
- True background uploads in separate thread
- **Pros:** Uploads continue when tab is closed
- **Cons:** High complexity, TUS client compatibility issues, 3-5 day implementation
- **Verdict:** Over-engineering for < 2-hour uploads with resume capability

### Chosen Architecture: Option 2

**Why this fits our app:**
1. ✅ Already need global state for pipeline orchestration
2. ✅ Solves navigation problem without Service Worker complexity
3. ✅ Professional architecture suitable for enterprise tool
4. ✅ Manageable development cost (1-2 days)
5. ✅ Redux DevTools for debugging complex pipeline workflows
6. ✅ Foundation for future features (preferences, annotation state)

**Accepted tradeoff:**
- Uploads **pause** if user closes browser tab entirely (JavaScript stops)
- Uploads **resume** automatically when user reopens app (TUS protocol + metadata persistence)
- This is acceptable: users keep browser open during 30-90 minute batch operations

## Architecture Design

### State Structure

```typescript
// Global application state
interface AppState {
  // Upload management
  uploads: Record<string, UploadMetadata>
  activeUploadIds: string[]

  // Video pipeline tracking
  videos: Record<string, VideoState>
  pipelineStatus: Record<string, PipelineStatus>

  // User preferences
  preferences: UserPreferences

  // Actions
  addUpload: (upload: UploadMetadata) => void
  updateUploadProgress: (id: string, progress: number) => void
  completeUpload: (id: string) => void
  removeUpload: (id: string) => void

  updateVideoState: (videoId: string, state: VideoState) => void
  updatePipelineStatus: (videoId: string, stage: string, status: Status) => void
}
```

### Components

**1. Zustand Store (`app/stores/app-store.ts`)**
- Central state management
- localStorage persistence for metadata
- Redux DevTools integration for debugging
- Partialize: only persist serializable data (not TUS instances)

**2. Upload Manager Service (`app/services/upload-manager.ts`)**
- Singleton service managing TUS upload instances
- Separate from React lifecycle (survives navigation)
- Integrates with Zustand store for state updates
- Handles resume logic for interrupted uploads

**3. Upload Progress UI (`app/components/UploadProgress.tsx`)**
- Navbar component showing active uploads/pipelines
- Visible from any page
- Click to expand details or navigate to upload page
- Uses Zustand store subscription

**4. Pipeline Status Tracker**
- Monitors video processing stages
- Updates global state as pipelines progress
- Enables debugging of stuck/failed processing

### Persistence Strategy

**What persists (localStorage via Zustand):**
- Upload metadata (file name, size, progress, upload URL)
- Video processing state
- Pipeline status
- User preferences

**What doesn't persist (in-memory only):**
- TUS upload instances (contain WebSocket connections, File handles)
- Active polling/timers
- React component state

**On page reload:**
1. Zustand rehydrates state from localStorage
2. UploadManager detects incomplete uploads
3. Creates new TUS instances with persisted metadata
4. TUS protocol resumes from last checkpoint
5. Progress continues from where it left off

### State Flow

```
User Action (Upload file)
  ↓
Upload Manager
  ↓ creates TUS instance
  ↓ stores metadata
  ↓
Zustand Store
  ↓ persists to localStorage
  ↓ notifies subscribers
  ↓
UI Components (Navbar, Upload Page)
  ↓ re-render with new state

User Navigates (/upload → /videos)
  ↓ Upload page unmounts
  ↓ TUS instances continue in UploadManager
  ↓ Zustand state persists
  ↓ Navbar shows progress

User Closes Browser Tab
  ↓ JavaScript execution stops
  ↓ TUS uploads pause
  ↓ Metadata remains in localStorage

User Reopens App
  ↓ Zustand rehydrates from localStorage
  ↓ UploadManager detects incomplete uploads
  ↓ Creates new TUS instances
  ↓ TUS resumes from checkpoint
  ↓ Uploads continue
```

## Implementation Plan

### Phase 1: Zustand Store Setup ✅ COMPLETE
- [x] Install `zustand` dependency
- [x] Create `app/stores/app-store.ts` with persistence
- [x] Add Redux DevTools integration
- [x] Define TypeScript interfaces for state (`app/types/store.ts`)

### Phase 2: Upload Manager Service ✅ COMPLETE
- [x] Create `app/services/upload-manager.ts` singleton
- [x] Extract TUS upload logic (service handles all TUS operations)
- [x] Integrate with Zustand store
- [x] Add resume functionality
- [x] Create `useUploadManager` hook for React integration

### Phase 3: UI Integration 🔄 IN PROGRESS
- [x] Create `UploadProgress` navbar component
- [x] Integrate UploadProgress into AppLayout
- [ ] Update `upload.tsx` to use store and UploadManager
- [ ] Add incomplete upload detection on app load
- [ ] Test upload state visualization

### Phase 4: Pipeline State Tracking ⏸️ FUTURE
- [ ] Extend store for pipeline status (foundation already in place)
- [ ] Add pipeline status API endpoints
- [ ] Create pipeline monitoring UI
- [ ] Integrate with existing video processing

### Phase 5: Testing & Polish ⏸️ FUTURE
- [ ] Test 30 simultaneous uploads
- [ ] Test navigation during uploads
- [ ] Test browser refresh during uploads
- [ ] Test resume after crash
- [ ] Add user notifications

## Implementation Progress

**2025-12-31 - Phase 1 & 2 Complete**

### Files Created:
- `app/types/store.ts` - TypeScript interfaces for global state
- `app/stores/app-store.ts` - Zustand store with persistence & DevTools
- `app/services/upload-manager.ts` - Singleton upload service
- `app/hooks/useUploadManager.ts` - React integration hook
- `app/components/UploadProgress.tsx` - Navbar progress indicator

### Files Modified:
- `app/components/AppLayout.tsx` - Added UploadProgress to navbar

### Key Features Implemented:
1. **Global state management** - Zustand with localStorage persistence
2. **Upload orchestration** - UploadManager survives navigation
3. **Progress visibility** - Navbar badge shows active operations from any page
4. **Resume capability** - Store upload URLs for resuming interrupted uploads
5. **Debugging tools** - Redux DevTools integration for state inspection

### TypeScript Compilation: ✅ PASSING

### Next Steps:
1. Update `upload.tsx` to use `useUploadManager` instead of `useUploadQueue`
2. Test navigation during uploads (uploads should continue)
3. Test page refresh during uploads (should prompt to resume)
4. Add user notifications for completed uploads

## Benefits for Background Processing

This architecture supports **any long-running background operation**, not just uploads:

### Current Use Cases
- **File uploads** - 30-90 minute batch operations
- **Video processing pipelines** - Crop, OCR, caption extraction
- **Annotation workflows** - Progress tracking across sessions

### Future Use Cases
- **Export operations** - Generate reports, download batches
- **Batch operations** - Bulk annotation updates
- **Background sync** - Sync with external services
- **Offline support** - Queue operations for later

### Global Progress Indicator Pattern

```tsx
// Navbar shows all background operations
<UploadProgress
  uploads={activeUploads}
  pipelines={activePipelines}
  operations={activeOperations}
/>
```

Users always know what's happening, from any page.

## DevTools Integration

**Redux DevTools capabilities:**
- Time-travel debugging - replay state changes
- State inspection - see exact state at any point
- Action tracking - understand what triggered changes
- Pipeline debugging - trace video through processing stages

**Example debugging scenario:**
```
User: "Video stuck in 'processing' for 2 hours"

Developer:
1. Opens Redux DevTools
2. Searches for videoId in state
3. Sees timeline of state changes
4. Identifies: crop_frames failed at 14:23
5. Error: "FFmpeg timeout on frame 9500"
6. Root cause identified in minutes
```

## Testing Strategy

### Unit Tests
- Zustand store actions and selectors
- UploadManager resume logic
- State persistence/rehydration

### Integration Tests
- Upload flow with navigation
- Resume after simulated crash
- Multiple concurrent uploads
- Pipeline state transitions

### Manual Testing Checklist
- [ ] Upload 30 files, navigate between pages
- [ ] Close browser mid-upload, reopen, verify resume
- [ ] Simulate network failure, verify retry
- [ ] Test with slow connection (throttled)
- [ ] Verify navbar updates from all pages

## Future Enhancements

**Potential upgrades (not planned yet):**
- Service Worker for tab-close persistence (if users request)
- Optimistic UI updates with rollback
- Upload queue prioritization
- Bandwidth throttling controls
- Multi-user collaboration (shared state via WebSocket)

## References

- **Zustand docs:** https://github.com/pmndrs/zustand
- **TUS protocol:** https://tus.io/protocols/resumable-upload.html
- **Redux DevTools:** https://github.com/reduxjs/redux-devtools
- **React Router state:** https://reactrouter.com/en/main/hooks/use-blocker

---

**Implementation started:** 2025-12-31
**Target completion:** Phase 1-3 complete by 2026-01-02
**Owner:** claude2 (autonomous worktree)
