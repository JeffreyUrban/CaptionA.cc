# Split Database Implementation Plan

## Overview

Migrate application code from monolithic `captions.db` to split database architecture.

## Current State

✅ **Completed:**
- Migration script created and tested
- All 374 videos migrated to split structure
- Architecture documentation written
- Backups created (annotations_backup_*.db)

**Current Structure:**
```
!__local/data/_has_been_deprecated__!/{hash}/{video_id}/
  ├── video.db              ✅ Created
  ├── fullOCR.db            ✅ Created
  ├── layout.db             ✅ Created
  ├── captions.db           ✅ Created
  ├── captions.db.old    ✅ Backup
  └── *.mp4                 (unchanged)
```

## Implementation Phases

### Phase 1: Database Access Layer (Priority: HIGH)

**Goal:** Create abstraction layer for multi-database access

**Tasks:**

#### 1.1 Create VideoDatabase Class
**File:** `data-pipelines/caption_boundaries/src/caption_boundaries/database/multi_db.py`

```python
class VideoDatabase:
    """Context manager for accessing split video databases."""

    def __init__(self, video_dir: Path, readonly: bool = False):
        """
        Args:
            video_dir: Path to video directory containing .db files
            readonly: If True, open databases in read-only mode
        """
        self.video_dir = video_dir
        self.readonly = readonly
        self.conn = None

    def __enter__(self) -> sqlite3.Connection:
        """Attach all databases and return connection."""
        # Implementation details in architecture doc
        pass

    def __exit__(self, *args):
        """Close connection."""
        pass
```

**Acceptance Criteria:**
- [ ] Opens all 6 databases
- [ ] Handles missing databases gracefully
- [ ] Supports read-only mode
- [ ] Provides single connection for queries
- [ ] Properly closes all attachments

**Estimated Effort:** 2-3 hours

#### 1.2 Add Database Path Utilities
**File:** `data-pipelines/caption_boundaries/src/caption_boundaries/database/paths.py`

```python
def get_video_databases(video_dir: Path) -> dict[str, Path]:
    """Get paths to all split databases for a video."""
    return {
        'video': video_dir / 'video.db',
        'fullOCR': video_dir / 'fullOCR.db',
        'layout': video_dir / 'layout.db',
        'captions': video_dir / 'captions.db',
    }

def check_databases_exist(video_dir: Path) -> dict[str, bool]:
    """Check which databases exist for a video."""
    pass
```

**Acceptance Criteria:**
- [ ] Returns correct paths
- [ ] Validates database existence
- [ ] Handles Path vs str inputs

**Estimated Effort:** 1 hour

#### 1.3 Update Existing Database Utilities
**File:** `data-pipelines/caption_boundaries/src/caption_boundaries/database/storage.py`

**Changes:**
- Update `get_video_db()` to use VideoDatabase
- Add backward compatibility for old structure
- Update connection management

**Acceptance Criteria:**
- [ ] Maintains backward compatibility
- [ ] Works with both old and new structure
- [ ] Updates all callers

**Estimated Effort:** 2-3 hours

---

### Phase 2: Data Access Layer Updates (Priority: HIGH)

**Goal:** Update all data access code to use split databases

#### 2.1 Update Dataset Loading
**File:** `data-pipelines/caption_boundaries/src/caption_boundaries/data/dataset.py`

**Current Code Pattern:**
```python
# OLD
conn = sqlite3.connect(video_dir / "captions.db")
cursor.execute("SELECT image_data FROM full_frames WHERE frame_index = ?")
```

**New Code Pattern:**
```python
# NEW
with VideoDatabase(video_dir) as conn:
    cursor.execute("SELECT image_data FROM video.full_frames WHERE frame_index = ?")
```

**Tables to Update:**
- `CaptionBoundaryDataset._load_sample()` → use `video.full_frames`, `cropping.cropped_frames`
- OCR loading → use `fullOCR.full_frame_ocr`
- Label loading → use `layout.full_frame_box_labels`

**Acceptance Criteria:**
- [ ] Dataset loads frames from video.db
- [ ] Dataset loads OCR from fullOCR.db
- [ ] Dataset loads labels from layout.db
- [ ] All unit tests pass

