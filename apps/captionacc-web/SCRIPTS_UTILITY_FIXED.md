# Utility Scripts TypeScript Warnings Fixed

## Summary

Fixed all 11 TypeScript/ESLint warnings in 3 utility scripts by:
- Replacing non-null assertions with proper null checks
- Reducing code complexity by extracting helper functions
- Flattening nested conditionals with early returns

## Files Fixed

### 1. scripts/audit-database-schemas.ts (7 warnings fixed)

**Issues:**
- 4 non-null assertions (`!` operator)
- 3 complexity/max-depth warnings

**Solutions:**
- Replaced `allTables.get(tableName)!` with null-safe check:
  ```typescript
  const tableSet = allTables.get(tableName)
  if (tableSet) {
    tableSet.add(shortPath)
  }
  ```
- Replaced `colMap.get(colName)!` with null-safe check
- Replaced `tableColumns.get(tableName)!` with early return pattern
- Extracted `trackTableColumns()` helper function to reduce nesting
- Extracted `processDatabaseSchema()` helper function to reduce nesting
- Extracted `collectAllSchemas()` helper function to reduce main() complexity

**Before:** 7 warnings (non-null assertions + complexity + max-depth)
**After:** 0 warnings

### 2. scripts/cleanup-stale-uploads.ts (4 warnings fixed)

**Issues:**
- Function complexity of 19 (max 15)
- 3 max-depth violations (nested 5-7 levels deep)

**Solutions:**
- Extracted `markDatabaseAsError()` helper function to handle database updates
- Extracted `parseUploadMetadata()` helper function to parse and extract upload info
- Extracted `deleteStaleUpload()` helper function to handle file deletion and DB updates
- Reduced main function from complexity 19 to under 15
- Flattened nesting from 7 levels to 3 levels

**Before:** 4 warnings (1 complexity + 3 max-depth)
**After:** 0 warnings

### 3. scripts/generate-ocr-viz.ts (2 warnings fixed)

**Issues:**
- 2 non-null assertions on `layoutConfig.anchor_position!` and `layoutConfig.vertical_position!`

**Solutions:**
- Added explicit null checks before accessing properties:
  ```typescript
  const layoutParams =
    layoutConfig.anchor_type &&
    layoutConfig.anchor_position !== null &&
    layoutConfig.vertical_position !== null
      ? {
          anchorType: layoutConfig.anchor_type,
          anchorPosition: layoutConfig.anchor_position,
          verticalPosition: layoutConfig.vertical_position,
        }
      : undefined
  ```

**Before:** 2 warnings (non-null assertions)
**After:** 0 warnings

## Verification

```bash
# ESLint check on utility scripts
npx eslint scripts/audit-database-schemas.ts scripts/cleanup-stale-uploads.ts scripts/generate-ocr-viz.ts
# Result: 0 warnings

# Full scripts directory check
npx eslint scripts/
# Result: 0 warnings
```

## Technical Details

### Non-null Assertion Fixes
- Replaced all `!` operators with proper null checks
- Used early returns to avoid unnecessary nesting
- Maintained original logic while improving type safety

### Complexity Reduction
- Extracted 6 new helper functions across the two complex scripts
- Each helper function has a single, clear responsibility
- Reduced cyclomatic complexity through function extraction
- Improved code readability and maintainability

### Max-Depth Fixes
- Flattened deeply nested conditionals (7 levels -> 3 levels)
- Used early returns to reduce indentation
- Extracted nested logic into helper functions

## Impact

- All 11 TypeScript/ESLint warnings resolved
- Code is more maintainable and easier to understand
- Type safety improved with proper null checks
- No changes to functionality or behavior
- Scripts remain utility-focused and pragmatic
