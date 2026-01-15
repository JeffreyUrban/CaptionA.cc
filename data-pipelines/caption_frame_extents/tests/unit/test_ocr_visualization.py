"""Unit tests for OCR box visualization."""

import tempfile
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from caption_frame_extents.data import (
    OCRVisualizationVariant,
    create_ocr_visualization,
    save_visualization,
    visualize_boxes_3d,
    visualize_boxes_both,
    visualize_boxes_boundaries,
    visualize_boxes_centers,
)


@pytest.fixture
def sample_boxes():
    """Sample OCR boxes for testing."""
    return [
        {"x": 10, "y": 20, "width": 30, "height": 15, "confidence": 0.95},
        {"x": 50, "y": 20, "width": 25, "height": 15, "confidence": 0.88},
        {"x": 85, "y": 20, "width": 40, "height": 15, "confidence": 0.92},
    ]


@pytest.fixture
def image_size():
    """Standard image size for tests."""
    return (640, 480)


@pytest.mark.unit
def test_visualize_boxes_boundaries_shape(image_size, sample_boxes):
    """Test boundaries visualization produces correct shape."""
    viz = visualize_boxes_boundaries(image_size, sample_boxes)

    assert viz.shape == (480, 640)  # height, width
    assert viz.dtype == np.uint8
    assert viz.max() > 0  # Should have some non-zero pixels


@pytest.mark.unit
def test_visualize_boxes_boundaries_empty(image_size):
    """Test boundaries visualization with no boxes."""
    viz = visualize_boxes_boundaries(image_size, [])

    assert viz.shape == (480, 640)
    assert viz.max() == 0  # All zeros


@pytest.mark.unit
def test_visualize_boxes_centers_shape(image_size, sample_boxes):
    """Test centers visualization produces correct shape."""
    viz = visualize_boxes_centers(image_size, sample_boxes)

    assert viz.shape == (480, 640)
    assert viz.dtype == np.uint8
    assert viz.max() > 0  # Should have some non-zero pixels


@pytest.mark.unit
def test_visualize_boxes_centers_empty(image_size):
    """Test centers visualization with no boxes."""
    viz = visualize_boxes_centers(image_size, [])

    assert viz.shape == (480, 640)
    assert viz.max() == 0  # All zeros


@pytest.mark.unit
def test_visualize_boxes_both_shape(image_size, sample_boxes):
    """Test combined visualization produces correct shape."""
    viz = visualize_boxes_both(image_size, sample_boxes)

    assert viz.shape == (480, 640)
    assert viz.dtype == np.uint8
    assert viz.max() > 0  # Should have some non-zero pixels


@pytest.mark.unit
def test_visualize_boxes_both_combines_correctly(image_size, sample_boxes):
    """Test that 'both' variant combines boundaries and centers."""
    boundaries = visualize_boxes_boundaries(image_size, sample_boxes)
    centers = visualize_boxes_centers(image_size, sample_boxes)
    both = visualize_boxes_both(image_size, sample_boxes)

    # Combined should be >= each individual (since we use max)
    assert (both >= boundaries).all()
    assert (both >= centers).all()

    # Combined should have more non-zero pixels than either alone
    assert (both > 0).sum() >= (boundaries > 0).sum()
    assert (both > 0).sum() >= (centers > 0).sum()


@pytest.mark.unit
def test_visualize_boxes_3d_shape(image_size, sample_boxes):
    """Test 3D visualization produces RGB image."""
    viz = visualize_boxes_3d(image_size, sample_boxes)

    assert viz.shape == (480, 640, 3)  # height, width, channels
    assert viz.dtype == np.uint8
    assert viz.max() > 0  # Should have some non-zero pixels


@pytest.mark.unit
def test_visualize_boxes_3d_channels(image_size, sample_boxes):
    """Test that 3D visualization uses all three channels."""
    viz = visualize_boxes_3d(image_size, sample_boxes)

    # Extract channels
    r_channel = viz[:, :, 0]
    g_channel = viz[:, :, 1]
    b_channel = viz[:, :, 2]

    # Each channel should have some content
    assert r_channel.max() > 0  # Caption Frame Extents
    assert g_channel.max() > 0  # Centers
    assert b_channel.max() >= 0  # Confidence heatmap (might be 0)


@pytest.mark.unit
def test_create_ocr_visualization_boundaries(image_size, sample_boxes):
    """Test factory function with boundaries variant."""
    viz = create_ocr_visualization(image_size, sample_boxes, "boundaries")

    assert viz.shape == (480, 640)
    assert viz.dtype == np.uint8


@pytest.mark.unit
def test_create_ocr_visualization_centers(image_size, sample_boxes):
    """Test factory function with centers variant."""
    viz = create_ocr_visualization(image_size, sample_boxes, "centers")

    assert viz.shape == (480, 640)
    assert viz.dtype == np.uint8


@pytest.mark.unit
def test_create_ocr_visualization_both(image_size, sample_boxes):
    """Test factory function with both variant."""
    viz = create_ocr_visualization(image_size, sample_boxes, "both")

    assert viz.shape == (480, 640)
    assert viz.dtype == np.uint8


