"""Configuration constants for OCR box model.

All constants are global (not per-video) to avoid user configuration complexity.
Values chosen based on statistical principles and classification theory.

Ported from streaming-prediction-config.ts.
"""

from typing import Final

# =============================================================================
# Adaptive Recalculation Configuration
# =============================================================================

# Safety limit: maximum boxes to recalculate per annotation.
MAX_BOXES_PER_UPDATE: Final[int] = 2000

# Minimum change probability to consider recalculating.
# Boxes below this threshold are skipped entirely.
MIN_CHANGE_PROBABILITY: Final[float] = 0.05

# Target reversal rate - stop when rolling average drops below this.
TARGET_REVERSAL_RATE: Final[float] = 0.02

# Window size for calculating rolling reversal rate.
REVERSAL_WINDOW_SIZE: Final[int] = 100

# Minimum boxes processed before checking reversal rate.
MIN_BOXES_BEFORE_CHECK: Final[int] = 50

# Batch size for streaming updates (UI responsiveness).
BATCH_SIZE: Final[int] = 50


# =============================================================================
# Prediction Change Configuration
# =============================================================================

# Weight for uncertainty factor (1 - confidence).
UNCERTAINTY_WEIGHT: Final[float] = 0.4

# Weight for feature similarity factor (Mahalanobis distance).
SIMILARITY_WEIGHT: Final[float] = 0.4

# Weight for decision boundary proximity.
BOUNDARY_SENSITIVITY_WEIGHT: Final[float] = 0.2

# Threshold Mahalanobis distance for "similar" features.
MAX_MAHALANOBIS_DISTANCE: Final[float] = 3.0


# =============================================================================
# Batch Handling Configuration
# =============================================================================

# Maximum batch size for streaming updates.
MAX_STREAMING_UPDATE_BATCH_SIZE: Final[int] = 10

# Threshold for bulk operations that force immediate retrain.
BULK_ANNOTATION_THRESHOLD: Final[int] = 100


# =============================================================================
# Retrain Trigger Configuration
# =============================================================================

# Minimum annotations before first retrain.
MIN_ANNOTATIONS_FOR_RETRAIN: Final[int] = 20

# Standard trigger: retrain after this many new annotations.
ANNOTATION_COUNT_THRESHOLD: Final[int] = 100

# Minimum seconds between retrains.
MIN_RETRAIN_INTERVAL_SECONDS: Final[int] = 20

# High-rate annotation threshold (annotations per minute).
HIGH_ANNOTATION_RATE_PER_MINUTE: Final[int] = 20

# Minimum annotations for high-rate trigger.
HIGH_RATE_MIN_ANNOTATIONS: Final[int] = 30

# Maximum time without retrain (seconds).
MAX_RETRAIN_INTERVAL_SECONDS: Final[int] = 300


# =============================================================================
# Model Configuration
# =============================================================================

# Number of features in the model.
NUM_FEATURES: Final[int] = 26

# Feature names matching TypeScript order.
FEATURE_NAMES: Final[tuple[str, ...]] = (
    # Spatial features (1-7)
    "topAlignment",
    "bottomAlignment",
    "heightSimilarity",
    "horizontalClustering",
    "aspectRatio",
    "normalizedY",
    "normalizedArea",
    # User annotations (8-9)
    "isUserAnnotatedIn",
    "isUserAnnotatedOut",
    # Edge positions (10-13)
    "normalizedLeft",
    "normalizedTop",
    "normalizedRight",
    "normalizedBottom",
    # Character sets (14-24)
    "isRoman",
    "isHanzi",
    "isArabic",
    "isKorean",
    "isHiragana",
    "isKatakana",
    "isCyrillic",
    "isDevanagari",
    "isThai",
    "isDigits",
    "isPunctuation",
    # Temporal features (25-26)
    "timeFromStart",
    "timeFromEnd",
)


# =============================================================================
# Feature Importance Configuration
# =============================================================================

# Minimum samples before calculating feature importance.
MIN_SAMPLES_FOR_IMPORTANCE: Final[int] = 50


# =============================================================================
# Numerical Stability Constants
# =============================================================================

# Minimum standard deviation to avoid division by zero.
MIN_STD: Final[float] = 0.01

# Floor for PDF values before taking log.
PDF_FLOOR: Final[float] = 1e-300

# Small epsilon for numerical comparisons.
EPSILON: Final[float] = 1e-9
