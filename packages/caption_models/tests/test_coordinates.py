"""Unit tests for coordinate conversion functions (pixel-based)."""

import pytest

from caption_models.coordinates import (
    BoundingBox,
    CropBounds,
    box_overlap_with_crop,
    cropped_to_original,
    is_box_inside_crop,
    original_to_cropped,
)


class TestBoundingBox:
    """Tests for BoundingBox dataclass and methods."""

    def test_properties(self):
        """Test width, height, center, and area properties."""
        box = BoundingBox(left=100, top=200, right=300, bottom=400)

        assert box.width == 200
        assert box.height == 200
        assert box.center_x == pytest.approx(200.0)
        assert box.center_y == pytest.approx(300.0)
        assert box.area == 40000

    def test_to_fractional(self):
        """Test conversion to fractional coordinates."""
        box = BoundingBox(left=480, top=540, right=1440, bottom=1080)
        frac = box.to_fractional(frame_width=1920, frame_height=1080)

        assert frac == pytest.approx((0.25, 0.5, 0.75, 1.0))

    def test_from_fractional(self):
        """Test creation from fractional coordinates."""
        box = BoundingBox.from_fractional(
            left=0.25, top=0.5, right=0.75, bottom=1.0, frame_width=1920, frame_height=1080
        )

        assert box.left == 480
        assert box.top == 540
        assert box.right == 1440
        assert box.bottom == 1080

    def test_is_inside_true(self):
        """Test is_inside returns True when box is completely inside."""
        inner = BoundingBox(left=300, top=400, right=600, bottom=700)
        outer = BoundingBox(left=200, top=300, right=700, bottom=800)

        assert inner.is_inside(outer) is True

    def test_is_inside_false(self):
        """Test is_inside returns False when box extends outside."""
        box1 = BoundingBox(left=100, top=400, right=600, bottom=700)
        box2 = BoundingBox(left=200, top=300, right=700, bottom=800)

        assert box1.is_inside(box2) is False

    def test_overlaps_true(self):
        """Test overlaps returns True when boxes overlap."""
        box1 = BoundingBox(left=200, top=300, right=600, bottom=700)
        box2 = BoundingBox(left=400, top=500, right=800, bottom=900)

        assert box1.overlaps(box2) is True
        assert box2.overlaps(box1) is True

    def test_overlaps_false(self):
        """Test overlaps returns False when boxes don't overlap."""
        box1 = BoundingBox(left=100, top=200, right=300, bottom=400)
        box2 = BoundingBox(left=500, top=600, right=700, bottom=800)

        assert box1.overlaps(box2) is False
        assert box2.overlaps(box1) is False

    def test_intersection_with_overlap(self):
        """Test intersection calculation when boxes overlap."""
        box1 = BoundingBox(left=200, top=300, right=600, bottom=700)
        box2 = BoundingBox(left=400, top=500, right=800, bottom=900)

        intersection = box1.intersection(box2)

        assert intersection is not None
        assert intersection.left == 400
        assert intersection.top == 500
        assert intersection.right == 600
        assert intersection.bottom == 700

    def test_intersection_no_overlap(self):
        """Test intersection returns None when boxes don't overlap."""
        box1 = BoundingBox(left=100, top=200, right=300, bottom=400)
        box2 = BoundingBox(left=500, top=600, right=700, bottom=800)

        intersection = box1.intersection(box2)

        assert intersection is None

    def test_overlap_fraction_full(self):
        """Test overlap_fraction with 100% overlap (box inside)."""
        inner = BoundingBox(left=300, top=400, right=600, bottom=700)
        outer = BoundingBox(left=200, top=300, right=700, bottom=800)

        fraction = inner.overlap_fraction(outer)

        assert fraction == pytest.approx(1.0)

    def test_overlap_fraction_partial(self):
        """Test overlap_fraction with partial overlap."""
        # Box1: (0, 0) to (200, 200) - area 40000
        # Box2: (100, 100) to (300, 300) - area 40000
        # Overlap: (100, 100) to (200, 200) - area 10000
        # Fraction: 10000 / 40000 = 0.25
        box1 = BoundingBox(left=0, top=0, right=200, bottom=200)
        box2 = BoundingBox(left=100, top=100, right=300, bottom=300)

        fraction = box1.overlap_fraction(box2)

        assert fraction == pytest.approx(0.25)

    def test_overlap_fraction_none(self):
        """Test overlap_fraction with no overlap."""
        box1 = BoundingBox(left=100, top=200, right=300, bottom=400)
        box2 = BoundingBox(left=500, top=600, right=700, bottom=800)

        fraction = box1.overlap_fraction(box2)

        assert fraction == pytest.approx(0.0)


