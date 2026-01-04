"""Model architectures and registry for caption boundary detection."""

from caption_boundaries.models.architecture import CaptionBoundaryPredictor, create_model
from caption_boundaries.models.registry import (
    create_model as create_model_from_registry,
    get_model_info,
    list_architectures,
    register_model,
)

# Import architecture modules to register them
# Add your custom architectures here
from caption_boundaries.models import example_architecture  # noqa: F401
from caption_boundaries.models import lora_architecture  # noqa: F401

__all__ = [
    "CaptionBoundaryPredictor",
    "create_model",
    "create_model_from_registry",
    "register_model",
    "list_architectures",
    "get_model_info",
]
