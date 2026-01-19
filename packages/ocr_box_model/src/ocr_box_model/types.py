"""Type definitions for OCR box model.

Dataclasses and types used throughout the package.
"""

from dataclasses import dataclass, field
from typing import Literal


@dataclass
class BoxBounds:
    """Box bounds in top-referenced coordinate system."""

    left: int
    top: int
    right: int
    bottom: int
    frame_index: int = 0
    box_index: int = 0
    text: str = ""


@dataclass
class GaussianParams:
    """Gaussian distribution parameters for a single feature."""

    mean: float
    std: float


@dataclass
class CharacterSets:
    """Character set detection result.

    Each field is binary (1.0 if detected, 0.0 otherwise).
    Non-exclusive: text can contain multiple character sets.
    """

    is_roman: float = 0.0
    is_hanzi: float = 0.0
    is_arabic: float = 0.0
    is_korean: float = 0.0
    is_hiragana: float = 0.0
    is_katakana: float = 0.0
    is_cyrillic: float = 0.0
    is_devanagari: float = 0.0
    is_thai: float = 0.0
    is_digits: float = 0.0
    is_punctuation: float = 0.0


@dataclass
class Prediction:
    """Prediction result for a single box."""

    label: Literal["in", "out"]
    confidence: float


@dataclass
class FeatureImportanceMetrics:
    """Feature importance metrics using Fisher score."""

    feature_index: int
    feature_name: str
    fisher_score: float
    importance_weight: float
    mean_difference: float


@dataclass
class ModelParams:
    """Parameters for the Gaussian Naive Bayes model."""

    model_version: str
    n_training_samples: int
    prior_in: float
    prior_out: float
    in_features: list[GaussianParams]  # 26 features
    out_features: list[GaussianParams]  # 26 features
    feature_importance: list[FeatureImportanceMetrics] | None = None
    covariance_matrix: list[float] | None = None  # 676 values (26x26 row-major)
    covariance_inverse: list[float] | None = None  # 676 values


@dataclass
class VideoLayoutConfig:
    """Video layout configuration."""

    frame_width: int
    frame_height: int
    crop_left: int = 0
    crop_top: int = 0
    crop_right: int = 0
    crop_bottom: int = 0
    vertical_position: int | None = None
    vertical_std: float | None = None
    box_height: int | None = None
    box_height_std: float | None = None
    anchor_type: Literal["left", "center", "right"] | None = None
    anchor_position: int | None = None


@dataclass
class BoxWithPrediction:
    """Box with current prediction and features."""

    frame_index: int
    box_index: int
    features: list[float]  # 26-feature vector
    current_prediction: Prediction


@dataclass
class Annotation:
    """Annotation event that triggers recalculation."""

    frame_index: int
    box_index: int
    label: Literal["in", "out"]
    features: list[float]  # 26-feature vector


@dataclass
class AdaptiveRecalcResult:
    """Result of adaptive recalculation."""

    total_processed: int
    total_reversals: int
    final_reversal_rate: float
    stopped_early: bool
    reason: Literal["reversal_rate", "max_boxes", "exhausted_candidates"]


@dataclass
class ClassSamples:
    """Sample features for a class, used to compute covariance matrix."""

    n: int
    features: list[list[float]]  # n x 26 matrix


@dataclass
class LayoutParams:
    """Layout parameters from OCR analysis."""

    vertical_position: int
    vertical_std: float
    box_height: int
    box_height_std: float
    anchor_type: Literal["left", "center", "right"]
    anchor_position: int
    top_edge_std: float = 0.0
    bottom_edge_std: float = 0.0


