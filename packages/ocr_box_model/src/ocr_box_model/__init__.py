"""OCR bounding box classification with Bayesian learning."""

from ocr_box_model.features import extract_box_features, extract_features_batch
from ocr_box_model.predict import predict_with_heuristics

try:
    from ocr_box_model._version import __version__, __version_tuple__
except ImportError:
    __version__ = "0.0.0+unknown"
    __version_tuple__ = (0, 0, 0, "unknown", "unknown")

__all__ = [
    "__version__",
    "__version_tuple__",
    "extract_box_features",
    "extract_features_batch",
    "predict_with_heuristics",
]
