# CaptionA.cc Database Schema

Comprehensive specification of all database models for the CaptionA.cc capture capture platform.

> **For package usage, installation, and migration management**, see **[packages/data_access/README.md](packages/data_access/README.md)**

## Quick Reference

**Package**: `captionacc-db` (location: `packages/data_access/`)

**Import models:**
```python
from captionacc_db.models import Video, Caption, User
```

**Model organization:** Models are in `packages/data_access/src/captionacc_db/models/`:
- `captions.py` - Caption, CaptionCharacter
- `clips.py` - Clip transcription and alignment models
- `users.py` - User, Session, Subscription
- `ml_pipeline.py` - ML pipeline models

**For detailed usage examples, engine configuration, and migration workflows**, see **[packages/data_access/README.md](packages/data_access/README.md)**

## Schema Organization

### Content Models
Foundation models for video content:
- `Video` - Video metadata with playback information

### User Models
User authentication and access:
- `User` - Authentication and profile
- `Subscription` - Billing and access control
- `Session` - Study session tracking

### ML Pipeline Models
ML infrastructure and quality control:
- `CaptionAnnotation` - ML/annotation pipeline output (read-only)
- `ClipAnnotation` - ML/annotation output (read-only)
  - TODO: choose terminology 'clip' or 'segment' and apply consistently
- `UserAnnotation` - User suggested corrections
- `DataPipelineVersion` - ML/annotation pipeline versioning and metrics

---

## Core Content Models

### Video
**Purpose**: Video metadata

**Key Fields**:
- `id` (PK, int): Auto-increment primary key
- `video_id` (string): Video identifier, URL-friendly
- Caption crop coordinates: `caption_crop_left`, `caption_crop_right`, `caption_crop_top`, `caption_crop_bottom`
- Video dimensions: `video_width`, `video_height`

**Design Notes**:
- Caption crop coords define burned-in subtitle region for hiding/showing
- Video dimensions required for crop ratio calculations

---

## User Models

### User
**Purpose**: Authentication and profile

**Key Fields**:
- `id` (PK, int)
- `email` (unique, indexed)
- `password_hash`
- Status: `is_active`, `is_verified`
- Profile: `display_name`, `preferred_language`

**Relationships**:
- Has one `Subscription`
- Has many `Session`

---

### Subscription
**Purpose**: User access and billing

**Key Fields**:
- `id` (PK, int)
- `user_id` (FK, unique)
- Status: `status`, `tier` ('free', 'basic', 'premium')
- Billing: `stripe_customer_id`, `stripe_subscription_id`
- Period: `current_period_start`, `current_period_end`
- Grandfathering: `is_grandfathered`, `grandfathered_price`

**Design Notes**:
- Supports grandfathering for early adopters
- `cancel_at_period_end` for graceful downgrades

---

## ML/annotation Pipeline Models

### CaptionAnnotation, ClipAnnotation
**Purpose**: Raw ML-generated caption data (read-only)

**Key Fields**:
- `id` (PK, int)
- `video_id` (FK), `show_id` (FK)
- Timing: `start_time`, `end_time`
- OCR: `text`
- See actual annotations for remaining fields 
- ML (consider adding): `ml_model_version`, `detection_confidence`, `pipeline_metadata` (JSON)

**Indexes**:
- `(video_id, start_time)`
- `annotation_status`

**Design Rationale**:
- Source of truth for initial caption detection

---

### UserAnnotation
**Purpose**: User corrections for feedback

**Key Fields**:
- `id` (PK, int)
- Target (one of): `caption_id`, `caption_annotation_id`, `segment_id`, `exercise_content_id`
- Correction: `correction_type`, `issue_description`, `old_value`, `new_value`, `suggested_correction`
- Status: `status` ('submitted', 'reviewed', 'applied', 'rejected'), `admin_notes`
- Attribution: `submitted_by_user_id`, `reviewed_by_user_id`
- Timing: `submitted_at`, `reviewed_at`, `applied_at`

**Indexes**:
- `status`
- `(correction_type, status)`
- `submitted_by_user_id`

**Design Notes**:
- Users can flag issues and suggest corrections
- Admins review and apply corrections
- Corrections feed back into ML model training

---

### MLModel
**Purpose**: ML model versioning and metrics

**Key Fields**:
- `id` (PK, int)
- Identification: `model_type`, `version`, `model_name`
- Metrics: `accuracy`, `precision`, `recall`, `f1_score`
- Metadata: `framework`, `architecture`, `training_dataset`, `hyperparameters` (JSON)
- Deployment: `deployment_status`, `deployment_notes`
- Timing: `training_date`, `deployed_at`, `retired_at`

**Design Notes**:
- Tracks different pipeline models (detection, OCR, segmentation, diarization, NLP)
- Supports A/B testing and model rollback

---

## Key Design Principles

### 1. Language-Agnostic Design
- `romanization` (not "pinyin") in Caption
- Future-proof for Japanese, Korean, Spanish, etc.

---

## Database Technology Considerations

### Current: SQLite
- Suitable for development and initial production
- Handles 300-900K caption records efficiently
- Queries scoped to single video (~2K rows)

### Future: PostgreSQL
- Migrate when:
  - 10+ concurrent users
  - Need better full-text search
  - Want advanced analytics queries
  - Need ARRAY type support (currently using JSON)
