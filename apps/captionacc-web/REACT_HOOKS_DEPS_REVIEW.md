# React Hook Exhaustive Dependencies Review

This document summarizes all React Hook `exhaustive-deps` ESLint warnings that need review before fixing.

## Summary
- **Total Warnings**: 8
- **Files Affected**: 5

---

## 1. useBoundaryFrameLoader.ts (Line 777)

### Warning
```
React Hook useEffect has missing dependencies: 'currentFrameIndexRef', 'framesRef',
'jumpRequestedRef', and 'jumpTargetRef'. Either include them or remove the dependency array
```

### Current Code
```typescript
}, [totalFrames, videoId, isReady, nextAnnotation, activeAnnotation])
```

### Context
The code has an explicit comment explaining why refs are NOT included:
```typescript
// Note: currentFrameIndexRef is NOT in dependencies - we read from it via polling
// This allows continuous monitoring without effect re-triggering
// nextAnnotation and activeAnnotation ARE in deps:
// - nextAnnotation: triggers immediate preload when next annotation changes
// - activeAnnotation: updates cache pinning to protect current annotation frames
```

### Assessment
**INTENTIONAL** - Refs are stable and reading from them via polling is the design pattern here. Adding them would cause unnecessary re-renders.

### Recommendation
✅ Add ESLint disable comment with explanation

---

## 2. useUploadManager.ts (Line 150)

### Warning
```
React Hook useEffect has a missing dependency: 'incompleteUploads.length'.
Either include it or remove the dependency array
```

### Current Code
```typescript
useEffect(() => {
  console.log(`[useIncompleteUploadDetection] Found ${incompleteUploads.length} incomplete uploads`)
  // Show notification or prompt to user
}, []) // Only run on mount
```

### Context
This effect is explicitly designed to run only on mount to detect incomplete uploads from a previous session.

### Assessment
**INTENTIONAL** - This should only run once on mount. Adding `incompleteUploads.length` would cause it to run every time the count changes, which is not the intended behavior.

### Recommendation
✅ Add ESLint disable comment: `// eslint-disable-next-line react-hooks/exhaustive-deps -- Only run on mount to detect incomplete uploads from previous session`

---

## 3. useUploadQueueV2.ts (Lines 142, 195, 335)

### Warning (appears 3 times)
```
React Hook useEffect has a missing dependency: 'setVideoFiles'. Either include it or
remove the dependency array. If 'setVideoFiles' changes too often, find the parent
component that defines it and wrap that definition in useCallback
```

### Current Code
Line 142:
```typescript
}, []) // Run once on mount
```

Lines 195 and 335 likely similar patterns.

### Context
The effect runs once on mount. `setVideoFiles` comes from parent component state.

### Assessment
**NEEDS REVIEW** - This is a legitimate warning. Options:
1. If `setVideoFiles` is stable (from useState), it won't change and this is safe
2. If it's from props, parent should wrap it in useCallback
3. Could add to deps if we verify it's stable

### Recommendation
⚠️ **REQUIRES INVESTIGATION** - Need to trace where `setVideoFiles` comes from and ensure it's stable or wrapped in useCallback in parent

---

## 4. admin.tsx - DatabaseAdministration (Line 71)

### Warning
```
React Hook useEffect has a missing dependency: 'loadStatus'.
Either include it or remove the dependency array
```

### Current Code
```typescript
useEffect(() => {
  loadStatus()
}, [])
```

### Context
Runs on mount to load initial database status. `loadStatus` is likely defined in the component.

### Assessment
**NEEDS REVIEW** - Options:
1. If `loadStatus` uses `useCallback` with stable deps, it's safe
2. Should either add to deps or wrap `loadStatus` in useCallback

### Recommendation
⚠️ **REQUIRES FIX** - Should wrap `loadStatus` in useCallback or add to dependencies

---

## 5. admin.tsx - AdminPage (Line 601)

### Warning
```
React Hook useEffect has a missing dependency: 'loadFailedVideos'.
Either include it or remove the dependency array
```

### Current Code
```typescript
useEffect(() => {
  if (isAdmin === true) {
    void loadFailedVideos()
  }
}, [isAdmin])
```

### Context
Loads failed videos when admin status is confirmed.

### Assessment
**NEEDS REVIEW** - Similar to #4. `loadFailedVideos` should either:
1. Be wrapped in useCallback
2. Be added to dependencies

### Recommendation
⚠️ **REQUIRES FIX** - Should wrap `loadFailedVideos` in useCallback or add to dependencies

---

## 6. upload.old.tsx (Line 210)

### Warning
```
React Hook useCallback has a missing dependency: 'fileState'.
Either include it or remove the dependency array
```

### Current Code
```typescript
useCallback(
  // ... handler code using fileState
  [fileState.videoFiles, fileState.setVideoFiles]
)
```

### Context
Uses specific properties of `fileState` but not the whole object.

### Assessment
**CORRECT AS-IS** - The code correctly depends on the specific properties it uses (`fileState.videoFiles`, `fileState.setVideoFiles`) rather than the entire `fileState` object. This is more granular and prevents unnecessary re-renders.

### Recommendation
✅ Add ESLint disable comment: `// eslint-disable-next-line react-hooks/exhaustive-deps -- Depend on specific fileState properties, not entire object`

---

## Action Items

### Immediate (Can Add ESLint Disables)
1. ✅ **useBoundaryFrameLoader.ts:777** - Add disable comment (refs intentionally excluded)
2. ✅ **useUploadManager.ts:150** - Add disable comment (mount-only detection)
3. ✅ **upload.old.tsx:210** - Add disable comment (granular dependencies)

### Needs Investigation
4. ⚠️ **useUploadQueueV2.ts:142,195,335** - Verify `setVideoFiles` stability
   - Check parent component
   - Ensure wrapped in useCallback if from props

### Needs Fix
5. ⚠️ **admin.tsx:71** - Wrap `loadStatus` in useCallback
6. ⚠️ **admin.tsx:601** - Wrap `loadFailedVideos` in useCallback

---

## General Pattern Recommendations

1. **Refs in deps**: Refs (from useRef) should NOT be in dependency arrays - they're stable
2. **Mount-only effects**: Empty deps `[]` is correct when intentionally running only on mount
3. **Function deps**: Functions defined in component body should be wrapped in useCallback before using in deps
4. **Granular deps**: Depend on specific object properties (e.g., `obj.prop`) rather than entire object when possible

---

**Created**: 2026-01-14
**Status**: Awaiting review before implementing fixes
