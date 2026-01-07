"""Tests for CLI interface."""

import os
import re

import pytest
from typer.testing import CliRunner

from crop_frames.cli import app

# Ensure consistent terminal width for Rich formatting across all environments
os.environ.setdefault("COLUMNS", "120")

runner = CliRunner()

# Environment variables for consistent test output across all platforms
TEST_ENV = {
    "COLUMNS": "120",  # Consistent terminal width for Rich formatting
    "NO_COLOR": "1",  # Disable ANSI color codes for reliable string matching
}

# ANSI escape code pattern
ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*m")


def strip_ansi(text: str) -> str:
    """Remove ANSI escape codes from text."""
    return ANSI_ESCAPE.sub("", text)


@pytest.mark.unit
def test_cli_help():
    """Test --help output."""
    result = runner.invoke(app, ["--help"], env=TEST_ENV)
    assert result.exit_code == 0
    # Strip ANSI codes for reliable string matching across environments
    output = strip_ansi(result.stdout.lower())
    assert "extract" in output or "frames" in output


@pytest.mark.unit
def test_cli_commands_exist():
    """Test that expected commands exist."""
    result = runner.invoke(app, ["--help"], env=TEST_ENV)
    assert result.exit_code == 0
    output = strip_ansi(result.stdout.lower())
    assert "extract-frames" in output
    assert "resize-frames" in output


@pytest.mark.unit
def test_extract_frames_help():
    """Test extract-frames --help output."""
    result = runner.invoke(app, ["extract-frames", "--help"], env=TEST_ENV)
    assert result.exit_code == 0
    output = strip_ansi(result.stdout.lower())
    assert "video" in output


@pytest.mark.unit
def test_resize_frames_help():
    """Test resize-frames --help output."""
    result = runner.invoke(app, ["resize-frames", "--help"], env=TEST_ENV)
    assert result.exit_code == 0
    output = strip_ansi(result.stdout.lower())
    assert "resize" in output or "frames" in output
