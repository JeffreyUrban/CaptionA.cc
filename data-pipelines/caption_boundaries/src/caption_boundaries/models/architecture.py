"""Caption boundary detection model architecture.

Based on multi-frame ResNet architecture with metadata fusion.
Predicts boundary transitions between consecutive caption frames.
"""

import torch
import torch.nn as nn
import torchvision.models as models
from typing import Literal


class CaptionBoundaryPredictor(nn.Module):
    """Caption boundary predictor with 3-frame input and metadata fusion.

    Architecture:
    1. Three ResNet50 backbones (one per input frame):
       - OCR box visualization
       - Frame 1 (time t)
       - Frame 2 (time t+1)

    2. Metadata fusion:
       - Spatial priors (6-dim): anchor_type, position, size
       - Font embedding (512-dim from FontCLIP)

    3. Fusion MLP:
       - Combines visual features (3 × 2048) + metadata (518)
       - Outputs 5-way classification logits

    Args:
        num_classes: Number of output classes (default: 5)
        spatial_dim: Spatial metadata dimension (default: 6)
        font_dim: Font embedding dimension (default: 512)
        fusion_hidden_dim: Hidden dimension for fusion MLP (default: 1024)
        dropout: Dropout rate (default: 0.3)
        pretrained: Use ImageNet pretrained weights (default: True)

    Input shapes:
        ocr_viz: (batch, 3, H, W) - OCR box visualization
        frame1: (batch, 3, H, W) - First frame
        frame2: (batch, 3, H, W) - Second frame
        spatial_features: (batch, 6) - Spatial metadata
        font_embedding: (batch, 512) - Font embedding

    Output shape:
        logits: (batch, 5) - Class logits for boundary prediction
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

        # Three separate ResNet50 backbones
        # Remove final FC layer (use as feature extractor)
        self.ocr_viz_backbone = self._create_resnet_backbone(pretrained)
        self.frame1_backbone = self._create_resnet_backbone(pretrained)
        self.frame2_backbone = self._create_resnet_backbone(pretrained)

        # Feature dimension from ResNet50 (after global avg pool)
        self.resnet_feat_dim = 2048

        # Metadata projection layers
        # Project spatial and font features to same dimension as ResNet features
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

        # Fusion MLP
        # Input: 3 × 2048 (visual) + 128 (spatial) + 128 (font) = 6400
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

    def _create_resnet_backbone(self, pretrained: bool) -> nn.Module:
        """Create ResNet50 backbone without final FC layer.

        Args:
            pretrained: Whether to use ImageNet pretrained weights

        Returns:
            ResNet50 feature extractor
        """
        # Load ResNet50
        if pretrained:
            weights = models.ResNet50_Weights.IMAGENET1K_V2
            resnet = models.resnet50(weights=weights)
        else:
            resnet = models.resnet50(weights=None)

        # Remove final FC layer
        # ResNet50 architecture: conv layers -> avgpool -> fc
        # We want: conv layers -> avgpool (output: 2048-dim)
        modules = list(resnet.children())[:-1]  # Remove fc layer
        backbone = nn.Sequential(*modules)

        return backbone

    def forward(
        self,
        ocr_viz: torch.Tensor,
        frame1: torch.Tensor,
        frame2: torch.Tensor,
        spatial_features: torch.Tensor,
        font_embedding: torch.Tensor,
    ) -> torch.Tensor:
        """Forward pass through model.

        Args:
            ocr_viz: OCR box visualization (batch, 3, H, W)
            frame1: First frame (batch, 3, H, W)
            frame2: Second frame (batch, 3, H, W)
            spatial_features: Spatial metadata (batch, 6)
            font_embedding: Font embedding (batch, 512)

        Returns:
            Class logits (batch, num_classes)
        """
        batch_size = ocr_viz.size(0)

        # Extract visual features from each frame
        # ResNet backbone outputs (batch, 2048, 1, 1)
        ocr_features = self.ocr_viz_backbone(ocr_viz)
        frame1_features = self.frame1_backbone(frame1)
        frame2_features = self.frame2_backbone(frame2)

        # Flatten spatial dimensions: (batch, 2048, 1, 1) -> (batch, 2048)
        ocr_features = ocr_features.view(batch_size, -1)
        frame1_features = frame1_features.view(batch_size, -1)
        frame2_features = frame2_features.view(batch_size, -1)

        # Project metadata
        spatial_proj = self.spatial_proj(spatial_features)  # (batch, 128)
        font_proj = self.font_proj(font_embedding)  # (batch, 128)

        # Concatenate all features
        combined = torch.cat(
            [ocr_features, frame1_features, frame2_features, spatial_proj, font_proj],
            dim=1,
        )  # (batch, 6400)

        # Fusion MLP
        logits = self.fusion_mlp(combined)  # (batch, num_classes)

        return logits

    def get_device(self) -> torch.device:
        """Get device that model is on."""
        return next(self.parameters()).device

    def freeze_backbones(self):
        """Freeze ResNet backbone parameters (for transfer learning).

        Use this to freeze pretrained ImageNet features and only train
        the fusion layers.
        """
        for backbone in [self.ocr_viz_backbone, self.frame1_backbone, self.frame2_backbone]:
            for param in backbone.parameters():
                param.requires_grad = False

    def unfreeze_backbones(self):
        """Unfreeze ResNet backbone parameters."""
        for backbone in [self.ocr_viz_backbone, self.frame1_backbone, self.frame2_backbone]:
            for param in backbone.parameters():
                param.requires_grad = True

    def get_num_trainable_params(self) -> int:
        """Count number of trainable parameters."""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)

    def get_num_total_params(self) -> int:
        """Count total number of parameters."""
        return sum(p.numel() for p in self.parameters())


def create_model(
    num_classes: int = 5,
    device: Literal["cuda", "mps", "cpu"] | None = None,
    pretrained: bool = True,
    **kwargs,
) -> CaptionBoundaryPredictor:
    """Create caption boundary predictor model.

    Args:
        num_classes: Number of output classes
        device: Device to place model on (auto-detect if None)
        pretrained: Use ImageNet pretrained weights
        **kwargs: Additional arguments for CaptionBoundaryPredictor

    Returns:
        CaptionBoundaryPredictor model on specified device

    Example:
        >>> model = create_model(device='cuda')
        >>> print(f"Trainable params: {model.get_num_trainable_params():,}")
    """
    # Auto-detect device if not specified
    if device is None:
        if torch.cuda.is_available():
            device = "cuda"
        elif torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"

    # Create model
    model = CaptionBoundaryPredictor(
        num_classes=num_classes,
        pretrained=pretrained,
        **kwargs,
    )

    # Move to device
    model = model.to(device)

    return model
