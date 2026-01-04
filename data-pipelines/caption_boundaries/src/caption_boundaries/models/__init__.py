"""Model architectures and registry for caption boundary detection."""

from importlib import import_module
from pathlib import Path

from caption_boundaries.models.architectures.poor.triple_backbone_resnet50 import CaptionBoundaryPredictor, create_model

from caption_boundaries.models.registry import (
    create_model as create_model_from_registry,
)
from caption_boundaries.models.registry import (
    get_model_info,
    list_architectures,
    register_model,
)

# Automatically import all architecture modules to register them
_architectures_dir = Path(__file__).parent / "architectures"
for _model_file in _architectures_dir.glob("*.py"):
    _module_name = _model_file.stem
    # Skip __init__ and any private modules
    if _module_name != "__init__" and not _module_name.startswith("_"):
        import_module(f"caption_boundaries.models.architectures.{_module_name}")

__all__ = [
    "CaptionBoundaryPredictor",
    "create_model",
    "create_model_from_registry",
    "register_model",
    "list_architectures",
    "get_model_info",
]