**Estimated Effort:** 4-6 hours

#### 2.2 Update Training Pipeline
**File:** `data-pipelines/caption_boundaries/src/caption_boundaries/training/trainer.py`

**Changes:**
- Update database connections in trainer
- Ensure model saving works with split structure
- Update experiment tracking

**Acceptance Criteria:**
- [ ] Training runs successfully
- [ ] Checkpoints save correctly
- [ ] Metrics logging works
- [ ] W&B integration intact

**Estimated Effort:** 2-3 hours

#### 2.3 Update Inference Pipeline
**File:** `data-pipelines/caption_boundaries/src/caption_boundaries/inference/*.py`

**Changes:**
- Update `BoundaryPredictor` to use split databases
- Update quality checks to access correct databases

**Acceptance Criteria:**
- [ ] Inference loads data correctly
- [ ] Predictions work
- [ ] Quality checks run

**Estimated Effort:** 2-3 hours

---

### Phase 3: Annotation Tools Updates (Priority: MEDIUM)

**Goal:** Update annotation interfaces to write to correct databases

#### 3.1 Update Layout Annotation Tool
**Location:** (Identify current annotation interface)

**Changes:**
- Connect to `layout.db` for read-write
- Connect to other DBs as read-only
- Save box labels to `layout.full_frame_box_labels`
- Retrain and save model to `layout.box_classification_model`

**Acceptance Criteria:**
- [ ] Can load frames and OCR
- [ ] Can annotate box labels
- [ ] Saves to layout.db only
- [ ] Model training works

**Estimated Effort:** 3-4 hours

#### 3.2 Update Caption Editing Tool
**Location:** (Identify current caption interface)

**Changes:**
- Connect to `captions.db` for read-write
- Save caption edits to `captions.captions`

**Acceptance Criteria:**
- [ ] Can load frames
- [ ] Can edit captions
- [ ] Saves to captions.db only

**Estimated Effort:** 2-3 hours

---

### Phase 4: Processing Pipeline Updates (Priority: MEDIUM)

**Goal:** Update video processing workflows for split structure

#### 4.1 Update Video Ingestion
**File:** (Identify video ingestion pipeline)

**Changes:**
- Create `video.db` with full_frames and video_metadata
- Initialize empty databases for other tables
- Set up proper indices

**Acceptance Criteria:**
- [ ] New videos create all 6 databases
- [ ] video.db contains frames + metadata
- [ ] Other DBs initialized with schemas

**Estimated Effort:** 3-4 hours

#### 4.2 Update OCR Pipeline
**File:** (Identify OCR processing pipeline)

**Changes:**
- Read frames from `video.db`
- Write OCR results to `fullOCR.db`
- Handle re-running OCR (replace fullOCR.db)

**Acceptance Criteria:**
- [ ] OCR reads from video.db
- [ ] OCR writes to fullOCR.db
- [ ] Re-run OCR replaces fullOCR.db

**Estimated Effort:** 2-3 hours

#### 4.3 Update Cropping Pipeline
**File:** (Identify cropping pipeline)

**Changes:**
- Read frames from `video.db`

**Acceptance Criteria:**
- [ ] Cropping reads from video.db
- [ ] Layout config updates work

**Estimated Effort:** 2-3 hours

---

### Phase 5: Testing & Validation (Priority: HIGH)

**Goal:** Ensure split database implementation works correctly

#### 5.1 Unit Tests

**New Test File:** `tests/test_multi_database.py`

```python
def test_video_database_context_manager():
    """Test VideoDatabase opens and attaches all databases."""
    pass

def test_cross_database_queries():
    """Test queries across attached databases."""
    pass

def test_readonly_mode():
    """Test read-only database access."""
    pass

def test_missing_database_handling():
    """Test graceful handling of missing databases."""
    pass
```

**Acceptance Criteria:**
- [ ] All new unit tests pass
- [ ] Existing unit tests pass
- [ ] Integration tests pass
- [ ] Test coverage >80%

**Estimated Effort:** 4-6 hours

#### 5.2 Manual Testing

