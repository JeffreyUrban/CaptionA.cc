"""Tests for CLI statistics printing."""

import pytest

from caption_layout.caption_layout import CaptionLayout
from caption_layout.cli import print_stats


@pytest.mark.unit
def test_print_stats_normal():
    """Test print_stats with normal processor."""
    processor = CaptionLayout()

    # print_stats writes to stderr via rich Console
    # Just verify it doesn't crash
    print_stats(processor)


@pytest.mark.unit
def test_print_stats_empty():
    """Test print_stats with no lines processed."""
    processor = CaptionLayout()

    # print_stats should handle empty stats
    print_stats(processor)
