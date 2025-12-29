# OCR Box Model

OCR bounding box classification model with Bayesian incremental learning.

## Overview

This package provides functionality to classify OCR character bounding boxes as caption text or non-caption noise, using:

1. **Spatial heuristics** (bootstrap before annotations exist)
2. **Gaussian Naive Bayes** (learns from user annotations)

The model uses 9 features extracted from box spatial properties and user annotations, trained incrementally as the user labels boxes during the annotation workflow.

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

### Key Lessons Learned

1. **User annotations are powerful features**: Directly encoding user labels as features provides the strongest signal for prediction.

2. **Avoid "neutral values" in Bayesian models**: If the model never sees a value during training (like 0.5 for unannotated), it can't predict well with that value. Use binary indicators instead.

3. **Log-space is essential for Naive Bayes**: With many features (9 in our case), multiplying probabilities will underflow. Always use log-space for numerical stability.

4. **Iterative debugging pays off**: Each problem revealed deeper insights:
   - Missing feature → added user annotation
   - Numerical precision → adjusted std values
   - Neutral value problem → redesigned feature encoding
   - Underflow → log-space calculations

5. **Debug with specific examples**: Tracking specific boxes (frame 9500, box 42) through the entire pipeline revealed exactly where calculations failed.

### Model Architecture

**Features (9 total)**:
1. Top alignment score (0-∞, lower = better aligned)
2. Bottom alignment score (0-∞, lower = better aligned)
3. Height similarity score (0-∞, lower = more similar)
4. Horizontal clustering score (0-1, higher = more clustered)
5. Aspect ratio (width/height)
6. Normalized Y position (0-1, vertical position in frame)
7. Normalized area (0-1, box area / frame area)
8. Is user annotated "in" (0.0 or 1.0)
9. Is user annotated "out" (0.0 or 1.0)

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
- 2 parameters per feature per class (mean, std) = 36 columns
- Plus: model version, training timestamp, prior probabilities, sample count

**Performance**:
- Training: ~50ms for 10,000 annotations
- Prediction: ~3.5s for 12,000 boxes (real-time viable)
- Memory: Model parameters fit in single database row
