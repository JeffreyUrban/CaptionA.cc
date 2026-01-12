"""Model registry for caption frame extents detection architectures.

Provides a centralized registry for different model architectures, enabling
easy experimentation with different designs while maintaining reproducibility.

Architecture definitions live in Python code, not config files. The registry
tracks what was used for each experiment.
"""

from collections.abc import Callable
from typing import Any

import torch
import torch.nn as nn

# Type alias for model factory functions
ModelFactory = Callable[..., nn.Module]

# Global registry mapping architecture names to factory functions
_MODEL_REGISTRY: dict[str, ModelFactory] = {}


def register_model(name: str) -> Callable:
    """Decorator to register a model architecture.

    Usage:
        @register_model("triple_backbone_resnet50")
        def create_triple_backbone(**kwargs):
            return TripleBackboneModel(**kwargs)

    Args:
        name: Unique identifier for this architecture

    Returns:
        Decorator function that registers the model factory
    """

    def decorator(factory_fn: ModelFactory) -> ModelFactory:
        if name in _MODEL_REGISTRY:
            raise ValueError(f"Model '{name}' already registered")
        _MODEL_REGISTRY[name] = factory_fn
        return factory_fn

    return decorator


def create_model(
    architecture: str,
    device: str | None = None,
    **kwargs: Any,
) -> nn.Module:
    """Create a model from the registry.

    Args:
        architecture: Name of registered architecture
        device: Device to place model on ('cuda', 'mps', 'cpu', or None for auto)
        **kwargs: Architecture-specific arguments passed to factory function

    Returns:
        Initialized model on specified device

    Raises:
        ValueError: If architecture is not registered

    Example:
        >>> model = create_model("triple_backbone_resnet50", device="cuda", pretrained=True)
        >>> model = create_model("shared_backbone_efficientnet", device="mps", dropout=0.5)
    """
    if architecture not in _MODEL_REGISTRY:
        available = ", ".join(_MODEL_REGISTRY.keys())
        raise ValueError(
            f"Unknown architecture: '{architecture}'. Available: {available if available else 'none registered'}"
        )

    # Auto-detect device if not specified
    if device is None:
        if torch.cuda.is_available():
            device = "cuda"
        elif torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"

    # Create model using factory function
    factory = _MODEL_REGISTRY[architecture]
    model = factory(**kwargs)

    # Validate model meets task requirements
    validate_model(model)

    # Move to device
    model = model.to(device)

    return model


def validate_model(model: nn.Module) -> None:
    """Validate that model meets task requirements.

    For caption frame extents detection, models must:
    - Output exactly 5 classes (task constraint)
    - Accept standard inputs (ocr_viz, frame1, frame2, spatial_features, font_embedding)

    Args:
        model: Model to validate

    Raises:
        ValueError: If model doesn't meet requirements
    """
    # Check num_classes (if model exposes it)
    if hasattr(model, "num_classes"):
        if model.num_classes != 5:
            raise ValueError(f"Model must output 5 classes for caption frame extents detection, got {model.num_classes}")


def list_architectures() -> list[str]:
    """List all registered architectures.

    Returns:
        List of architecture names

    Example:
        >>> archs = list_architectures()
        >>> print(archs)
        ['triple_backbone_resnet50', 'shared_backbone_efficientnet', 'vit_base']
    """
    return sorted(_MODEL_REGISTRY.keys())


def get_model_info(architecture: str) -> dict[str, Any]:
    """Get information about a registered architecture.

    Args:
        architecture: Name of registered architecture

    Returns:
        Dictionary with architecture metadata

    Example:
        >>> info = get_model_info("triple_backbone_resnet50")
        >>> print(info['module'], info['function'])
    """
    if architecture not in _MODEL_REGISTRY:
        raise ValueError(f"Unknown architecture: '{architecture}'")

    factory = _MODEL_REGISTRY[architecture]

    return {
        "name": architecture,
        "module": factory.__module__,
        "function": factory.__name__,
        "docstring": factory.__doc__,
    }
