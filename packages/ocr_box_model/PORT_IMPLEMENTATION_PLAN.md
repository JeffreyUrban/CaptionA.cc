# Plan: Port TypeScript Bayesian Box Classification to Python Package

## Objective
Port the TypeScript Bayesian box classification system to the `packages/ocr_box_model/` Python package, ensuring alignment with the 26-feature model, Gaussian Naive Bayes training/inference, and streaming prediction updates.

## Current State
- **packages/ocr_box_model/**: Outdated (only 13 features, no ML model, tests disabled)
- **services/api/app/services/layout_analysis.py**: Has 26-feature extraction, character set detection, KNN functions - needs to move to package
- **TypeScript**: Complete implementation in box-prediction.ts, feature-importance.ts, streaming-prediction-updates.ts, streaming-prediction-config.ts

## Package Structure

```
packages/ocr_box_model/src/ocr_box_model/
├── __init__.py           # Public API
├── config.py             # Configuration constants
├── types.py              # Dataclasses (BoxBounds, ModelParams, etc.)
├── charset.py            # Character set detection (11 Unicode range functions)
├── knn.py                # K-nearest neighbors alignment functions
├── math_utils.py         # Numerical utilities (log-sum-exp, gaussian_pdf)
├── features.py           # 26-feature extraction
├── predict.py            # Bayesian prediction + heuristics fallback
├── train.py              # Model training from annotations
├── feature_importance.py # Fisher scores, covariance, Mahalanobis
├── streaming.py          # Streaming prediction updates
└── db.py                 # Database operations, schema migrations
```

## Implementation Steps

### Step 1: Foundation Modules
**Files:** `config.py`, `types.py`, `math_utils.py`

- Port configuration constants from `streaming-prediction-config.ts`
- Define dataclasses: `BoxBounds`, `ModelParams`, `GaussianParams`, `Prediction`, `VideoLayout`, `CharacterSets`, `BoxWithPrediction`, `AdaptiveRecalcResult`
- Implement numerical utilities: `gaussian_pdf()`, `log_gaussian_pdf()`, `log_sum_exp()`, `log_probs_to_probs()`

### Step 2: Character Set & KNN
**Files:** `charset.py`, `knn.py`

- Port character set detection from `layout_analysis.py` (already implemented, just move)
- Port KNN functions from `layout_analysis.py`

### Step 3: Feature Extraction
**File:** `features.py`

- Port 26-feature extraction from `layout_analysis.py`
- Add `extract_features_batch()` for efficient batch processing
- Port `query_user_annotation()` for user annotation lookup

### Step 4: Database Layer
**File:** `db.py`

- Implement `load_model()`, `save_model()` from `box-prediction.ts:loadModelFromDB`
- Port schema migrations: `migrate_model_schema()`, `migrate_streaming_prediction_schema()`, `migrate_video_preferences_schema()`, `migrate_full_frame_ocr_schema()`
- Implement `load_layout()`, `get_video_duration()`
- Handle coordinate system conversion (bottom-ref DB to top-ref internal)

### Step 5: Prediction
**File:** `predict.py`

- Implement `predict_bayesian()` with log-space arithmetic from `box-prediction.ts:predictBayesian`
- Port `predict_with_heuristics()` from existing `predict.py`
- Implement `predict_box_label()` dispatcher
- Add `predict_batch()` for efficient batch predictions

### Step 6: Training
**File:** `train.py`

- Implement `train_model()` from `box-prediction.ts:trainModel`
- Port `initialize_seed_model()` with hardcoded bootstrap parameters
- Implement `fetch_user_annotations()`, `extract_training_features()`
- Calculate Gaussian params: `calculate_gaussian_params()`

### Step 7: Feature Importance & Covariance
**File:** `feature_importance.py`

- Port `calculate_feature_importance()` (Fisher scores) from `feature-importance.ts`
- Implement `compute_pooled_covariance()`, `invert_covariance_matrix()`
- Port Cholesky decomposition for matrix inversion
- Implement `compute_mahalanobis_distance()`

### Step 8: Streaming Updates
**File:** `streaming.py`

- Port `estimate_prediction_change_prob()` from `streaming-prediction-updates.ts`
- Implement `identify_affected_boxes()`, `adaptive_recalculation()`
- Use numpy for efficient batch operations

### Step 9: Public API & Tests
**Files:** `__init__.py`, `tests/`

- Export main functions: `extract_features`, `predict_box_label`, `train_model`, `initialize_seed_model`
- Write comprehensive tests for each module
- Re-enable and update existing tests

### Step 10: Cleanup
- Remove or update `services/api/app/services/layout_analysis.py` to import from package
- Update `pyproject.toml` with numpy dependency

## Critical Files to Modify/Create

| File | Action |
|------|--------|
| `packages/ocr_box_model/src/ocr_box_model/config.py` | Create |
| `packages/ocr_box_model/src/ocr_box_model/types.py` | Create |
| `packages/ocr_box_model/src/ocr_box_model/math_utils.py` | Create |
| `packages/ocr_box_model/src/ocr_box_model/charset.py` | Create (move from layout_analysis.py) |
| `packages/ocr_box_model/src/ocr_box_model/knn.py` | Create (move from layout_analysis.py) |
| `packages/ocr_box_model/src/ocr_box_model/features.py` | Replace entirely |
| `packages/ocr_box_model/src/ocr_box_model/predict.py` | Replace entirely |
| `packages/ocr_box_model/src/ocr_box_model/train.py` | Create |
| `packages/ocr_box_model/src/ocr_box_model/feature_importance.py` | Create |
| `packages/ocr_box_model/src/ocr_box_model/streaming.py` | Create |
| `packages/ocr_box_model/src/ocr_box_model/db.py` | Create |
| `packages/ocr_box_model/src/ocr_box_model/__init__.py` | Replace |
| `packages/ocr_box_model/pyproject.toml` | Update dependencies |
| `services/api/app/services/layout_analysis.py` | Remove (functionality moved to package) |

## Key Implementation Details

### Numerical Stability (from TypeScript)
- Use log-space for Naive Bayes likelihood products to prevent underflow
- Log-sum-exp trick for posterior normalization
- Minimum std of 0.01 to avoid division by zero
- Floor PDFs at 1e-300 before taking log

### Database Schema Compatibility
- Must use same column names as TypeScript for cross-compatibility
- Handle read-only databases gracefully (skip migrations)
- Accept seed model (n_samples=0) or trained models (n_samples>=10)

### Coordinate System
- Database: bottom-referenced (y=0 at bottom)
- Internal: top-referenced (y=0 at top)
- Conversion: `top_in_top_ref = frame_height - top_in_bottom_ref`

## Verification

1. **Unit tests**: Run `uv run pytest packages/ocr_box_model/tests/`
2. **Feature extraction**: Compare output with TypeScript for same inputs
3. **Prediction accuracy**: Test with known annotated data
4. **Training**: Verify model parameters match TypeScript training output
5. **Integration**: Ensure API service can import and use package functions
