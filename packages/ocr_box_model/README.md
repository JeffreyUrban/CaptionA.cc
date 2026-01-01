# OCR Box Model

OCR bounding box classification model with Bayesian incremental learning.

## Overview

This package provides functionality to classify OCR character bounding boxes as caption text or non-caption noise, using:

1. **Spatial heuristics** (bootstrap before annotations exist)
2. **Gaussian Naive Bayes** (learns from user annotations)

The model uses 26 features extracted from box spatial properties, character sets, temporal context, and user annotations, trained incrementally as the user labels boxes during the annotation workflow.

## Features

- Feature extraction from box spatial properties
- Spatial heuristics using SubtitleRegion analysis as Bayesian priors
- Incremental model training from user annotations
- Confidence scoring for predictions
- Support for absolute pixel coordinates

## Usage

### Feature Extraction

```python
from ocr_box_model.features import extract_box_features
from caption_models import BoundingBox, CropBounds

# Box and layout configuration
box = BoundingBox(left=960, top=918, right=998, bottom=972)
crop_bounds = CropBounds(left=0, top=723, right=1920, bottom=1080)

# Layout parameters from SubtitleRegion analysis
layout_params = {
    'vertical_position': 945,  # Mode vertical center
    'vertical_std': 12.0,
    'box_height': 54,  # Mode box height
    'box_height_std': 5.0,
    'anchor_type': 'left',
    'anchor_position': 960,
}

# Extract features
features = extract_box_features(
    box=box,
    frame_width=1920,
    frame_height=1080,
    crop_bounds=crop_bounds,
    layout_params=layout_params,
)
```

### Spatial Heuristics Prediction

```python
from ocr_box_model.predict import predict_with_heuristics

# Predict box labels before any annotations exist
predictions = predict_with_heuristics(
    boxes=[box1, box2, box3],
    frame_width=1920,
    frame_height=1080,
    crop_bounds=crop_bounds,
    layout_params=layout_params,
)

# predictions = [
#     {'label': 'in', 'confidence': 0.85},
#     {'label': 'out', 'confidence': 0.92},
#     {'label': 'in', 'confidence': 0.45},  # Uncertain
# ]
```

## Development

Install development dependencies:

```bash
cd packages/ocr_box_model
uv pip install -e ".[dev]"
```

Run tests:

```bash
uv run pytest
```

## Package Structure

```
ocr_box_model/
├── src/ocr_box_model/
│   ├── __init__.py       # Public API
│   ├── features.py       # Feature extraction
│   └── predict.py        # Heuristics and model prediction
└── tests/
    ├── test_features.py  # Feature extraction tests
    └── test_predict.py   # Prediction tests
```

## Design Journey: Building a Robust Bayesian Classifier

This section documents the iterative development of the Bayesian box classification model, capturing problems encountered, solutions implemented, and lessons learned.

### The Core Challenge

Classify OCR bounding boxes as caption text ("in") or non-caption noise ("out") with high accuracy, using a model that learns incrementally from user annotations during the annotation workflow.

### Evolution of the Model

#### Initial Approach: Spatial Features Only (7 features)