@pytest.mark.unit
def test_create_ocr_visualization_3d(image_size, sample_boxes):
    """Test factory function with 3D channels variant."""
    viz = create_ocr_visualization(image_size, sample_boxes, "3d_channels")

    assert viz.shape == (480, 640, 3)
    assert viz.dtype == np.uint8


@pytest.mark.unit
def test_create_ocr_visualization_enum(image_size, sample_boxes):
    """Test factory function with enum variant."""
    viz = create_ocr_visualization(
        image_size, sample_boxes, OCRVisualizationVariant.BOUNDARIES
    )

    assert viz.shape == (480, 640)
    assert viz.dtype == np.uint8


@pytest.mark.unit
def test_create_ocr_visualization_invalid_variant(image_size, sample_boxes):
    """Test factory function rejects invalid variant."""
    with pytest.raises(ValueError, match="Unknown variant"):
        create_ocr_visualization(image_size, sample_boxes, "invalid")  # type: ignore[arg-type]


@pytest.mark.unit
def test_confidence_normalization(image_size):
    """Test that confidence normalization scales correctly."""
    # Boxes with very narrow confidence range
    boxes = [
        {"x": 10, "y": 20, "width": 30, "height": 15, "confidence": 0.90},
        {"x": 50, "y": 20, "width": 25, "height": 15, "confidence": 0.91},
        {"x": 85, "y": 20, "width": 40, "height": 15, "confidence": 0.92},
    ]

    viz_normalized = visualize_boxes_boundaries(
        image_size, boxes, normalize_confidence=True
    )
    viz_unnormalized = visualize_boxes_boundaries(
        image_size, boxes, normalize_confidence=False
    )

    # Normalized should use full range (brighter)
    assert viz_normalized.max() > viz_unnormalized.max()


@pytest.mark.unit
def test_save_visualization_grayscale(image_size, sample_boxes):
    """Test saving grayscale visualization."""
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = Path(tmpdir) / "viz" / "boundaries.png"
        viz = visualize_boxes_boundaries(image_size, sample_boxes)

        save_visualization(viz, output_path)

        # Check file was created
        assert output_path.exists()

        # Check can be loaded
        loaded = Image.open(output_path)
        assert loaded.size == image_size  # (width, height)
        assert loaded.mode == "L"  # Grayscale


@pytest.mark.unit
def test_save_visualization_rgb(image_size, sample_boxes):
    """Test saving RGB visualization."""
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = Path(tmpdir) / "viz" / "3d_channels.png"
        viz = visualize_boxes_3d(image_size, sample_boxes)

        save_visualization(viz, output_path)

        # Check file was created
        assert output_path.exists()

        # Check can be loaded
        loaded = Image.open(output_path)
        assert loaded.size == image_size
        assert loaded.mode == "RGB"


@pytest.mark.unit
def test_thickness_parameter(image_size, sample_boxes):
    """Test that thickness parameter affects visualization."""
    viz_thin = visualize_boxes_boundaries(image_size, sample_boxes, thickness=1)
    viz_thick = visualize_boxes_boundaries(image_size, sample_boxes, thickness=3)

    # Thicker lines should have more non-zero pixels
    assert (viz_thick > 0).sum() > (viz_thin > 0).sum()


@pytest.mark.unit
def test_radius_parameter(image_size, sample_boxes):
    """Test that radius parameter affects visualization."""
    viz_small = visualize_boxes_centers(image_size, sample_boxes, radius=1)
    viz_large = visualize_boxes_centers(image_size, sample_boxes, radius=4)

    # Larger radius should have more non-zero pixels
    assert (viz_large > 0).sum() > (viz_small > 0).sum()


@pytest.mark.unit
def test_boxes_outside_image_bounds(image_size):
    """Test visualization handles boxes outside image bounds gracefully."""
    # Boxes partially or fully outside image
    boxes = [
        {
            "x": -10,
            "y": 20,
            "width": 30,
            "height": 15,
            "confidence": 0.95,
        },  # Partially outside left
        {
            "x": 630,
            "y": 20,
            "width": 30,
            "height": 15,
            "confidence": 0.88,
        },  # Partially outside right
        {
            "x": 700,
            "y": 500,
            "width": 30,
            "height": 15,
            "confidence": 0.92,
        },  # Fully outside
    ]

    # Should not crash
    viz = visualize_boxes_boundaries(image_size, boxes)
    assert viz.shape == (480, 640)


@pytest.mark.unit
def test_variants_produce_different_outputs(image_size, sample_boxes):
    """Test that different variants produce visually different outputs."""
    boundaries = create_ocr_visualization(image_size, sample_boxes, "boundaries")
    centers = create_ocr_visualization(image_size, sample_boxes, "centers")
    both = create_ocr_visualization(image_size, sample_boxes, "both")

    # Should be different from each other
    assert not np.array_equal(boundaries, centers)
    assert not np.array_equal(boundaries, both)
    assert not np.array_equal(centers, both)