class TestCropBounds:
    """Tests for CropBounds dataclass."""

    def test_properties(self):
        """Test width and height properties."""
        crop = CropBounds(left=100, top=200, right=900, bottom=800)

        assert crop.width == 800
        assert crop.height == 600

    def test_to_bounding_box(self):
        """Test conversion to bounding box."""
        crop = CropBounds(left=100, top=200, right=900, bottom=800)
        box = crop.to_bounding_box()

        assert isinstance(box, BoundingBox)
        assert box.left == 100
        assert box.top == 200
        assert box.right == 900
        assert box.bottom == 800

    def test_to_fractional(self):
        """Test conversion to fractional coordinates."""
        crop = CropBounds(left=0, top=540, right=1920, bottom=1080)
        frac = crop.to_fractional(frame_width=1920, frame_height=1080)

        assert frac == pytest.approx((0.0, 0.5, 1.0, 1.0))

    def test_from_fractional(self):
        """Test creation from fractional coordinates."""
        crop = CropBounds.from_fractional(
            left=0.0, top=0.5, right=1.0, bottom=1.0, frame_width=1920, frame_height=1080
        )

        assert crop.left == 0
        assert crop.top == 540
        assert crop.right == 1920
        assert crop.bottom == 1080


class TestOriginalToCropped:
    """Tests for original_to_cropped conversion."""

    def test_box_fully_inside_crop(self):
        """Test conversion when box is fully inside crop region."""
        # Original: Box in bottom half (1920x1080 frame)
        box = BoundingBox(left=768, top=756, right=1152, bottom=972)
        # Crop: Bottom half (top=540)
        crop = CropBounds(left=0, top=540, right=1920, bottom=1080)

        cropped = original_to_cropped(box, crop)

        assert cropped is not None
        # left/right unchanged (no horizontal crop offset)
        assert cropped.left == 768
        assert cropped.right == 1152
        # top: 756-540 = 216, bottom: 972-540 = 432
        assert cropped.top == 216
        assert cropped.bottom == 432

    def test_box_partially_outside_crop(self):
        """Test conversion when box extends outside crop region."""
        # Original: Box extends above crop boundary
        box = BoundingBox(left=768, top=324, right=1152, bottom=756)
        # Crop: Bottom half (top=540)
        crop = CropBounds(left=0, top=540, right=1920, bottom=1080)

        cropped = original_to_cropped(box, crop)

        assert cropped is not None
        # Box clamped to crop.top (540), so top becomes 0 in cropped coords
        assert cropped.left == 768
        assert cropped.right == 1152
        assert cropped.top == 0  # Clamped
        assert cropped.bottom == 216  # 756-540 = 216

    def test_box_completely_outside_crop(self):
        """Test conversion when box is completely outside crop region."""
        # Original: Box in top half
        box = BoundingBox(left=768, top=216, right=1152, bottom=432)
        # Crop: Bottom half (top=540)
        crop = CropBounds(left=0, top=540, right=1920, bottom=1080)

        cropped = original_to_cropped(box, crop)

        assert cropped is None

    def test_full_frame_crop(self):
        """Test conversion with full frame crop (identity minus offset)."""
        box = BoundingBox(left=384, top=648, right=1152, bottom=756)
        crop = CropBounds(left=0, top=0, right=1920, bottom=1080)

        cropped = original_to_cropped(box, crop)

        assert cropped is not None
        # No offset when crop is full frame
        assert cropped.left == box.left
        assert cropped.top == box.top
        assert cropped.right == box.right
        assert cropped.bottom == box.bottom

    def test_offset_crop_region(self):
        """Test conversion with crop region offset from origin."""
        # Original: Box at (960, 756) to (1344, 972)
        box = BoundingBox(left=960, top=756, right=1344, bottom=972)
        # Crop: Region (384, 540) to (1536, 1080) - width 1152, height 540
        crop = CropBounds(left=384, top=540, right=1536, bottom=1080)

        cropped = original_to_cropped(box, crop)

        assert cropped is not None
        # left: 960-384 = 576
        # top: 756-540 = 216
        # right: 1344-384 = 960
        # bottom: 972-540 = 432
        assert cropped.left == 576
        assert cropped.top == 216
        assert cropped.right == 960
        assert cropped.bottom == 432


