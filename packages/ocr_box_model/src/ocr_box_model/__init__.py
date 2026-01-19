"""OCR bounding box classification with Bayesian learning.

This package provides a 26-feature Gaussian Naive Bayes model for classifying
OCR bounding boxes as caption text ("in") or noise ("out").

Main Functions:
    extract_features: Extract 26 features from a box
    predict_box_label: Predict label using Bayesian model or heuristics
    predict_bayesian: Predict using trained model
    train_model: Train model from user annotations
    initialize_seed_model: Initialize with bootstrap parameters

Types:
    BoxBounds: Box coordinates in top-referenced system
    Prediction: Prediction result with label and confidence
    ModelParams: Gaussian Naive Bayes model parameters
    VideoLayoutConfig: Video layout configuration

Database:
    load_model: Load model from database
    save_model: Save model to database
    run_all_migrations: Run schema migrations
"""

from ocr_box_model.features import (
    extract_features,
    extract_features_batch,
    extract_features_from_layout,
)
from ocr_box_model.predict import (
    get_confident_predictions,
    get_uncertain_predictions,
    predict_batch,
    predict_bayesian,
    predict_box_label,
    predict_from_features,
    predict_with_heuristics,
)
from ocr_box_model.train import (
    get_training_samples,
    initialize_seed_model,
    train_model,
)
from ocr_box_model.types import (
    AdaptiveRecalcResult,
    Annotation,
    BoxBounds,
    BoxWithPrediction,
    CharacterSets,
    ClassSamples,
    FeatureImportanceMetrics,
    GaussianParams,
    LayoutParams,
    ModelParams,
    Prediction,
    VideoLayoutConfig,
)
from ocr_box_model.db import (
    get_box_text_and_timestamp,
    get_video_duration,
    load_all_boxes,
    load_boxes_for_frame,
    load_layout_config,
    load_model,
    run_all_migrations,
    save_model,
)
from ocr_box_model.charset import detect_character_sets
from ocr_box_model.config import FEATURE_NAMES, NUM_FEATURES

try:
    from ocr_box_model._version import __version__, __version_tuple__  # type: ignore[import-not-found]
except ImportError:
    __version__ = "0.0.0+unknown"
    __version_tuple__ = (0, 0, 0, "unknown", "unknown")

__all__ = [
    # Version
    "__version__",
    "__version_tuple__",
    # Feature extraction
    "extract_features",
    "extract_features_batch",
    "extract_features_from_layout",
    # Prediction
    "predict_box_label",
    "predict_bayesian",
    "predict_with_heuristics",
    "predict_from_features",
    "predict_batch",
    "get_confident_predictions",
    "get_uncertain_predictions",
    # Training
    "train_model",
    "initialize_seed_model",
    "get_training_samples",
    # Database
    "load_model",
    "save_model",
    "run_all_migrations",
    "load_layout_config",
    "load_all_boxes",
    "load_boxes_for_frame",
    "get_video_duration",
    "get_box_text_and_timestamp",
    # Character detection
    "detect_character_sets",
    # Types
    "BoxBounds",
    "Prediction",
    "ModelParams",
    "GaussianParams",
    "VideoLayoutConfig",
    "CharacterSets",
    "LayoutParams",
    "FeatureImportanceMetrics",
    "ClassSamples",
    "BoxWithPrediction",
    "Annotation",
    "AdaptiveRecalcResult",
    # Config
    "FEATURE_NAMES",
    "NUM_FEATURES",
]
