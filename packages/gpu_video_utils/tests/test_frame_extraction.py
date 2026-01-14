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
    from gpu_video_utils import extract_frames_gpu, GPUVideoDecoder

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
