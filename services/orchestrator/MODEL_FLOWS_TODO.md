# Box Classification Model Flows - Implementation Guide

## Overview

The box classification model flows are **framed out** with placeholder implementations. The Prefect orchestration infrastructure is complete, but the actual machine learning logic needs to be implemented.

## What's Implemented ✅

### 1. **Prefect Flow Structure**
- `base_model_update_flow` - Updates global base model
- `retrain_video_model_flow` - Retrains single video's model
- Full task decomposition with proper error handling
- Deployment configuration in `serve_flows.py`

### 2. **TypeScript Integration**
- `queueBaseModelUpdate()` - Queue base model update from admin UI
- `queueVideoModelRetrain()` - Queue video retrain from Layout UI
- CLI commands in `queue_flow.py`

### 3. **Database Schema**
- `box_classification_model` table already exists in schema ✅
- 100+ feature parameters defined
- Model versioning and metadata tracking

## What Needs Implementation 🚧

### **Critical Path: ML Implementation**

#### 1. Base Model Storage (Decision Needed)
**Location:** `base_model_update.py` lines 48-78

**Options:**
```python
# Option A: JSON file
services/orchestrator/models/base_model.json

# Option B: SQLite database
services/orchestrator/data/base_model.db

# Option C: YAML config
services/orchestrator/config/base_model.yaml
```

**Decision:** Choose one and implement load/save functions.

**Current State:** Placeholder functions that use JSON file.

---

#### 2. Feature Extraction Module
**Location:** New module needed: `services/orchestrator/ml/features.py`

**Required Functions:**
```python
def extract_geometric_features(box, layout_config) -> dict:
    """
    Calculate geometric features:
    - vertical_alignment: Distance from mode vertical position
    - height_similarity: Similarity to mode height
    - anchor_distance: Distance from anchor point
    - crop_overlap: Overlap with crop bounds
    - aspect_ratio: Box width/height ratio
    - normalized_y: Vertical position (0-1)
    - normalized_area: Box area normalized by frame area
    """
    pass

def extract_position_features(box, frame_dimensions) -> dict:
    """
    Calculate position features (normalized 0-1):
    - normalized_left, normalized_top
    - normalized_right, normalized_bottom
    """
    pass

def extract_temporal_features(box, video_duration) -> dict:
    """
    Calculate temporal features:
    - time_from_start: Seconds from video start
    - time_from_end: Seconds until video end
    """
    pass

def extract_character_features(text: str) -> dict:
    """
    Calculate character set features (language detection):
    - is_roman, is_hanzi, is_arabic, is_korean
    - is_hiragana, is_katakana, is_cyrillic
    - is_devanagari, is_thai
    - is_digits, is_punctuation
    """
    pass

def extract_all_features(box, layout_config, video_metadata) -> dict:
    """
    Combine all feature extraction.
    Returns dict matching box_classification_model schema.
    """
    pass
```

**Dependencies:**
- OCR box from `full_frame_ocr` table
- Layout config from `video_layout_config` table
- Video metadata for normalization

---

#### 3. Bayesian Model Training Module
**Location:** New module needed: `services/orchestrator/ml/bayesian_model.py`

**Required Functions:**
```python
def train_gaussian_naive_bayes(
    features: list[dict],
    labels: list[str],  # 'in' or 'out'
    base_priors: dict | None = None
) -> dict:
    """
    Train Gaussian Naive Bayes classifier.

    For each feature and each class:
    1. Calculate mean and standard deviation
    2. If base_priors provided, combine using Bayesian update
    3. Return parameters matching box_classification_model schema

    Returns:
        {
            'prior_in': float,
            'prior_out': float,
            'in_vertical_alignment_mean': float,
            'in_vertical_alignment_std': float,
            'out_vertical_alignment_mean': float,
            'out_vertical_alignment_std': float,
            ... (100+ feature parameters)
        }
    """
    pass

def predict_box_class(features: dict, model: dict) -> tuple[str, float]:
    """
    Predict class for a single box.

    Using Gaussian Naive Bayes:
    1. Calculate P(features|in) and P(features|out)
    2. Apply Bayes theorem with priors
    3. Return (predicted_label, confidence)

    Args:
        features: Feature dict from extract_all_features()
        model: Model parameters from box_classification_model

    Returns:
        ('in' or 'out', confidence 0-1)
    """
    pass

def bayesian_update_priors(
    base_priors: dict,
    new_data_features: list[dict],
    new_data_labels: list[str]
) -> dict:
    """
    Update base model priors with new data using Bayesian update.

    This is how video-specific models combine base + video data.
    """
    pass
```