The first version used 7 spatial features:
1. Top alignment score (how aligned with other boxes' top edges)
2. Bottom alignment score
3. Height similarity score
4. Horizontal clustering score (how close to neighboring boxes)
5. Aspect ratio
6. Normalized Y position (vertical position in frame)
7. Normalized area (box size relative to frame)

**Problem discovered**: Crop bounds extended far past actual captions despite high confidence predictions.

**Root cause**: User annotations were only used for training the model parameters (means/stds), but NOT as input features during prediction. This meant the model couldn't directly incorporate the strong signal of "user already labeled this box as out".

**Example**: Box at x=1219 was annotated as "out" by user, but predicted as "in" with 0.957 confidence because the model didn't know about the annotation.

#### Iteration 1: Adding User Annotation Feature (8 features)

**Solution**: Added user annotation as 8th feature:
- Feature value: 0.0 = "out", 0.5 = unannotated, 1.0 = "in"

**Results**:
- ✅ Annotated boxes: 99.9% agreement with user labels
- ❌ Unannotated boxes: 100% predicted as "in" (incorrect!)

**New problem discovered**: The "neutral value" problem.

**Root cause**:
- Training data only contains 0.0 or 1.0 (all boxes are annotated)
- Model never sees 0.5 during training
- When predicting with 0.5, both P(0.5|"in") and P(0.5|"out") are nearly zero
- Gaussian PDF: feature is 50 standard deviations from both means!

**Attempted fix**: Use larger std (0.3) for feature 7 to allow neutral values.

**Results**: Improved but still problematic - 85.7% of unannotated boxes predicted as "in".

#### Iteration 2: Binary Indicator Features (9 features)

**Insight**: Instead of one feature with three values (out/neutral/in), use TWO binary features.

**Solution**: Split into features 7 and 8:
- Feature 7: `isUserAnnotatedIn` (1.0 if user annotated "in", 0.0 otherwise)
- Feature 8: `isUserAnnotatedOut` (1.0 if user annotated "out", 0.0 otherwise)

**Key benefit**: Unannotated boxes are (0.0, 0.0), which the model DOES see during training:
- "in" boxes have (1.0, 0.0) → model learns that isUserAnnotatedOut=0.0 is normal for "in" class
- "out" boxes have (0.0, 1.0) → model learns that isUserAnnotatedIn=0.0 is normal for "out" class
- Unannotated (0.0, 0.0) → model can interpolate from training data

**Results**:
- ✅ Annotated boxes: Perfect agreement with user labels (1.0 confidence)
- ❌ Predictions still failing: Both likelihoods underflowing to zero!

**New problem discovered**: Numerical underflow in probability calculations.

#### Iteration 3: Log-Space Probability Calculations (Final Solution)

**Problem**: Naive Bayes multiplies probabilities for each feature:
```
P(features|class) = P(f1|class) × P(f2|class) × ... × P(f9|class)
```

With 9 features, even one extreme value causes catastrophic underflow:
- Example: topAlignment=177 vs mean=0.5 → Gaussian PDF ≈ 0
- Product becomes 0 for both "in" and "out" classes
- Total = 0, degenerate case returns (label="in", confidence=0.5)

**Debug trace** (frame 9500, box 42):
```
feature[0]=177.46, pdfIn=0, pdfOut=0
feature[7]=0, pdfIn=0, pdfOut=39.89
feature[8]=1, pdfIn=0, pdfOut=39.89
→ likelihoodIn=0, likelihoodOut=0 → total=0 → DEGENERATE
```

**Solution**: Use log-space probability calculations:

```typescript
// Instead of multiplying probabilities (prone to underflow):
likelihood = pdf1 * pdf2 * pdf3 * ... * pdf9

// Use log-space (sum of logs, numerically stable):
logLikelihood = log(pdf1) + log(pdf2) + ... + log(pdf9)
```

**Benefits**:
1. Product → Sum (numerically stable)
2. Can represent very small probabilities (log(1e-100) = -230, no underflow)
3. Convert back to probability space only at the end using log-sum-exp trick

**Log-sum-exp trick** prevents overflow when converting back:
```typescript
max = max(logPosteriorIn, logPosteriorOut)
posteriorIn = exp(logPosteriorIn - max)
posteriorOut = exp(logPosteriorOut - max)
total = posteriorIn + posteriorOut
```

This ensures the largest exponent is always 0, preventing overflow.

**Final Results**:
- ✅ Annotated boxes: Perfect agreement (1.0 confidence)
- ✅ Unannotated boxes: Realistic distribution (85.7% "in", 14.3% "out")
- ✅ Rightmost "in" box: Improved from x=1219 to x=942 (within caption region)
- ✅ Numerical stability: No degenerate cases

#### Iteration 4: Feature Expansion to 26 Features (2024-12)

**Problem discovered**: Crop bounds still extending past actual captions in some videos (e.g., feichengwurao/20220122: rightmost predicted "in" at x=980 vs user annotations at x=607).

**Root cause**: Model lacked direct horizontal position information. The horizontal clustering score captured relative positioning but not absolute position, making it unable to learn "boxes far to the right are noise".

**Solution**: Expanded from 9 to 26 features with three new feature categories:

1. **Edge Position Features (4 new features)**:
   - Normalized left, top, right, bottom edges (all in [0-1] range)
   - **Design choice**: Edge-based rather than center-based for robustness to aspect ratio differences and better support for word boxes in non-character-based languages
   - Helps model learn absolute horizontal and vertical position constraints

2. **Character Set Features (11 new features)**:
   - Binary, non-exclusive detection of scripts: Roman, Hanzi, Arabic, Korean, Hiragana, Katakana, Cyrillic, Devanagari, Thai, digits, punctuation
   - Uses Unicode character code ranges for detection
   - **Design choice**: Non-exclusive (multi-label) because boxes can contain mixed scripts
   - **Design choice**: Binary (not proportional) for simpler model and faster detection
   - Helps distinguish caption text from UI elements, logos, and other on-screen text

3. **Temporal Features (2 new features)**:
   - Time from video start (seconds, absolute)
   - Time from video end (seconds, absolute)
   - **Design choice**: Absolute time rather than normalized to avoid assumptions about video duration distribution
   - Helps distinguish opening titles, main content, and closing credits
   - Requires `video_metadata.duration_seconds` and per-frame `timestamp_seconds`

**Implementation details**:
- Database schema migration: Added 68 new columns (17 new features × 2 params × 2 classes)
- Backward compatibility: Schema auto-migrates when model loads
- Temporal metadata: Backfill script populates duration and timestamps for existing videos
- Frame sampling: Currently fixed 10Hz indexing (native framerate support deferred)

**Results**: Ready for testing. Model now has:
- Direct horizontal position signal (edge features)
- Script/language awareness (character set features)
- Temporal context (time features)
- All with log-space numerical stability from Iteration 3

### Key Lessons Learned

1. **User annotations are powerful features**: Directly encoding user labels as features provides the strongest signal for prediction.

2. **Avoid "neutral values" in Bayesian models**: If the model never sees a value during training (like 0.5 for unannotated), it can't predict well with that value. Use binary indicators instead.

3. **Log-space is essential for Naive Bayes**: With many features (26 in our case), multiplying probabilities will underflow. Always use log-space for numerical stability.

4. **Iterative debugging pays off**: Each problem revealed deeper insights:
   - Missing feature → added user annotation
   - Numerical precision → adjusted std values
   - Neutral value problem → redesigned feature encoding
   - Underflow → log-space calculations

5. **Debug with specific examples**: Tracking specific boxes (frame 9500, box 42) through the entire pipeline revealed exactly where calculations failed.

6. **Direct features beat derived features**: Adding explicit horizontal position (edge features) was more effective than relying on the model to infer position from clustering scores. When you know what the model needs to learn, encode it directly.

7. **Feature expansion requires careful design**:
   - Edge positions vs center positions: Consider which is more robust to variations
   - Binary vs proportional: Simpler features can be more effective and faster to compute
   - Absolute vs normalized: Choose based on expected data distribution and model assumptions
   - Non-exclusive multi-label: Character sets needed multi-label because boxes can contain mixed scripts

8. **Temporal context matters**: Caption appearance patterns differ across video timeline (opening titles, main content, closing credits). Adding temporal features allows the model to learn these patterns.

### Model Architecture

**Features (26 total)**:

*Spatial Features (1-7):*
1. Top alignment score (0-∞, lower = better aligned)
2. Bottom alignment score (0-∞, lower = better aligned)
3. Height similarity score (0-∞, lower = more similar)
4. Horizontal clustering score (0-1, higher = more clustered)
5. Aspect ratio (width/height)
6. Normalized Y position (0-1, vertical position in frame)
7. Normalized area (0-1, box area / frame area)

*User Annotation Features (8-9):*
8. Is user annotated "in" (0.0 or 1.0)
9. Is user annotated "out" (0.0 or 1.0)

*Edge Position Features (10-13):*
10. Normalized left edge (0-1, horizontal position from left)
11. Normalized top edge (0-1, vertical position from top)
12. Normalized right edge (0-1, horizontal position from left)
13. Normalized bottom edge (0-1, vertical position from top)

*Character Set Features (14-24) - binary, non-exclusive:*
14. Is Roman/Latin script (0.0 or 1.0)
15. Is Hanzi (Chinese characters) (0.0 or 1.0)
16. Is Arabic script (0.0 or 1.0)
17. Is Korean (Hangul) (0.0 or 1.0)
18. Is Hiragana (Japanese) (0.0 or 1.0)
19. Is Katakana (Japanese) (0.0 or 1.0)
20. Is Cyrillic script (0.0 or 1.0)
21. Is Devanagari script (0.0 or 1.0)
22. Is Thai script (0.0 or 1.0)
23. Is digits (0.0 or 1.0)
24. Is punctuation (0.0 or 1.0)

*Temporal Features (25-26):*
25. Time from start (seconds, absolute time from video start)
26. Time from end (seconds, absolute time before video end)

**Model**: Gaussian Naive Bayes
- Each feature modeled as Gaussian distribution for each class
- Parameters: mean and std for each feature × class
- Priors: learned from training data (proportion of "in" vs "out")

**Prediction**: Log-space Bayesian inference
```
log P(class|features) = log P(features|class) + log P(class)
                      = Σ log P(fi|class) + log P(class)
```

**Training**: Incremental updates
- Automatic retraining triggered every 20 new annotations
- Recalculates means, stds, and priors from all user annotations
- Predictions updated for all boxes after retraining

### Implementation Notes

**Numerical stability safeguards**:
- Minimum std = 0.01 (prevents division by zero, allows reasonable uncertainty)
- Log-space calculations (prevents underflow from multiplying small probabilities)
- Log-sum-exp trick (prevents overflow when converting back to probabilities)
- Floor small PDFs at 1e-300 before taking log (avoids log(0) = -∞)

**Database schema**:
- Model stored in `box_classification_model` table
- 2 parameters per feature per class (mean, std) = 104 columns (26 features × 2 params × 2 classes)
- Plus: model version, training timestamp, prior probabilities, sample count
- Feature importance metrics (26 Fisher scores + normalized weights)
- Pooled covariance matrix (26×26 = 676 values) for Mahalanobis distance
- Covariance inverse (pre-computed, 676 values) for efficient similarity computation

**Performance**:
- Training: ~50ms for 10,000 annotations
- Prediction: ~3.5s for 12,000 boxes (real-time viable)
- Memory: Model parameters fit in single database row

## Streaming Prediction Updates (2025-12)

### The Performance Challenge

**Problem:** Full recalculation of all predictions causes 3.5s blocking delay every 20 annotations, disrupting the annotation workflow.

**User impact:** Annotation → wait → annotation → wait creates a frustrating cycle that slows down the user's work.

### Design: Intelligent Streaming Updates

**Core insight:** When a user annotates box A, only boxes with similar features need recalculation. Most boxes are unaffected by any single annotation.

**Solution:** Replace batch recalculation with continuous streaming updates:
1. **Feature similarity detection** - Use Mahalanobis distance to identify affected boxes
2. **Probabilistic scope** - Model the likelihood that each box's prediction will change
3. **Adaptive processing** - Recalculate in order of change probability, stop when reversal rate drops
4. **Background streaming** - Non-blocking updates, UI remains responsive

### Feature Importance Tracking

**Purpose:** Identify which features matter most for this video's caption detection.

**Method:** Fisher score (variance ratio between classes)
```
Fisher_i = (μ_in,i - μ_out,i)² / (σ²_in,i + σ²_out,i)
```

High Fisher score = feature strongly discriminates "in" vs "out" boxes.

**Uses:**
1. **Weighted similarity** - Important features count more in Mahalanobis distance
2. **Debugging insights** - Shows which features the model relies on
3. **Future optimization** - Could reduce features to most important subset

**Storage:** Calculated during training, stored as JSON array in model row.

### Mahalanobis Distance for Similarity

**Why not Euclidean distance?**

Features have wildly different scales:
- `aspect_ratio`: 1-5
- `normalized_y`: 0-1
- `time_from_start`: 0-3600 seconds

Euclidean distance would be dominated by large-scale features.

**Mahalanobis distance solution:**
```
D_M(x, y) = sqrt((x - y)ᵀ × Σ⁻¹ × (x - y))
```

where Σ = pooled covariance matrix (single 26×26 matrix across both classes).

**Benefits:**
1. **Scale-invariant** - Normalizes by feature variance
2. **Correlation-aware** - Accounts for correlated features (e.g., top/bottom edges)
3. **Automatic weighting** - High-variance features naturally weighted less
4. **Statistically sound** - Standard approach in LDA and discriminant analysis

**Implementation choice: Pooled covariance**
- Combines both "in" and "out" samples: `Σ = (n_in × Σ_in + n_out × Σ_out) / (n_in + n_out)`
- More sample-efficient than per-class covariance
- Simpler: one covariance structure instead of two
- Used only for similarity detection, not classification (Naive Bayes remains diagonal)

### Prediction Change Probability

**Instead of fixed thresholds,** model the actual probability that a box's prediction will flip:

```typescript
P(prediction changes) = f(uncertainty, similarity, boundary_proximity)
```

**Three factors:**

1. **Uncertainty** (1 - confidence)
   - Low confidence predictions more likely to flip
   - Weight: 0.4

2. **Feature similarity** (Mahalanobis distance)
   - Similar boxes affected by annotation
   - Exponential decay: `exp(-distance²/2σ²)`
   - Weight: 0.4

3. **Decision boundary proximity** (|confidence - 0.5|)
   - Boxes near 50% confidence on decision boundary
   - Weight: 0.2

**Why these weights?**
- Uncertainty and similarity are primary signals (equal importance)
- Boundary proximity is secondary (refinement signal)
- Chosen based on classification theory, not arbitrary
- Could be learned from data in future iteration

### Adaptive Recalculation Strategy

**Key innovation:** Stop recalculating when reversal rate drops below threshold.

**Algorithm:**
1. Compute change probability for all boxes
2. Sort by probability (highest first)
3. Process in batches of 50
4. Track rolling reversal rate (window size: 100)
5. Stop when reversal rate < 2% (configurable)

**Why this works:**
- High-probability boxes processed first (most likely to change)
- As we move down the list, fewer predictions actually flip
- When reversal rate drops, remaining boxes unlikely to change
- Adaptive: stops early on small changes, continues on large model updates

**Configuration (global constants):**
```typescript
const ADAPTIVE_RECALC_CONFIG = {
  MAX_BOXES_PER_UPDATE: 2000,        // Safety limit
  MIN_CHANGE_PROBABILITY: 0.05,      // Skip boxes below 5% chance
  TARGET_REVERSAL_RATE: 0.02,        // Stop at 2% reversal rate
  REVERSAL_WINDOW_SIZE: 100,         // Rolling window
  MIN_BOXES_BEFORE_CHECK: 50,        // Need data for statistics
  BATCH_SIZE: 50,                    // UI responsiveness
}
```

**No magic numbers:** All thresholds extracted to clear, documented constants with statistical justification.

### Smart Retrain Triggers

**Problem with old approach:** Fixed "every 20 annotations" ignores annotation rate and time.

**New approach:** Trigger on count AND time AND rate.

**Rules:**
1. **Minimum threshold:** 20 annotations before first train
2. **Standard trigger:** 100 new annotations AND 20+ seconds since last train
3. **High-rate trigger:** 20+ annotations/minute with 30+ new annotations
4. **Time-based trigger:** 5 minutes elapsed with any new annotations

**Why multiple triggers?**
- **Prevent thrashing:** 20-second minimum prevents retrain per individual annotation
- **Adapt to user pace:** Fast annotators (bulk tools: 2000 boxes/min) get frequent updates
- **Ensure freshness:** 5-minute max keeps model fresh during active sessions
- **Sample size:** Always require minimum annotations for statistical validity

**Configuration (global constants):**
```typescript
const RETRAIN_TRIGGER_CONFIG = {
  MIN_ANNOTATIONS_FOR_RETRAIN: 20,
  ANNOTATION_COUNT_THRESHOLD: 100,
  MIN_RETRAIN_INTERVAL_SECONDS: 20,      // 20 seconds
  HIGH_ANNOTATION_RATE_PER_MINUTE: 20,
  HIGH_RATE_MIN_ANNOTATIONS: 30,
  MAX_RETRAIN_INTERVAL_SECONDS: 300,     // 5 minutes
}
```

### Architecture: From Batch to Stream

**Old (batch):**
```
Every 20 annotations:
  Train model (50ms)
  Recalculate ALL boxes (3.5s - BLOCKING)
  Update database
```

**New (streaming):**
```
After EVERY annotation:
  1. Immediate: Update annotated box UI
  2. Background: Compute feature similarity
  3. Background: Identify affected boxes (Mahalanobis distance)
  4. Background: Stream updates in priority order
  5. Background: Stop when reversal rate < 2%

When retrain triggered (smart conditions):
  6. Background: Full retrain
  7. Background: Recalculate remaining low-probability boxes
```

**Benefits:**
- ✅ No blocking delays (all background)
- ✅ Immediate feedback on annotated boxes
- ✅ Progressive improvements (streaming)
- ✅ Adaptive scope (similarity-based)
- ✅ Early stopping (reversal rate)
- ✅ Smarter retraining (count + time + rate)

### Design Rationale: Why This Approach?

**Question: Is this the right solution vs a workaround?**

Answer: This is the principled ML solution:
1. **Mahalanobis distance** - Standard metric for multivariate similarity (LDA, anomaly detection)
2. **Fisher score** - Classical feature importance metric (variance ratio)
3. **Probabilistic scope** - Model-based, not arbitrary thresholds
4. **Adaptive stopping** - Data-driven (reversal rate), not fixed limits
5. **Pooled covariance** - Standard statistical approach for efficiency

**Question: If building from scratch, would we design it this way?**

Answer: Yes, with these components:
1. **Smart scope detection** - Only recalculate affected boxes (not all 12,000)
2. **Priority ordering** - Process high-probability changes first
3. **Early stopping** - Stop when marginal benefit drops
4. **Non-blocking** - Background processing, responsive UI
5. **Adaptive triggers** - Retrain based on data, not fixed intervals

**Question: Could we simplify the model instead?**

Answer: Not yet - we want more annotation data first:
- Current 26 features chosen based on domain knowledge
- Need data to identify which features are actually important
- Feature importance tracking enables future simplification
- Better to optimize workflow now, simplify model later with evidence

### Implementation Status

**Completed:**
- 26-feature Gaussian Naive Bayes with log-space calculations
- Feature extraction (spatial, character sets, temporal, annotations)
- Incremental training with schema migration
- Database storage of model parameters

**In Progress (2025-12-31):**
- Feature importance calculation (Fisher scores)
- Pooled covariance matrix computation
- Mahalanobis distance similarity detection
- Prediction change probability estimation
- Adaptive recalculation with reversal rate
- Smart retrain triggers (count + time + rate)
- Streaming update architecture

**Future Enhancements:**
- Feature reduction based on importance analysis
- Learned weights for change probability factors
- Per-video tuning of reversal rate threshold (if needed)
- Parallel processing for very large videos (>50k boxes)
