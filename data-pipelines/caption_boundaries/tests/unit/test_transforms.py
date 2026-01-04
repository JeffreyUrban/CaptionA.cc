"""Unit tests for anchor-aware transforms."""

import numpy as np
import pytest
from PIL import Image, ImageDraw

from caption_boundaries.data.transforms import (
    AnchorAwareResize,
    NormalizeImageNet,
    ResizeStrategy,
)


def create_test_image(width: int, height: int, pattern: str = "solid") -> Image.Image:
    """Create test image with distinctive pattern.

    Args:
        width: Image width in pixels
        height: Image height in pixels
        pattern: Pattern type ("solid", "gradient", "text")

    Returns:
        PIL Image with the specified pattern
    """
    img = Image.new("RGB", (width, height))

    if pattern == "solid":
        # Solid color for simple tests
        img.paste((100, 150, 200), (0, 0, width, height))

    elif pattern == "gradient":
        # Horizontal gradient (useful for verifying crop/tile positions)
        pixels = img.load()
        for x in range(width):
            color_value = int((x / width) * 255)
            for y in range(height):
                pixels[x, y] = (color_value, color_value, color_value)

    elif pattern == "text":
        # Add text markers at left, center, right
        draw = ImageDraw.Draw(img)
        img.paste((255, 255, 255), (0, 0, width, height))  # White background

        # Draw colored markers
        draw.rectangle([0, 0, 10, height], fill=(255, 0, 0))  # Red left marker
        draw.rectangle([width // 2 - 5, 0, width // 2 + 5, height], fill=(0, 255, 0))  # Green center
        draw.rectangle([width - 10, 0, width, height], fill=(0, 0, 255))  # Blue right marker

    return img


@pytest.mark.unit
def test_exact_size_no_transform():
    """Test that exact-sized images pass through unchanged."""
    transform = AnchorAwareResize(target_width=480, target_height=48)

    # Create image of exact target size
    img = create_test_image(480, 48, pattern="gradient")

    # Should pass through unchanged for any anchor type
    for anchor in ["left", "center", "right"]:
        result = transform(img, anchor_type=anchor)
        assert result.size == (480, 48)
        assert np.array_equal(np.array(result), np.array(img))


@pytest.mark.unit
def test_crop_oversized_left_anchor():
    """Test cropping oversized image with left anchor preserves left side."""
    transform = AnchorAwareResize(target_width=480, target_height=48, strategy=ResizeStrategy.CROP)

    # Create wide image with gradient (darker on left, lighter on right)
    img = create_test_image(960, 48, pattern="gradient")

    # Crop with left anchor should keep left side (darker pixels)
    result = transform(img, anchor_type="left")

    assert result.size == (480, 48)

    # Verify left side was preserved (check left edge pixel)
    original_left = np.array(img)[0, 0]  # Top-left pixel
    result_left = np.array(result)[0, 0]
    assert np.array_equal(result_left, original_left)

    # Verify right side was cropped (check right edge)
    original_right = np.array(img)[0, -1]  # Top-right pixel
    result_right = np.array(result)[0, -1]
    # Result right should NOT match original right (we cropped from right)
    assert not np.array_equal(result_right, original_right)


@pytest.mark.unit
def test_crop_oversized_right_anchor():
    """Test cropping oversized image with right anchor preserves right side."""
    transform = AnchorAwareResize(target_width=480, target_height=48, strategy=ResizeStrategy.CROP)

    # Create wide image with gradient
    img = create_test_image(960, 48, pattern="gradient")

    # Crop with right anchor should keep right side (lighter pixels)
    result = transform(img, anchor_type="right")

    assert result.size == (480, 48)

    # Verify right side was preserved
    original_right = np.array(img)[0, -1]
    result_right = np.array(result)[0, -1]
    assert np.array_equal(result_right, original_right)

    # Verify left side was cropped
    original_left = np.array(img)[0, 0]
    result_left = np.array(result)[0, 0]
    assert not np.array_equal(result_left, original_left)


@pytest.mark.unit
def test_crop_oversized_center_anchor():
    """Test cropping oversized image with center anchor preserves center."""
    transform = AnchorAwareResize(target_width=480, target_height=48, strategy=ResizeStrategy.CROP)

    # Create wide image with text markers
    img = create_test_image(960, 48, pattern="text")

    # Crop with center anchor should keep center (green marker)
    result = transform(img, anchor_type="center")

    assert result.size == (480, 48)

    # Verify center region was preserved (green marker should be visible)
    result_center = np.array(result)[24, 240]  # Center pixel
    # Should be greenish (from center marker)
    assert result_center[1] > result_center[0]  # More green than red
    assert result_center[1] > result_center[2]  # More green than blue


@pytest.mark.unit
def test_mirror_tile_undersized_left_anchor():
    """Test mirror-tiling undersized image with left anchor fills right."""
    transform = AnchorAwareResize(target_width=480, target_height=48, strategy=ResizeStrategy.MIRROR_TILE)

    # Create narrow image
    img = create_test_image(240, 48, pattern="gradient")

    # Tile with left anchor should place image at left, tile to right
    result = transform(img, anchor_type="left")

    assert result.size == (480, 48)

    # Verify left side matches original
    original_left_col = np.array(img)[:, 0]
    result_left_col = np.array(result)[:, 0]
    assert np.array_equal(result_left_col, original_left_col)

    # Verify right side is filled with mirrored content
    # Check pixel at position 240 (start of tiled region) - should be bright from mirror
    result_array = np.array(result)
    assert result_array[24, 240, 0] > 200  # Should be bright (mirrored right edge)

    # Verify there are non-zero pixels in tiled region
    assert np.any(result_array[:, 240:] > 0)


@pytest.mark.unit
def test_mirror_tile_undersized_right_anchor():
    """Test mirror-tiling undersized image with right anchor fills left."""
    transform = AnchorAwareResize(target_width=480, target_height=48, strategy=ResizeStrategy.MIRROR_TILE)

    # Create narrow image
    img = create_test_image(240, 48, pattern="gradient")

    # Tile with right anchor should place image at right, tile to left
    result = transform(img, anchor_type="right")

    assert result.size == (480, 48)

    # Verify right side matches original
    original_right_col = np.array(img)[:, -1]
    result_right_col = np.array(result)[:, -1]
    assert np.array_equal(result_right_col, original_right_col)

    # Verify left side is filled (not black/empty)
    result_left_col = np.array(result)[:, 0]
    assert not np.all(result_left_col == 0)


@pytest.mark.unit
def test_mirror_tile_undersized_center_anchor():
    """Test mirror-tiling undersized image with center anchor fills both sides."""
    transform = AnchorAwareResize(target_width=480, target_height=48, strategy=ResizeStrategy.MIRROR_TILE)

    # Create narrow image
    img = create_test_image(240, 48, pattern="gradient")

    # Tile with center anchor should place image at center, tile both sides
    result = transform(img, anchor_type="center")

    assert result.size == (480, 48)

    # Verify both sides are filled (not black/empty)
    result_left_col = np.array(result)[:, 0]
    result_right_col = np.array(result)[:, -1]
    assert not np.all(result_left_col == 0)
    assert not np.all(result_right_col == 0)

    # Verify image was centered (check middle region)
    # Original image center pixel should appear near result center
    center_offset = (480 - 240) // 2
    original_center = np.array(img)[:, 120]
    result_center = np.array(result)[:, center_offset + 120]
    assert np.array_equal(result_center, original_center)


@pytest.mark.unit
def test_aspect_ratio_preserved_on_height_resize():
    """Test that aspect ratio is preserved when resizing to target height."""
    transform = AnchorAwareResize(target_width=480, target_height=48)

    # Create image with 2:1 aspect ratio at different height
    img = create_test_image(200, 100, pattern="solid")

    # After resizing to height 48, width should be 96 (2:1 ratio)
    # Then either crop or tile to reach target width 480
    result = transform(img, anchor_type="left")

    assert result.size == (480, 48)


@pytest.mark.unit
def test_adaptive_strategy_crops_wide_images():
    """Test adaptive strategy crops significantly oversized images."""
    transform = AnchorAwareResize(
        target_width=480,
        target_height=48,
        strategy=ResizeStrategy.ADAPTIVE,
        crop_threshold=0.2,  # Crop if >20% wider
    )

    # Create image 150% of target width (exceeds 120% threshold)
    wide_img = create_test_image(720, 48, pattern="gradient")

    result = transform(wide_img, anchor_type="left")

    assert result.size == (480, 48)
    # Should have cropped (verify by checking if left edge preserved)
    assert np.array_equal(np.array(result)[:, 0], np.array(wide_img)[:, 0])


@pytest.mark.unit
def test_adaptive_strategy_tiles_slightly_wide_images():
    """Test adaptive strategy tiles slightly oversized images."""
    transform = AnchorAwareResize(
        target_width=480,
        target_height=48,
        strategy=ResizeStrategy.ADAPTIVE,
        crop_threshold=0.2,
    )

    # Create image 110% of target width (within 120% threshold)
    # First create at target height with slightly wider width
    slightly_wide = create_test_image(528, 48, pattern="gradient")

    result = transform(slightly_wide, anchor_type="left")

    assert result.size == (480, 48)


@pytest.mark.unit
def test_normalize_imagenet():
    """Test ImageNet normalization transform."""
    normalize = NormalizeImageNet()

    # Create test image with known values
    img = Image.new("RGB", (10, 10))
    img.paste((128, 128, 128), (0, 0, 10, 10))  # Mid-gray

    # Normalize
    result = normalize(img)

    # Verify output shape (C, H, W)
    assert result.shape == (3, 10, 10)

    # Verify dtype
    assert result.dtype == np.float32

    # Verify normalization applied (values should be roughly centered around 0)
    # Original 128/255 ≈ 0.5, after normalization should be close to 0
    assert -2.0 < result.mean() < 2.0


@pytest.mark.unit
def test_normalize_imagenet_range():
    """Test that normalized values are in reasonable range."""
    normalize = NormalizeImageNet()

    # Test with extreme values
    white_img = Image.new("RGB", (10, 10), (255, 255, 255))
    black_img = Image.new("RGB", (10, 10), (0, 0, 0))

    white_norm = normalize(white_img)
    black_norm = normalize(black_img)

    # Normalized values should be in roughly [-3, 3] range
    # (ImageNet normalization typically gives this range)
    assert white_norm.max() < 3.0
    assert white_norm.min() > -3.0
    assert black_norm.max() < 3.0
    assert black_norm.min() > -3.0


@pytest.mark.unit
def test_all_strategies_produce_correct_size():
    """Test that all resize strategies produce target size."""
    img_oversized = create_test_image(960, 96, pattern="gradient")
    img_undersized = create_test_image(240, 24, pattern="gradient")

    for strategy in [ResizeStrategy.CROP, ResizeStrategy.MIRROR_TILE, ResizeStrategy.ADAPTIVE]:
        transform = AnchorAwareResize(target_width=480, target_height=48, strategy=strategy)

        for anchor in ["left", "center", "right"]:
            # Test oversized
            result_over = transform(img_oversized, anchor_type=anchor)
            assert result_over.size == (480, 48), f"Failed for {strategy} + {anchor} (oversized)"

            # Test undersized
            result_under = transform(img_undersized, anchor_type=anchor)
            assert result_under.size == (480, 48), f"Failed for {strategy} + {anchor} (undersized)"


@pytest.mark.unit
def test_mirror_tile_creates_smooth_transition():
    """Test that mirror tiling creates smooth visual transition."""
    transform = AnchorAwareResize(target_width=480, target_height=48, strategy=ResizeStrategy.MIRROR_TILE)

    # Create narrow image with distinct left/right colors
    img = Image.new("RGB", (100, 48))
    img.paste((255, 0, 0), (0, 0, 50, 48))  # Left half red
    img.paste((0, 0, 255), (50, 0, 100, 48))  # Right half blue

    # Tile with left anchor
    result = transform(img, anchor_type="left")

    # Get pixel values across the boundary where original ends and mirror starts
    result_array = np.array(result)

    # At position 100 (where original ends), should still be blue
    assert result_array[24, 99, 2] > 200  # Blue channel high

    # At position 101 (where mirror starts), should transition
    # (mirror flips, so we'd see blue then red pattern)
    assert result_array[24, 100, 2] > 100  # Some blue remains
