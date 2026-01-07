"""Tests for __main__ module entry point."""

import subprocess
import sys

import pytest


@pytest.mark.integration
def test_main_module_help():
    """Test python -m crop_frames --help."""
    result = subprocess.run(
        [sys.executable, "-m", "crop_frames", "--help"],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "extract" in result.stdout.lower() or "frames" in result.stdout.lower()


@pytest.mark.integration
def test_main_module_commands():
    """Test that commands are available."""
    result = subprocess.run(
        [sys.executable, "-m", "crop_frames", "--help"],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "extract-frames" in result.stdout.lower()
    assert "resize-frames" in result.stdout.lower()
