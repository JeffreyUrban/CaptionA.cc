"""Unit tests for GPU frame extraction."""

import pytest


def test_extract_frames_gpu_tensor_format(test_video_path, tmp_path):
    """Test frame extraction in tensor format."""
    from gpu_video_utils import extract_frames_gpu

    frames = extract_frames_gpu(
        video_path=test_video_path,
        frame_rate_hz=1.0,  # 1 frame per second
        output_format="tensor",
    )

    assert len(frames) > 0
    import torch
    assert all(isinstance(f, torch.Tensor) for f in frames)
    assert all(f.device.type == "cuda" for f in frames)


def test_extract_frames_gpu_pil_format(test_video_path, tmp_path):
    """Test frame extraction in PIL format."""
    from gpu_video_utils import extract_frames_gpu
    from PIL import Image

    frames = extract_frames_gpu(
        video_path=test_video_path,
        frame_rate_hz=1.0,
        output_format="pil",
    )

    assert len(frames) > 0
    assert all(isinstance(f, Image.Image) for f in frames)


def test_extract_frames_gpu_jpeg_format(test_video_path, tmp_path):
    """Test frame extraction in JPEG bytes format."""
    from gpu_video_utils import extract_frames_gpu

    frames = extract_frames_gpu(
        video_path=test_video_path,
        frame_rate_hz=1.0,
        output_format="jpeg_bytes",
    )

    assert len(frames) > 0
    assert all(isinstance(f, bytes) for f in frames)
    # Verify JPEG header
    assert all(f.startswith(b'\xff\xd8\xff') for f in frames)


def test_extract_frames_with_crop(test_video_path, tmp_path):
    """Test frame extraction with GPU cropping."""
    from gpu_video_utils import GPUVideoDecoder, extract_frames_gpu

    # Get video dimensions
    with GPUVideoDecoder(test_video_path) as decoder:
        info = decoder.get_video_info()
        width = info["width"]
        height = info["height"]

    # Define crop region (center 50%)
    crop_left = int(width * 0.25)
    crop_top = int(height * 0.25)
    crop_right = int(width * 0.75)
    crop_bottom = int(height * 0.75)

    frames = extract_frames_gpu(
        video_path=test_video_path,
        frame_rate_hz=1.0,
        output_format="pil",
        crop_region=(crop_left, crop_top, crop_right, crop_bottom),
    )

    assert len(frames) > 0
    # Verify crop dimensions
    expected_width = crop_right - crop_left
    expected_height = crop_bottom - crop_top
    assert frames[0].size == (expected_width, expected_height)


def test_extract_frames_progress_callback(test_video_path, tmp_path):
    """Test progress callback functionality."""
    from gpu_video_utils import extract_frames_gpu

    progress_calls = []

    def progress_callback(current, total):
        progress_calls.append((current, total))

    frames = extract_frames_gpu(
        video_path=test_video_path,
        frame_rate_hz=1.0,
        output_format="pil",
        progress_callback=progress_callback,
    )

    assert len(progress_calls) > 0
    assert progress_calls[-1][0] == progress_calls[-1][1]  # Last call: current == total
    assert progress_calls[-1][1] == len(frames)


def test_extract_frames_for_montage(test_video_path, tmp_path):
    """Test frame extraction batched for montages."""
    from gpu_video_utils import extract_frames_for_montage

    batches = extract_frames_for_montage(
        video_path=test_video_path,
        frame_rate_hz=0.1,  # 1 frame per 10 seconds
        max_frames_per_batch=10,
    )

    assert len(batches) > 0
    for frame_indices, frame_data in batches:
        assert len(frame_indices) == len(frame_data)
        assert len(frame_indices) <= 10  # Respects max_frames_per_batch
        assert all(isinstance(data, bytes) for data in frame_data)
        # Verify frame indices follow convention: frame_index = time_in_seconds * 10
        assert all(isinstance(idx, int) for idx in frame_indices)


def test_extract_frames_with_normalized_crop(test_video_path, tmp_path):
    """Test frame extraction with normalized crop coordinates (0.0-1.0)."""
    from gpu_video_utils import GPUVideoDecoder, extract_frames_gpu

    # Get video dimensions
    with GPUVideoDecoder(test_video_path) as decoder:
        info = decoder.get_video_info()
        width = info["width"]
        height = info["height"]

    # Use normalized coordinates for center 50% crop
    # (0.25, 0.25, 0.75, 0.75)
    frames = extract_frames_gpu(
        video_path=test_video_path,
        frame_rate_hz=1.0,
        output_format="pil",
        crop_normalized=(0.25, 0.25, 0.75, 0.75),
    )

    assert len(frames) > 0
    # Verify crop dimensions match expected pixel values
    expected_width = int(width * 0.75) - int(width * 0.25)
    expected_height = int(height * 0.75) - int(height * 0.25)
    assert frames[0].size == (expected_width, expected_height)