---

#### 4. Implement Task Functions

**In `base_model_update.py`:**
```python
@task
def train_base_model(training_data_source: str) -> dict:
    # TODO: Lines 92-138
    # 1. Scan all video databases
    # 2. Aggregate user labels from full_frame_box_labels
    # 3. Extract features for each labeled box
    # 4. Train Gaussian NB model
    # 5. Return base model parameters
    pass

@task
def find_videos_with_models(data_dir: str) -> list[dict]:
    # TODO: Lines 151-175
    # 1. Scan data directory for video databases
    # 2. Check each for box_classification_model table
    # 3. Return list of video_id, db_path, display_path
    pass
```

**In `video_model_retrain.py`:**
```python
@task
def extract_box_features(db_path: str, box_ids: list[int]) -> list[dict]:
    # TODO: Lines 62-90
    # Use ml/features.py module
    pass

@task
def train_video_model(video_id: str, db_path: str, base_model: dict) -> dict:
    # TODO: Lines 102-160
    # 1. Load user labels from full_frame_box_labels
    # 2. Extract features
    # 3. Combine base_model with video data
    # 4. Train using ml/bayesian_model.py
    # 5. Return video model parameters
    pass

@task
def save_video_model(db_path: str, model: dict) -> None:
    # TODO: Lines 172-203
    # Save ALL 100+ parameters to box_classification_model table
    # Handle field mapping (snake_case DB ↔ camelCase code)
    pass

@task
def update_box_predictions(db_path: str, model: dict) -> dict:
    # TODO: Lines 215-258
    # 1. Load all boxes from full_frame_ocr
    # 2. Extract features for each
    # 3. Predict using model
    # 4. Batch update predicted_label, predicted_confidence, model_version
    pass
```

---

### **Secondary: UI Integration**

#### 5. Admin UI for Base Model Update
**Location:** New admin page needed

```typescript
// apps/captionacc-web/app/routes/admin.model-training.tsx

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData()
  const trainingSource = formData.get('trainingSource') as string
  const retrainVideos = formData.get('retrainVideos') === 'true'

  await queueBaseModelUpdate({
    dataDir: pathResolve(process.cwd(), '..', '..', 'local', 'data'),
    trainingSource,
    retrainVideos,
  })

  return redirect('/admin/model-training?status=queued')
}
```

---

#### 6. Automatic Retrain After N Labels (Transparent to User)
**Location:** `apps/captionacc-web/app/routes/api.annotations.$videoId.frames.$frameIndex.boxes.tsx`

```typescript
// After user labels a box:
const newLabelCount = await countUserLabels(db, videoId)

if (newLabelCount % 10 === 0) {
  // Retrain after every 10 labels
  await queueVideoModelRetrain({
    videoId,
    dbPath: getDbPath(videoId),
    updatePredictions: true,
  })
}
```

---

### **Tertiary: Scheduled Tasks**

#### 8. Periodic Base Model Update (Optional)
**Location:** `services/orchestrator/scheduled_tasks.py` (new file)

```python
from prefect.deployments import DeploymentSpec
from prefect.schedules import CronSchedule

# Run base model update weekly on Sundays at 2 AM
base_model_update_flow.serve(
    name="weekly-base-model-update",
    schedule=CronSchedule(cron="0 2 * * 0"),
    tags=["scheduled", "base-model"],
)
```

