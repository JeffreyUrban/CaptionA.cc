# TypeScript Warnings Fixed in app/utils/

## Summary

**Before**: 37 warnings
**After**: 0 warnings

All TypeScript/ESLint warnings in the `app/utils/` directory have been resolved through proper TypeScript patterns including type guards, optional chaining, explicit null checks, and function extraction to reduce complexity.

## File-by-File Breakdown

### 1. feature-importance.ts (26 warnings -> 0)

**Original Issues**: 26 non-null assertion (`!`) warnings

**Approach**:
- Replaced all non-null assertions with nullish coalescing (`?? 0`) for array access
- Added explicit type guards where TypeScript couldn't infer safety
- Extracted helper functions to reduce complexity in `computeClassCovariance`:
  - `computeFeatureMeans()` - calculates mean values for all features
  - `accumulateSampleCovariance()` - accumulates covariance contributions per sample
  - `normalizeCovarianceMatrix()` - normalizes matrix by divisor
- Declared array types explicitly (`const arr: number[] = ...`) to help TypeScript inference

**Key Changes**:
- Lines 49-71: Added null checks for `outFeatures[idx]` and `FEATURE_NAMES[idx]`
- Lines 119-132: Used `?? 0` for covariance array access instead of `!`
- Lines 135-202: Refactored covariance computation into smaller helper functions
- Lines 228-234, 254-288, 297-319: Used `?? 0` or `?? 1` for matrix element access
- Lines 331-339: Safe diagonal matrix inverse with null coalescing
- Lines 372-384: Safe Mahalanobis distance computation with null guards

### 2. video-permissions.ts (1 warning -> 0)

**Original Issue**: Complexity of 18 (max 15) in `getVideoPermissions`

**Approach**: Extracted permission-checking logic into dedicated helper functions

**Key Changes**:
- Added `canTrialUserAnnotate()` - checks if trial user can annotate a video
- Added `checkAnnotationPermission()` - determines annotation permission based on ownership and tier
- Main function now delegates to these helpers, reducing its cyclomatic complexity

### 3. upload-folder-structure.ts (4 warnings -> 0)

**Original Issues**: 4 non-null assertions

**Approach**: Replaced `!` with proper null checks and fallbacks

**Key Changes**:
- Line 62: Added null check for `subfolders.get(segment)` with early return pattern
- Lines 124-128: Added guard clause for `filename = path.split('/').pop()`
- Lines 145, 165: Used nullish coalescing with `uploadFile.file.name` as fallback

### 4. box-prediction.ts (2 warnings -> 0)

**Original Issues**:
- `trainModel` function had 255 lines (max 150)
- Complexity of 21 (max 15)

**Approach**: Major refactoring to extract helper functions

**Key Changes**:
- Added interface types: `AnnotationRow`, `OcrBoxRow`, `FrameDataCache`
- Extracted `fetchUserAnnotations()` - fetches annotations from database
- Extracted `buildFrameDataCache()` - builds caches for efficient feature extraction
- Extracted `extractAllFeatures()` - extracts features for all annotations
- Extracted `calculateGaussian()` - computes mean/std for a single feature
- Extracted `calculateGaussianParams()` - computes params for all 26 features
- Extracted `calculateStreamingMetrics()` - computes feature importance and covariance
- Extracted `storeTrainedModel()` - stores the trained model in the database
- Main `trainModel()` function now orchestrates these helpers, down from 255 to ~77 lines

### 5. upload-helpers.ts (2 warnings -> 0)

**Original Issues**:
- Complexity of 16 (max 15) in `collapseSingleVideoFolders`
- Max-depth of 5 (max 4)

**Approach**: Extracted helper functions and flattened nested conditionals

**Key Changes**:
- Extracted `fetchExistingFolders()` - async fetch with proper type annotations
- Extracted `buildFolderCountsMap()` - builds video count map per folder
- Extracted `shouldCollapseVideo()` - determines if a video should be collapsed
- Extracted `collapseVideoPath()` - performs the actual path collapse
- Used `continue` statements to avoid deep nesting

### 6. video-paths.ts (2 warnings -> 0)

**Original Issues**:
- Max-depth of 5 and 6 (max 4) in nested directory scanning

**Approach**: Extracted database lookup into a dedicated function

**Key Changes**:
- Extracted `findStoragePathInDb()` - handles database lookup for storage_path
- Used early `continue` in scan loop to reduce nesting depth
- Simplified the main `scanDir()` function flow

## Verification

```bash
# TypeScript compilation passes
npm run typecheck

# ESLint shows 0 warnings for app/utils/
npx eslint --no-cache app/utils/
```

## Notes

- No `eslint-disable` comments were used
- All fixes maintain the original functionality
- Code is now more modular and easier to test
- Type safety is improved through explicit null handling