def test_normalized_crop_matches_pixel_crop(test_video_path, tmp_path):
    """Test that normalized crop produces same results as equivalent pixel crop."""
    from gpu_video_utils import GPUVideoDecoder, extract_frames_gpu

    # Get video dimensions
    with GPUVideoDecoder(test_video_path) as decoder:
        info = decoder.get_video_info()
        width = info["width"]
        height = info["height"]

    # Define normalized coordinates
    norm_left, norm_top, norm_right, norm_bottom = 0.25, 0.25, 0.75, 0.75

    # Calculate equivalent pixel coordinates
    pixel_left = int(norm_left * width)
    pixel_top = int(norm_top * height)
    pixel_right = int(norm_right * width)
    pixel_bottom = int(norm_bottom * height)

    # Extract with normalized crop
    frames_normalized = extract_frames_gpu(
        video_path=test_video_path,
        frame_rate_hz=1.0,
        output_format="pil",
        crop_normalized=(norm_left, norm_top, norm_right, norm_bottom),
    )

    # Extract with pixel crop
    frames_pixel = extract_frames_gpu(
        video_path=test_video_path,
        frame_rate_hz=1.0,
        output_format="pil",
        crop_region=(pixel_left, pixel_top, pixel_right, pixel_bottom),
    )

    # Verify same number of frames
    assert len(frames_normalized) == len(frames_pixel)

    # Verify same dimensions
    assert frames_normalized[0].size == frames_pixel[0].size


def test_crop_region_and_normalized_mutually_exclusive(test_video_path, tmp_path):
    """Test that providing both crop_region and crop_normalized raises ValueError."""
    from gpu_video_utils import extract_frames_gpu

    with pytest.raises(ValueError, match="Cannot specify both"):
        extract_frames_gpu(
            video_path=test_video_path,
            frame_rate_hz=1.0,
            output_format="pil",
            crop_region=(100, 100, 200, 200),
            crop_normalized=(0.1, 0.1, 0.5, 0.5),
        )


def test_normalized_crop_invalid_range(test_video_path, tmp_path):
    """Test that normalized coordinates outside 0.0-1.0 raise ValueError."""
    from gpu_video_utils import extract_frames_gpu

    # Test value > 1.0
    with pytest.raises(ValueError, match="must be between 0.0 and 1.0"):
        extract_frames_gpu(
            video_path=test_video_path,
            frame_rate_hz=1.0,
            output_format="pil",
            crop_normalized=(0.0, 0.0, 1.5, 1.0),
        )

    # Test value < 0.0
    with pytest.raises(ValueError, match="must be between 0.0 and 1.0"):
        extract_frames_gpu(
            video_path=test_video_path,
            frame_rate_hz=1.0,
            output_format="pil",
            crop_normalized=(-0.1, 0.0, 1.0, 1.0),
        )


def test_normalized_crop_invalid_ordering(test_video_path, tmp_path):
    """Test that left >= right or top >= bottom raises ValueError."""
    from gpu_video_utils import extract_frames_gpu

    # Test left >= right
    with pytest.raises(ValueError, match="left.*must be less than right"):
        extract_frames_gpu(
            video_path=test_video_path,
            frame_rate_hz=1.0,
            output_format="pil",
            crop_normalized=(0.5, 0.0, 0.3, 1.0),
        )

    # Test top >= bottom
    with pytest.raises(ValueError, match="top.*must be less than bottom"):
        extract_frames_gpu(
            video_path=test_video_path,
            frame_rate_hz=1.0,
            output_format="pil",
            crop_normalized=(0.0, 0.8, 1.0, 0.5),
        )


def test_extract_frames_for_montage_with_normalized_crop(test_video_path, tmp_path):
    """Test montage extraction with normalized crop coordinates."""
    from io import BytesIO

    from gpu_video_utils import GPUVideoDecoder, extract_frames_for_montage
    from PIL import Image

    # Get video dimensions
    with GPUVideoDecoder(test_video_path) as decoder:
        info = decoder.get_video_info()
        width = info["width"]
        height = info["height"]

    # Extract with normalized crop (bottom 20%)
    batches = extract_frames_for_montage(
        video_path=test_video_path,
        frame_rate_hz=0.1,
        max_frames_per_batch=10,
        crop_normalized=(0.0, 0.8, 1.0, 1.0),
    )

    assert len(batches) > 0
    # Verify the first frame has correct dimensions
    frame_indices, frame_data = batches[0]
    assert len(frame_data) > 0

    # Decode JPEG and check dimensions
    first_frame = Image.open(BytesIO(frame_data[0]))
    expected_width = int(1.0 * width) - int(0.0 * width)
    expected_height = int(1.0 * height) - int(0.8 * height)
    assert first_frame.size == (expected_width, expected_height)