---

## Implementation Order

### Phase 1: Core ML (Blocking)
1. ✅ Choose base model storage location
2. ✅ Create `ml/features.py` module
3. ✅ Create `ml/bayesian_model.py` module
4. ✅ Implement feature extraction
5. ✅ Implement model training
6. ✅ Implement prediction

### Phase 2: Flow Implementation
1. ✅ Implement `train_base_model()` task
2. ✅ Implement `train_video_model()` task
3. ✅ Implement `save_video_model()` task (all parameters)
4. ✅ Implement `update_box_predictions()` task
5. ✅ Test flows end-to-end

### Phase 3: UI Integration
1. ✅ Add admin page for base model update
2. ✅ Add automatic retrain after N labels (transparent to user)
3. ✅ Optional: Show model stats in admin UI

### Phase 4: Optimization (Optional)
1. Add scheduled base model updates
2. Add model performance metrics
3. Add A/B testing for model versions
4. Add model rollback capability

---

## Testing Strategy

### Unit Tests
```python
# tests/test_features.py
def test_extract_geometric_features():
    box = {...}
    layout_config = {...}
    features = extract_geometric_features(box, layout_config)
    assert 'vertical_alignment' in features
    assert 0 <= features['normalized_y'] <= 1

# tests/test_bayesian_model.py
def test_train_gaussian_naive_bayes():
    features = [...]
    labels = ['in', 'in', 'out', ...]
    model = train_gaussian_naive_bayes(features, labels)
    assert 'prior_in' in model
    assert 0 <= model['prior_in'] <= 1
```

### Integration Tests
```python
# tests/test_model_flows.py
@pytest.mark.integration
def test_retrain_video_model_flow():
    result = retrain_video_model_flow(
        video_id="test-video",
        db_path="tests/fixtures/test.db",
        update_predictions=True,
    )
    assert result['status'] == 'complete'
    assert result['training_samples'] > 0
```

---

## Dependencies

### Python Packages Needed
```bash
# Add to pyproject.toml or requirements.txt
numpy>=1.24.0  # For feature calculations
scikit-learn>=1.3.0  # For Gaussian NB (optional, can implement from scratch)
```

### Existing Code to Reference
- Feature extraction: Similar logic may exist in layout analysis code
- Model storage: Follow pattern from `video_layout_config` table
- Batch updates: Reference `crop_frames.py` for efficient DB operations

---

## Current Status Summary

| Component | Status | Blocker |
|-----------|--------|---------|
| Prefect flows | ✅ Framed | Need ML implementation |
| TypeScript integration | ✅ Complete | None |
| Database schema | ✅ Complete | None |
| Base model storage | 🚧 Placeholder | Decision needed |
| Feature extraction | ❌ Not started | New module needed |
| Model training | ❌ Not started | New module needed |
| Prediction logic | ❌ Not started | New module needed |
| Admin UI | ❌ Not started | ML must be working first |
| Layout UI button | ❌ Not started | ML must be working first |

---

## Questions for User

1. **Base Model Storage**: Prefer JSON file, SQLite DB, or YAML config?

2. **Training Data Source**: Should base model aggregate from:
   - All videos (democratic)
   - Curated "gold standard" videos
   - Recent labels only (last N months)

3. **Retrain Trigger**: When should video models auto-retrain?
   - After N labels (10? 20? 50?)
   - Smart: When predictions are frequently wrong
   - Note: Always transparent to user (no manual button)

4. **Model Versioning**: How to handle backward compatibility?
   - Keep old predictions when model updates?
   - Re-predict everything with new model?
   - Allow rollback to previous model?

---

## Notes

- The flow infrastructure is production-ready
- All TODOs are clearly marked in code with file:line references
- Can be tested with mock implementations before real ML
- Schema already supports 100+ feature parameters
- Consider starting with simplified model (fewer features) then expand