class TestCroppedToOriginal:
    """Tests for cropped_to_original conversion."""

    def test_basic_conversion(self):
        """Test basic conversion from cropped to original."""
        # Cropped: Box at (768, 216) to (1152, 432)
        box = BoundingBox(left=768, top=216, right=1152, bottom=432)
        # Crop: Bottom half (top=540)
        crop = CropBounds(left=0, top=540, right=1920, bottom=1080)

        original = cropped_to_original(box, crop)

        # left: 768+0 = 768
        # top: 216+540 = 756
        # right: 1152+0 = 1152
        # bottom: 432+540 = 972
        assert original.left == 768
        assert original.top == 756
        assert original.right == 1152
        assert original.bottom == 972

    def test_full_frame_crop(self):
        """Test conversion with full frame crop (identity)."""
        box = BoundingBox(left=384, top=648, right=1152, bottom=756)
        crop = CropBounds(left=0, top=0, right=1920, bottom=1080)

        original = cropped_to_original(box, crop)

        # No offset when crop is full frame
        assert original.left == box.left
        assert original.top == box.top
        assert original.right == box.right
        assert original.bottom == box.bottom

    def test_offset_crop_region(self):
        """Test conversion with offset crop region."""
        # Cropped: Box at (576, 216) to (960, 432)
        box = BoundingBox(left=576, top=216, right=960, bottom=432)
        # Crop: Region (384, 540) to (1536, 1080)
        crop = CropBounds(left=384, top=540, right=1536, bottom=1080)

        original = cropped_to_original(box, crop)

        # left: 576+384 = 960
        # top: 216+540 = 756
        # right: 960+384 = 1344
        # bottom: 432+540 = 972
        assert original.left == 960
        assert original.top == 756
        assert original.right == 1344
        assert original.bottom == 972

    def test_round_trip_conversion(self):
        """Test that converting original→cropped→original preserves coordinates."""
        # Original box fully inside crop
        original_box = BoundingBox(left=768, top=756, right=1152, bottom=972)
        crop = CropBounds(left=0, top=540, right=1920, bottom=1080)

        # Convert to cropped and back
        cropped = original_to_cropped(original_box, crop)
        assert cropped is not None
        round_trip = cropped_to_original(cropped, crop)

        # Should match original exactly
        assert round_trip.left == original_box.left
        assert round_trip.top == original_box.top
        assert round_trip.right == original_box.right
        assert round_trip.bottom == original_box.bottom


class TestIsBoxInsideCrop:
    """Tests for is_box_inside_crop helper function."""

    def test_box_inside(self):
        """Test returns True when box is inside crop."""
        box = BoundingBox(left=576, top=648, right=1344, bottom=972)
        crop = CropBounds(left=0, top=540, right=1920, bottom=1080)

        assert is_box_inside_crop(box, crop) is True

    def test_box_outside(self):
        """Test returns False when box extends outside crop."""
        box = BoundingBox(left=576, top=324, right=1344, bottom=972)
        crop = CropBounds(left=0, top=540, right=1920, bottom=1080)

        assert is_box_inside_crop(box, crop) is False


class TestBoxOverlapWithCrop:
    """Tests for box_overlap_with_crop helper function."""

    def test_full_overlap(self):
        """Test 100% overlap when box is inside crop."""
        box = BoundingBox(left=576, top=648, right=1344, bottom=972)
        crop = CropBounds(left=0, top=540, right=1920, bottom=1080)

        overlap = box_overlap_with_crop(box, crop)

        assert overlap == pytest.approx(1.0)

    def test_partial_overlap(self):
        """Test partial overlap calculation."""
        # Box: (0, 432) to (768, 864) - area 331776
        # Crop: (0, 540) to (1920, 1080)
        # Overlap: (0, 540) to (768, 864) - area 248832
        # Fraction: 248832 / 331776 = 0.75
        box = BoundingBox(left=0, top=432, right=768, bottom=864)
        crop = CropBounds(left=0, top=540, right=1920, bottom=1080)

        overlap = box_overlap_with_crop(box, crop)

        assert overlap == pytest.approx(0.75)

    def test_no_overlap(self):
        """Test 0% overlap when box is outside crop."""
        box = BoundingBox(left=576, top=216, right=1344, bottom=432)
        crop = CropBounds(left=0, top=540, right=1920, bottom=1080)

        overlap = box_overlap_with_crop(box, crop)

        assert overlap == pytest.approx(0.0)