**Test Cases:**
1. Load video and view frames
2. Run OCR and view results
3. Annotate layout (box labels)
4. Train classification model
5. Edit captions
6. Regenerate crops
7. Export training dataset

**Acceptance Criteria:**
- [ ] All workflows complete successfully
- [ ] Data persists to correct databases
- [ ] No data corruption
- [ ] Performance acceptable

**Estimated Effort:** 3-4 hours

#### 5.3 Data Integrity Checks

**Script:** `scripts/verify-split-databases.py`

```python
def verify_row_counts(video_dir: Path) -> bool:
    """Verify row counts match between old and new."""
    pass

def verify_data_integrity(video_dir: Path) -> bool:
    """Verify data values match between old and new."""
    pass

def verify_all_videos() -> dict:
    """Run checks on all videos."""
    pass
```

**Acceptance Criteria:**
- [ ] Row counts match between old/new
- [ ] Sample data values match
- [ ] All foreign key references valid
- [ ] No orphaned records

**Estimated Effort:** 2-3 hours

---

### Phase 6: DVC Integration (Priority: MEDIUM)

**Goal:** Set up DVC tracking for split databases

#### 6.1 Update DVC Tracking Script
**File:** `scripts/setup-dvc-tracking.py`

**Changes:**
- Track all databases
- Update .gitignore patterns
- Handle existing .dvc files

**Acceptance Criteria:**
- [ ] Tracks video.db, fullOCR.db, layout.db, captions.db
- [ ] Creates .dvc files in correct locations
- [ ] Updates .gitignore

**Estimated Effort:** 2-3 hours

#### 6.2 Initial DVC Push
**Command Sequence:**
```bash
# Track all split databases
python scripts/setup-dvc-tracking.py

# Stage .dvc files
git add '!__local/data/_has_been_deprecated__!/**/*.dvc'
git add '!__local/data/_has_been_deprecated__!/**/.gitignore'

# Commit
git commit -m "Set up DVC tracking for split databases"

# Push to DVC storage (this will take time - 60.9 GB)
dvc push

# Push to git
git push
```

**Acceptance Criteria:**
- [ ] All databases tracked by DVC
- [ ] .dvc files committed to git
- [ ] Data uploaded to DVC storage
- [ ] Team can pull data

**Estimated Effort:** 1-2 hours (plus upload time)

#### 6.3 Update Documentation
**Files:**
- README.md
- CONTRIBUTING.md
- Team wiki/docs

**Changes:**
- Document new database structure
- Update DVC workflow instructions
- Add troubleshooting guide

**Acceptance Criteria:**
- [ ] Documentation updated
- [ ] Workflow examples clear
- [ ] Troubleshooting section complete

**Estimated Effort:** 2-3 hours

---

### Phase 7: Cleanup & Optimization (Priority: LOW)

**Goal:** Remove backups and optimize performance

#### 7.1 Verify and Remove Backups
```bash
# After thorough testing, remove backup files
find !__local/data/_has_been_deprecated__! -name 'annotations_backup_*.db' -delete
```

**Acceptance Criteria:**
- [ ] Application works without backups
- [ ] Team confirms no issues
- [ ] Backups deleted

**Estimated Effort:** 30 minutes

#### 7.2 Performance Optimization

**Potential Optimizations:**
- Add connection pooling
- Implement lazy database attachment
- Add query result caching
- Optimize cross-database queries

**Acceptance Criteria:**
- [ ] Benchmark before/after
- [ ] No performance regression
- [ ] Documented improvements

**Estimated Effort:** 4-6 hours (optional)

---

## Timeline Estimate

### Critical Path (Minimum Viable)
1. Phase 1: Database Access Layer - **3-6 hours**
2. Phase 2: Data Access Updates - **8-12 hours**
3. Phase 5.1: Unit Tests - **4-6 hours**
4. Phase 5.2: Manual Testing - **3-4 hours**

**Total Critical Path:** 18-28 hours (~2-4 days)

### Full Implementation
- Phases 1-7: **40-60 hours** (~1-1.5 weeks)

