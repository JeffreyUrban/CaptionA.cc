"""Channel fusion architecture with LoRA-adapted backbone.

Combines three input images via 1x1 convolution, processes through a single
ResNet50 backbone with LoRA (Low-Rank Adaptation) for parameter-efficient
fine-tuning.

Design rationale:
- 1x1 conv learns optimal channel fusion (9 → 3 channels)
- LoRA adapts pretrained backbone with minimal trainable parameters
- Much more parameter-efficient than triple-backbone architecture
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.models as models

from caption_boundaries.models.registry import register_model


class LoRALayer(nn.Module):
    """Low-Rank Adaptation (LoRA) layer.

    Adapts a pretrained layer W with low-rank decomposition:
        W' = W + (B @ A) * alpha / rank

    Where A: (in_features, rank), B: (rank, out_features)
    Only A and B are trainable, W is frozen.

    Args:
        original_layer: The layer to adapt (typically nn.Linear or nn.Conv2d)
        rank: Rank of the low-rank decomposition (smaller = fewer params)
        alpha: Scaling factor (typically set to rank)
    """

    def __init__(self, original_layer: nn.Module, rank: int = 16, alpha: float = 16.0):
        super().__init__()
        self.original_layer = original_layer
        self.rank = rank
        self.alpha = alpha

        # Freeze original layer
        for param in self.original_layer.parameters():
            param.requires_grad = False

        # Determine dimensions based on layer type
        if isinstance(original_layer, nn.Linear):
            in_features = original_layer.in_features
            out_features = original_layer.out_features

            # Low-rank matrices
            self.lora_A = nn.Parameter(torch.randn(rank, in_features) * 0.01)
            self.lora_B = nn.Parameter(torch.zeros(out_features, rank))

        elif isinstance(original_layer, nn.Conv2d):
            in_channels = original_layer.in_channels
            out_channels = original_layer.out_channels

            # Store original layer properties for matching output shape
            self.stride = original_layer.stride
            self.padding = original_layer.padding

            # For conv layers, use 1x1 convs for A and matching stride/padding for B
            # A: 1x1 conv (no spatial change)
            self.lora_A = nn.Conv2d(in_channels, rank, kernel_size=1, bias=False)

            # B: 1x1 conv with same stride/padding as original to match spatial dims
            self.lora_B = nn.Conv2d(
                rank, out_channels,
                kernel_size=1,
                stride=self.stride,
                padding=0,  # 1x1 conv doesn't need padding
                bias=False
            )

            # Initialize
            nn.init.kaiming_uniform_(self.lora_A.weight, a=0.01)
            nn.init.zeros_(self.lora_B.weight)
        else:
            raise ValueError(f"Unsupported layer type for LoRA: {type(original_layer)}")

        self.scaling = alpha / rank

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass: original output + low-rank adaptation."""
        # Original forward pass (frozen)
        original_output = self.original_layer(x)

        # LoRA adaptation
        if isinstance(self.original_layer, nn.Linear):
            # x: (batch, in_features)
            lora_output = (x @ self.lora_A.T) @ self.lora_B.T  # (batch, out_features)
            lora_output = lora_output * self.scaling
        elif isinstance(self.original_layer, nn.Conv2d):
            # x: (batch, in_channels, H, W)
            lora_output = self.lora_B(self.lora_A(x))  # (batch, out_channels, H, W)
            lora_output = lora_output * self.scaling

        return original_output + lora_output


def apply_lora_to_resnet(resnet: nn.Module, rank: int = 16, alpha: float = 16.0) -> nn.Module:
    """Apply LoRA to all convolutional and linear layers in ResNet.

    Args:
        resnet: ResNet model (e.g., from torchvision.models.resnet50)
        rank: LoRA rank
        alpha: LoRA alpha scaling

    Returns:
        ResNet with LoRA-adapted layers
    """

    def apply_lora_recursive(module: nn.Module):
        for name, child in module.named_children():
            if isinstance(child, (nn.Linear, nn.Conv2d)):
                # Replace with LoRA-adapted version
                setattr(module, name, LoRALayer(child, rank=rank, alpha=alpha))
            else:
                # Recurse into submodules
                apply_lora_recursive(child)

    apply_lora_recursive(resnet)
    return resnet


