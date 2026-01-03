"""Example: Adding a new architecture variant.

This file demonstrates how to add new architectures to the registry.
Simply define your model class and register it with a factory function.
"""

import torch
import torch.nn as nn
import torchvision.models as models

from caption_boundaries.models.registry import register_model


class SharedBackbonePredictor(nn.Module):
    """Alternative architecture: Single shared ResNet50 backbone for all inputs.

    Instead of three separate backbones, uses one backbone and processes
    all three inputs through it sequentially.

    This reduces parameter count but may lose some specialization.
    """

    def __init__(
        self,
        num_classes: int = 5,
        spatial_dim: int = 6,
        font_dim: int = 512,
        fusion_hidden_dim: int = 1024,
        dropout: float = 0.3,
        pretrained: bool = True,
    ):
        super().__init__()

        self.num_classes = num_classes
        self.spatial_dim = spatial_dim
        self.font_dim = font_dim

        # Single shared ResNet50 backbone
        if pretrained:
            weights = models.ResNet50_Weights.IMAGENET1K_V2
            resnet = models.resnet50(weights=weights)
        else:
            resnet = models.resnet50(weights=None)

        # Remove final FC layer
        modules = list(resnet.children())[:-1]
        self.shared_backbone = nn.Sequential(*modules)

        self.resnet_feat_dim = 2048

        # Metadata projection
        self.spatial_proj = nn.Sequential(
            nn.Linear(spatial_dim, 128),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(128, 128),
        )

        self.font_proj = nn.Sequential(
            nn.Linear(font_dim, 256),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(256, 128),
        )

        # Fusion MLP (3 × 2048 + 128 + 128 = 6400)
        fusion_input_dim = (3 * self.resnet_feat_dim) + 128 + 128

        self.fusion_mlp = nn.Sequential(
            nn.Linear(fusion_input_dim, fusion_hidden_dim),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(fusion_hidden_dim, fusion_hidden_dim // 2),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(fusion_hidden_dim // 2, num_classes),
        )

    def forward(
        self,
        ocr_viz: torch.Tensor,
        frame1: torch.Tensor,
        frame2: torch.Tensor,
        spatial_features: torch.Tensor,
        font_embedding: torch.Tensor,
    ) -> torch.Tensor:
        """Forward pass."""
        batch_size = ocr_viz.size(0)

        # Process all three inputs through shared backbone
        ocr_features = self.shared_backbone(ocr_viz).view(batch_size, -1)
        frame1_features = self.shared_backbone(frame1).view(batch_size, -1)
        frame2_features = self.shared_backbone(frame2).view(batch_size, -1)

        # Project metadata
        spatial_proj = self.spatial_proj(spatial_features)
        font_proj = self.font_proj(font_embedding)

        # Fuse and classify
        combined = torch.cat(
            [ocr_features, frame1_features, frame2_features, spatial_proj, font_proj],
            dim=1,
        )
        logits = self.fusion_mlp(combined)

        return logits

    def get_num_trainable_params(self) -> int:
        """Count trainable parameters."""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)

    def get_num_total_params(self) -> int:
        """Count total parameters."""
        return sum(p.numel() for p in self.parameters())


# Register the architecture
@register_model("shared_backbone_resnet50")
def create_shared_backbone_resnet50(
    num_classes: int = 5,
    pretrained: bool = True,
    **kwargs,
) -> SharedBackbonePredictor:
    """Create shared-backbone ResNet50 architecture.

    Single ResNet50 backbone processes all three inputs.
    Fewer parameters than triple-backbone variant.

    Args:
        num_classes: Number of output classes (must be 5)
        pretrained: Use ImageNet pretrained weights
        **kwargs: Additional arguments for SharedBackbonePredictor

    Returns:
        Initialized model
    """
    return SharedBackbonePredictor(
        num_classes=num_classes,
        pretrained=pretrained,
        **kwargs,
    )