class TestRealWorldScenarios:
    """Integration tests with real-world coordinate scenarios (1920x1080 frames)."""

    def test_caption_region_bottom_third(self):
        """Test typical caption region in bottom third of 1920x1080 frame."""
        # Typical Chinese subtitle region (bottom ~1/3)
        crop = CropBounds(left=0, top=723, right=1920, bottom=1080)  # ~67% from top

        # Character box in caption region (小 character, ~40px tall)
        char_box = BoundingBox(left=960, top=918, right=998, bottom=972)

        # Should be inside crop
        assert is_box_inside_crop(char_box, crop) is True
        assert box_overlap_with_crop(char_box, crop) == pytest.approx(1.0)

        # Convert to cropped coords
        cropped = original_to_cropped(char_box, crop)
        assert cropped is not None

        # In cropped coords: top should be 918-723 = 195
        assert cropped.top == 195

        # Round trip should preserve original
        round_trip = cropped_to_original(cropped, crop)
        assert round_trip.left == char_box.left
        assert round_trip.top == char_box.top
        assert round_trip.right == char_box.right
        assert round_trip.bottom == char_box.bottom

    def test_noise_box_outside_crop(self):
        """Test OCR noise box outside caption region."""
        # Typical caption region (bottom 1/3)
        crop = CropBounds(left=0, top=723, right=1920, bottom=1080)

        # Noise box in top of frame (channel logo, ~50px square at top-right)
        noise_box = BoundingBox(left=1632, top=54, right=1824, bottom=130)

        # Should be outside crop
        assert is_box_inside_crop(noise_box, crop) is False
        assert box_overlap_with_crop(noise_box, crop) == pytest.approx(0.0)

        # Conversion should return None
        cropped = original_to_cropped(noise_box, crop)
        assert cropped is None

    def test_box_straddling_crop_boundary(self):
        """Test box that straddles crop boundary."""
        crop = CropBounds(left=0, top=723, right=1920, bottom=1080)

        # Box that extends slightly above crop region
        box = BoundingBox(left=768, top=702, right=1152, bottom=810)

        # Not completely inside
        assert is_box_inside_crop(box, crop) is False

        # But has partial overlap
        # Box area: 384 * 108 = 41472
        # Overlap: 384 * 87 = 33408 (from 723 to 810)
        # Fraction: 33408 / 41472 ≈ 0.8056
        overlap = box_overlap_with_crop(box, crop)
        assert overlap > 0.0
        assert overlap < 1.0
        assert overlap == pytest.approx(0.805555, rel=1e-5)

        # Conversion should clamp to crop bounds
        cropped = original_to_cropped(box, crop)
        assert cropped is not None
        assert cropped.top == 0  # Clamped to crop top
        assert cropped.bottom == 87  # 810-723

    def test_pixel_perfect_OCR_box(self):
        """Test actual OCR box from LiveText (realistic dimensions)."""
        # 1920x1080 frame, bottom third caption region
        crop = CropBounds(left=0, top=723, right=1920, bottom=1080)

        # Actual character box from OCR (典 character)
        # Original OCR gives fractional: [0.7673, 0.8607, 0.0311, 0.0492]
        # In 1920x1080: left=1473, top=930, width=60, height=53
        char_box = BoundingBox(left=1473, top=930, right=1533, bottom=983)

        # Should be inside caption region
        assert is_box_inside_crop(char_box, crop) is True

        # Convert to cropped coords
        cropped = original_to_cropped(char_box, crop)
        assert cropped is not None
        assert cropped.left == 1473  # No horizontal offset
        assert cropped.top == 207  # 930-723
        assert cropped.width == 60
        assert cropped.height == 53

        # Round trip
        round_trip = cropped_to_original(cropped, crop)
        assert round_trip.left == 1473
        assert round_trip.top == 930
        assert round_trip.right == 1533
        assert round_trip.bottom == 983
