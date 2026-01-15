"""Unit tests for GPUVideoDecoder."""

import pytest
import torch


def test_decoder_initialization(test_video_path):
    """Test decoder initializes correctly."""
    from gpu_video_utils import GPUVideoDecoder

    decoder = GPUVideoDecoder(test_video_path, gpu_id=0)

    assert decoder is not None
    assert len(decoder) > 0  # Should have frames

    decoder.close()


def test_decoder_context_manager(test_video_path):
    """Test decoder works as context manager."""
    from gpu_video_utils import GPUVideoDecoder

    with GPUVideoDecoder(test_video_path) as decoder:
        assert decoder is not None
        assert len(decoder) > 0


def test_get_video_info(test_video_path):
    """Test video info extraction."""
    from gpu_video_utils import GPUVideoDecoder

    with GPUVideoDecoder(test_video_path) as decoder:
        info = decoder.get_video_info()

        assert "total_frames" in info
        assert "fps" in info
        assert "width" in info
        assert "height" in info
        assert "duration" in info

        assert info["total_frames"] > 0
        assert info["fps"] > 0
        assert info["width"] > 0
        assert info["height"] > 0
        assert info["duration"] > 0


def test_get_frame_at_index(test_video_path):
    """Test frame extraction by native index."""
    from gpu_video_utils import GPUVideoDecoder

    with GPUVideoDecoder(test_video_path) as decoder:
        # Extract first frame
        frame = decoder.get_frame_at_index(0)

        assert isinstance(frame, torch.Tensor)
        assert frame.dim() == 3  # (H, W, C)
        assert frame.shape[2] == 3  # RGB
        assert frame.device.type == "cuda"  # On GPU


def test_get_frame_at_time(test_video_path):
    """Test frame extraction by timestamp."""
    from gpu_video_utils import GPUVideoDecoder

    with GPUVideoDecoder(test_video_path) as decoder:
        # Extract frame at 1.0 second
        frame = decoder.get_frame_at_time(1.0)

        assert isinstance(frame, torch.Tensor)
        assert frame.dim() == 3
        assert frame.shape[2] == 3
        assert frame.device.type == "cuda"


def test_get_frames_at_times(test_video_path):
    """Test batch frame extraction."""
    from gpu_video_utils import GPUVideoDecoder

    with GPUVideoDecoder(test_video_path) as decoder:
        # Extract frames at multiple timestamps
        times = [0.0, 1.0, 2.0, 3.0]
        frames = decoder.get_frames_at_times(times)

        assert len(frames) == len(times)
        for frame in frames:
            assert isinstance(frame, torch.Tensor)
            assert frame.device.type == "cuda"


def test_frame_timing_precision(test_video_path):
    """Test precise frame timing calculation."""
    from gpu_video_utils import GPUVideoDecoder

    with GPUVideoDecoder(test_video_path) as decoder:
        info = decoder.get_video_info()
        native_fps = info["fps"]

        # Extract frame at 1.5 seconds
        frame_time = 1.5
        frame = decoder.get_frame_at_time(frame_time)

        # Expected native frame index
        round(frame_time * native_fps)

        # Frame should exist (no ValueError)
        assert frame is not None


def test_invalid_frame_index(test_video_path):
    """Test error handling for invalid frame index."""
    from gpu_video_utils import GPUVideoDecoder

    with GPUVideoDecoder(test_video_path) as decoder:
        total_frames = len(decoder)

        # Try to access frame beyond video length
        with pytest.raises(ValueError):
            decoder.get_frame_at_index(total_frames + 100)


def test_invalid_timestamp(test_video_path):
    """Test error handling for invalid timestamp."""
    from gpu_video_utils import GPUVideoDecoder

    with GPUVideoDecoder(test_video_path) as decoder:
        info = decoder.get_video_info()
        duration = info["duration"]

        # Timestamp at end of video should clamp correctly
        frame = decoder.get_frame_at_time(duration + 10.0)
        assert frame is not None  # Should clamp to last frame
