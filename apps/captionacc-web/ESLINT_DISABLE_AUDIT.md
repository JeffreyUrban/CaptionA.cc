# ESLint Disable Comments Audit

**Date**: 2026-01-14
**Total Found**: 12 instances
**Status**: Ready to Fix

---

## Category 1: React Hooks Exhaustive Deps (9 instances)

### ✅ ALREADY WELL-DOCUMENTED (5 instances)
**File**: `app/hooks/useBoundaryAnnotationData.ts`
**Lines**: 312, 430, 486, 571, 615

**Current State**:
```typescript
// eslint-disable-next-line react-hooks/exhaustive-deps -- jumpRequestedRef and jumpTargetRef are refs and don't need to be in dependencies
```

**Analysis**: These have clear explanations and are valid suppressions (refs don't trigger re-renders)
**Action**: ✅ KEEP - Already properly documented

---

### ✅ ALREADY WELL-DOCUMENTED (1 instance)
**File**: `app/hooks/useUploadQueue.ts`
**Line**: 202

**Current State**:
```typescript
// eslint-disable-next-line react-hooks/exhaustive-deps -- processUploadQueue is defined below and uses setVideoFiles internally
```

**Analysis**: Has clear explanation for why dependency is excluded
**Action**: ✅ KEEP - Already properly documented

---

### ⚠️ NEEDS REVIEW (3 instances)

#### 1. `app/hooks/useKeyboardShortcuts.ts:51`
**Current Code**:
```typescript
useEffect(() => {
  // ... keyboard handler setup
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, deps)
```

**Problem**: No explanation, unclear why `handleKeyDown` is excluded
**Fix Options**:
1. Add `handleKeyDown` to deps (may need useCallback)
2. Add explanation if intentionally excluded
3. Refactor to make deps correct

---

#### 2. `app/hooks/useBoundaryWorkflowState.ts:130`
**Current Code**:
```typescript
useEffect(() => {
  async function loadInitial() {
    // ... initialization logic
    setIsInitialized(true)
  }
  void loadInitial()
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [videoId])
```

**Problem**: No explanation, only `videoId` in deps but `loadInitial` uses other values
**Fix Options**:
1. Add explanation for excluded dependencies
2. Add missing dependencies if needed
3. Refactor if dependencies are intentionally excluded

---

#### 3. `app/routes/upload.tsx:100`
**Current Code**:
```typescript
// On mount: mark that user visited upload page (hides notification badge)
useEffect(() => {
  visitedUploadPage()
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

**Problem**: Empty deps array without explanation (though comment says "on mount")
**Fix Options**:
1. Add `visitedUploadPage` to deps (proper fix)
2. Wrap `visitedUploadPage` in useCallback if it's stable
3. Add explanation: `-- Run only on mount to mark page as visited`

---

## Category 2: Unused Variables (1 instance)

### 🔧 EASY FIX
**File**: `app/entry.server.tsx:32`

**Current Code**:
```typescript
export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  // This is ignored so we can keep it in the template for visibility.  Feel
  // free to delete this parameter in your app if you're not using it!
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadContext: AppLoadContext
) {
```

**Problem**: Framework template parameter that's unused
**Fix**: Rename to `_loadContext` (underscore prefix = intentionally unused)

```typescript
_loadContext: AppLoadContext  // No eslint-disable needed
```

---

## Category 3: No Explicit Any (2 instances)

### 🔧 CAN FIX WITH PROPER TYPES
**File**: `app/services/layout-analysis-service.ts:1303, 1330`

**Current Code**:
```typescript
function applyNormalizedDarkening(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any, // Canvas context from node-canvas (different type than DOM CanvasRenderingContext2D)
  ...
) {
```

**Problem**: Using `any` for node-canvas context type
**Fix Options**:

1. **Best**: Import proper type from node-canvas
```typescript
import type { CanvasRenderingContext2D as NodeCanvasContext } from 'canvas'
function applyNormalizedDarkening(
  ctx: NodeCanvasContext,
  ...
) {
```

2. **Alternative**: Create union type
```typescript
type CanvasContext = CanvasRenderingContext2D | any // DOM or node-canvas
function applyNormalizedDarkening(
  ctx: CanvasContext,
  ...
) {
```

3. **Pragmatic**: Add better comment explaining why any is needed
```typescript
// Using 'any' because node-canvas and DOM canvas have incompatible but functionally equivalent types
ctx: any
```

---

## Summary & Recommendations

| Category | Count | Action |
|----------|-------|--------|
| Well-documented React Hooks | 6 | ✅ Keep as-is |
| Under-documented React Hooks | 3 | 📝 Add explanations or fix |
| Unused parameter | 1 | 🔧 Rename with underscore |
| Any types | 2 | 🔧 Import proper types or improve docs |

### Proposed Plan:

1. **Quick wins** (5 min):
   - Fix `_loadContext` in entry.server.tsx
   - Add explanations to 3 React Hook suppressions

2. **Better fix** (10 min):
   - Import proper types for layout-analysis-service.ts
   - Review and fix the 3 React Hook deps issues properly

**Total time**: 15 minutes to address all 12 instances

**Would you like me to proceed with these fixes?**
