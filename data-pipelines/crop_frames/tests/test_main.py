"""Tests for __main__ module entry point."""

import subprocess
import sys

import pytest


@pytest.mark.integration
def test_main_module_execution(tmp_path):
    """Test running crop_frames as a module with python -m."""
    # Create test file
    test_file = tmp_path / "test.txt"
    test_file.write_text("\n".join([f"line{i}" for i in range(20)]) + "\n")

    # Run as module
    result = subprocess.run(
        [sys.executable, "-m", "crop_frames", str(test_file), "--quiet"],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert len(result.stdout.strip()) > 0


@pytest.mark.integration
def test_main_module_help():
    """Test python -m crop_frames --help."""
    result = subprocess.run(
        [sys.executable, "-m", "crop_frames", "--help"],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "deduplicate" in result.stdout.lower()