# Seed model parameters based on typical caption characteristics
# "in" (caption) boxes: well-aligned, similar, clustered, wide, bottom of frame
SEED_IN_PARAMS: list[GaussianParams] = [
    # Spatial features (1-7)
    GaussianParams(mean=0.5, std=0.5),  # topAlignment
    GaussianParams(mean=0.5, std=0.5),  # bottomAlignment
    GaussianParams(mean=0.5, std=0.5),  # heightSimilarity
    GaussianParams(mean=0.5, std=0.5),  # horizontalClustering
    GaussianParams(mean=4.0, std=2.0),  # aspectRatio
    GaussianParams(mean=0.8, std=0.1),  # normalizedY
    GaussianParams(mean=0.02, std=0.015),  # normalizedArea
    # User annotations (8-9)
    GaussianParams(mean=0.5, std=0.5),  # isUserAnnotatedIn
    GaussianParams(mean=0.5, std=0.5),  # isUserAnnotatedOut
    # Edge positions (10-13)
    GaussianParams(mean=0.35, std=0.15),  # normalizedLeft
    GaussianParams(mean=0.75, std=0.1),  # normalizedTop
    GaussianParams(mean=0.65, std=0.15),  # normalizedRight
    GaussianParams(mean=0.85, std=0.1),  # normalizedBottom
    # Character sets (14-24)
    GaussianParams(mean=0.5, std=0.5),  # isRoman
    GaussianParams(mean=0.5, std=0.5),  # isHanzi
    GaussianParams(mean=0.5, std=0.5),  # isArabic
    GaussianParams(mean=0.5, std=0.5),  # isKorean
    GaussianParams(mean=0.5, std=0.5),  # isHiragana
    GaussianParams(mean=0.5, std=0.5),  # isKatakana
    GaussianParams(mean=0.5, std=0.5),  # isCyrillic
    GaussianParams(mean=0.5, std=0.5),  # isDevanagari
    GaussianParams(mean=0.5, std=0.5),  # isThai
    GaussianParams(mean=0.5, std=0.5),  # isDigits
    GaussianParams(mean=0.5, std=0.5),  # isPunctuation
    # Temporal features (25-26)
    GaussianParams(mean=300.0, std=200.0),  # timeFromStart
    GaussianParams(mean=300.0, std=200.0),  # timeFromEnd
]

# "out" (noise) boxes: less aligned, varied, scattered
SEED_OUT_PARAMS: list[GaussianParams] = [
    # Spatial features (1-7)
    GaussianParams(mean=1.5, std=1.0),  # topAlignment
    GaussianParams(mean=1.5, std=1.0),  # bottomAlignment
    GaussianParams(mean=1.5, std=1.0),  # heightSimilarity
    GaussianParams(mean=1.5, std=1.0),  # horizontalClustering
    GaussianParams(mean=2.0, std=3.0),  # aspectRatio
    GaussianParams(mean=0.5, std=0.3),  # normalizedY
    GaussianParams(mean=0.03, std=0.03),  # normalizedArea
    # User annotations (8-9)
    GaussianParams(mean=0.5, std=0.5),  # isUserAnnotatedIn
    GaussianParams(mean=0.5, std=0.5),  # isUserAnnotatedOut
    # Edge positions (10-13)
    GaussianParams(mean=0.5, std=0.3),  # normalizedLeft
    GaussianParams(mean=0.5, std=0.3),  # normalizedTop
    GaussianParams(mean=0.5, std=0.3),  # normalizedRight
    GaussianParams(mean=0.5, std=0.3),  # normalizedBottom
    # Character sets (14-24)
    GaussianParams(mean=0.5, std=0.5),  # isRoman
    GaussianParams(mean=0.5, std=0.5),  # isHanzi
    GaussianParams(mean=0.5, std=0.5),  # isArabic
    GaussianParams(mean=0.5, std=0.5),  # isKorean
    GaussianParams(mean=0.5, std=0.5),  # isHiragana
    GaussianParams(mean=0.5, std=0.5),  # isKatakana
    GaussianParams(mean=0.5, std=0.5),  # isCyrillic
    GaussianParams(mean=0.5, std=0.5),  # isDevanagari
    GaussianParams(mean=0.5, std=0.5),  # isThai
    GaussianParams(mean=0.5, std=0.5),  # isDigits
    GaussianParams(mean=0.5, std=0.5),  # isPunctuation
    # Temporal features (25-26)
    GaussianParams(mean=300.0, std=250.0),  # timeFromStart
    GaussianParams(mean=300.0, std=250.0),  # timeFromEnd
]
