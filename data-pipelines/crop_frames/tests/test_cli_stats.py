"""Tests for CLI statistics printing."""

import pytest

from crop_frames.cli import print_stats
from crop_frames.crop_frames import CaptionFrames


@pytest.mark.unit
def test_print_stats_normal():
    """Test print_stats with normal processor."""
    processor = CaptionFrames()

    # print_stats writes to stderr via rich Console
    # Just verify it doesn't crash
    print_stats(processor)


@pytest.mark.unit
def test_print_stats_empty():
    """Test print_stats with no lines processed."""
    processor = CaptionFrames()

    # print_stats should handle empty stats
    print_stats(processor)