class ChannelFusionLoRAPredictor(nn.Module):
    """Channel fusion + LoRA architecture.

    Fuses three input images via 1x1 convolution, then processes through
    a single ResNet50 backbone with LoRA adapters.

    Architecture:
    1. Stack 3 RGB images → 9 channels
    2. 1x1 conv (learnable) → 3 channels
    3. ResNet50 backbone (pretrained + LoRA adapters)
    4. Metadata fusion (spatial)
    5. Classifier MLP

    Trainable parameters:
    - 1x1 conv: 9 * 3 = 27 params (tiny!)
    - LoRA adapters: ~rank * (in + out) per layer
    - Metadata projection: ~100K params
    - Classifier: ~2M params
    Total: ~2-4M trainable params (vs 78M for triple-backbone)
    """

    def __init__(
        self,
        num_classes: int = 5,
        spatial_dim: int = 6,
        fusion_hidden_dim: int = 1024,
        dropout: float = 0.3,
        pretrained: bool = True,
        lora_rank: int = 16,
        lora_alpha: float = 16.0,
    ):
        super().__init__()

        self.num_classes = num_classes
        self.spatial_dim = spatial_dim
        self.lora_rank = lora_rank
        self.lora_alpha = lora_alpha

        # 1x1 conv to fuse 3 RGB images (9 channels) into 3 channels
        # This learns the optimal way to combine the three inputs
        self.channel_fusion = nn.Conv2d(
            in_channels=9,  # 3 images × 3 RGB channels
            out_channels=3,  # Standard RGB for pretrained ResNet
            kernel_size=1,
            bias=False,
        )

        # Initialize to average the channels initially
        # Each output channel = average of corresponding channels across 3 images
        nn.init.constant_(self.channel_fusion.weight, 1.0 / 3.0)

        # Single ResNet50 backbone with LoRA adapters
        if pretrained:
            weights = models.ResNet50_Weights.IMAGENET1K_V2
            resnet = models.resnet50(weights=weights)
        else:
            resnet = models.resnet50(weights=None)

        # Apply LoRA to all layers
        resnet = apply_lora_to_resnet(resnet, rank=lora_rank, alpha=lora_alpha)

        # Remove final FC layer (use as feature extractor)
        modules = list(resnet.children())[:-1]
        self.backbone = nn.Sequential(*modules)

        self.resnet_feat_dim = 2048

        # Metadata projection layers
        self.spatial_proj = nn.Sequential(
            nn.Linear(spatial_dim, 128),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(128, 128),
        )

        # Fusion MLP
        # Input: 2048 (ResNet features) + 128 (spatial)
        fusion_input_dim = self.resnet_feat_dim + 128

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
        reference_image: torch.Tensor,
    ) -> torch.Tensor:
        """Forward pass.

        Args:
            ocr_viz: (batch, 3, H, W)
            frame1: (batch, 3, H, W)
            frame2: (batch, 3, H, W)
            spatial_features: (batch, 6)

        Returns:
            logits: (batch, 5)
        """
        batch_size = ocr_viz.size(0)

        # Stack the three images along channel dimension: (batch, 9, H, W)
        stacked_images = torch.cat([ocr_viz, frame1, frame2], dim=1)

        # Fuse channels via 1x1 conv: (batch, 9, H, W) → (batch, 3, H, W)
        fused = self.channel_fusion(stacked_images)

        # Process through LoRA-adapted backbone
        features = self.backbone(fused)  # (batch, 2048, 1, 1)
        features = features.view(batch_size, -1)  # (batch, 2048)

        # Project metadata
        spatial_proj = self.spatial_proj(spatial_features)  # (batch, 128)

        # Concatenate and classify
        combined = torch.cat([features, spatial_proj], dim=1)  # (batch, 2176)
        logits = self.fusion_mlp(combined)  # (batch, 5)

        return logits

    def get_num_trainable_params(self) -> int:
        """Count trainable parameters (LoRA adapters + fusion + classifier)."""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)

    def get_num_total_params(self) -> int:
        """Count total parameters (frozen + trainable)."""
        return sum(p.numel() for p in self.parameters())

    def freeze_backbone(self):
        """Freeze LoRA adapters (only train fusion + classifier)."""
        for name, param in self.named_parameters():
            if "lora" in name:
                param.requires_grad = False

    def unfreeze_backbone(self):
        """Unfreeze LoRA adapters."""
        for name, param in self.named_parameters():
            if "lora" in name:
                param.requires_grad = True


# Register the architecture
@register_model("channel_fusion_lora_spatial")
def create_channel_fusion_lora_spatial(
    num_classes: int = 5,
    pretrained: bool = True,
    lora_rank: int = 16,
    lora_alpha: float = 16.0,
    **kwargs,
) -> ChannelFusionLoRAPredictor:
    """Create channel fusion + LoRA ResNet50 architecture.

    Fuses three images via 1x1 conv, processes through ResNet50 with LoRA.
    Very parameter-efficient: ~2-4M trainable params (vs 78M for triple-backbone).

    Args:
        num_classes: Number of output classes (must be 5)
        pretrained: Use ImageNet pretrained weights for backbone
        lora_rank: Rank of LoRA decomposition (lower = fewer params)
        lora_alpha: LoRA scaling factor (typically equal to rank)
        **kwargs: Additional arguments for ChannelFusionLoRAPredictor

    Returns:
        Initialized model

    Example:
        # Standard LoRA rank
        model = create_model("channel_fusion_lora_resnet50", device="cuda")

        # Lower rank for more efficiency
        model = create_model(
            "channel_fusion_lora_resnet50",
            device="cuda",
            lora_rank=8,
            lora_alpha=8.0
        )
    """
    return ChannelFusionLoRAPredictor(
        num_classes=num_classes,
        pretrained=pretrained,
        lora_rank=lora_rank,
        lora_alpha=lora_alpha,
        **kwargs,
    )