### Phased Rollout
- **Week 1:** Phases 1-2 (core infrastructure)
- **Week 2:** Phases 3-5 (annotation tools + testing)
- **Week 3:** Phases 6-7 (DVC + cleanup)

## Risk Mitigation

### High Risk Areas

**1. Data Corruption**
- **Risk:** Bug in migration or application code corrupts data
- **Mitigation:** Keep backups until fully verified (annotations_backup_*.db)
- **Rollback:** Restore from backup, fix issue, re-migrate

**2. Application Breakage**
- **Risk:** Application fails to load data from split databases
- **Mitigation:** Comprehensive testing, staged rollout
- **Rollback:** Temporary shim to read from captions.db.old

**3. DVC Storage Costs**
- **Risk:** Large upload to DVC storage
- **Mitigation:** 60.9 GB one-time upload, then only incremental
- **Monitoring:** Track DVC storage usage

**4. Team Disruption**
- **Risk:** Team can't access data during transition
- **Mitigation:** Keep old structure working during migration
- **Communication:** Clear documentation + team training

### Rollback Plan

If critical issues arise:

```bash
# 1. Stop using new databases
# 2. Restore original structure
for backup in !__local/data/_has_been_deprecated__!/*/annotations_backup_*.db; do
    dir=$(dirname "$backup")
    cp "$backup" "$dir/captions.db"
done

# 3. Remove split databases
find !__local/data/_has_been_deprecated__! -name 'video.db' -delete
find !__local/data/_has_been_deprecated__! -name 'fullOCR.db' -delete
# ... etc

# 4. Revert application code
git revert <commit-hash>
```

## Success Metrics

### Technical Metrics
- [ ] All 374 videos accessible via split databases
- [ ] 100% unit test coverage for multi-database code
- [ ] Zero data integrity issues
- [ ] No performance regression

### Business Metrics
- [ ] Annotation workflow times unchanged or improved
- [ ] DVC storage costs as expected
- [ ] Team productive with new structure
- [ ] 95%+ storage savings on annotation versioning

## Next Actions

**Immediate (This Week):**
1. ✅ Complete migration (DONE - 374 videos)
2. ✅ Write architecture docs (DONE)
3. ✅ Write implementation plan (DONE)
4. ⏳ Start Phase 1: Database Access Layer

**Short Term (Next 2 Weeks):**
5. Complete Phases 1-3 (core functionality)
6. Run comprehensive tests
7. Set up DVC tracking

**Medium Term (Next Month):**
8. Full team rollout
9. Monitor and optimize
10. Remove backups after verification

## Questions & Decisions Needed

1. **Backward Compatibility:** How long should we support reading from old `captions.db` structure?
   - Recommendation: 1 month, then deprecate

2. **Error Handling:** What should happen if a database is missing?
   - Recommendation: Fail fast with clear error message

3. **Database Locking:** How should we handle concurrent access?
   - Recommendation: Use WAL mode, document limitations

4. **Schema Migrations:** How to handle future schema changes?
   - Recommendation: Add migration system (separate task)

5. **Testing Strategy:** Test with real data or synthetic?
   - Recommendation: Both - unit tests with synthetic, integration with real

## Resources

- **Architecture Doc:** `data-pipelines/docs/database-split-architecture.md`
- **Migration Script:** `scripts/migrate-split-databases.py`
- **Current Code:** `data-pipelines/caption_boundaries/`
- **DVC Docs:** https://dvc.org/doc

## Team Communication

**Announcement Template:**
```
Subject: Video Database Structure Update - Action Required

Team,

We've migrated our video databases to a split structure for better DVC efficiency.

WHAT CHANGED:
- Old: Single captions.db per video
- New: 6 separate databases (video.db, fullOCR.db, etc.)

WHY:
- 98.8% reduction in DVC versioning overhead
- Faster annotation workflows
- Better separation of concerns

ACTION REQUIRED:
1. Pull latest code
2. Review data-pipelines/docs/database-split-architecture.md
3. Test annotation workflow
4. Report any issues in #caption-boundaries

TIMELINE:
- This week: Code updates
- Next week: Testing
- Following week: Full rollout

Questions? See docs or ask in Slack.
```
