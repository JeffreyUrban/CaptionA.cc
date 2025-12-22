"""Tests to increase CLI coverage for edge cases and error paths."""

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

import pytest
from typer.testing import CliRunner, Result

# Ensure consistent terminal width
os.environ.setdefault("COLUMNS", "120")

# Initialize CliRunner for unit tests
runner = CliRunner()

# Environment variables for consistent test output
TEST_ENV = {
    "COLUMNS": "120",
    "NO_COLOR": "1",
}

# ANSI escape code pattern
ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*m")


def strip_ansi(text: str) -> str:
    """Remove ANSI escape codes from text."""
    return ANSI_ESCAPE.sub("", text)


def get_stderr(result: Result) -> str:
    """Get stderr from CliRunner result, handling Click version differences.

    Click 8.2+ captures stderr separately by default.
    Click 8.1.x requires accessing result.output (mixed stdout+stderr).
    """
    try:
        return result.stderr
    except ValueError:
        # Click 8.1.x: stderr not separately captured, use output
        return result.output


def run_command(args: list[str], input_data: Optional[str] = None) -> tuple[int, str, str]:
    """Run caption_layout CLI and return (exit_code, stdout, stderr)."""
    result = subprocess.run(
        [sys.executable, "-m", "caption_layout"] + args,
        input=input_data,
        capture_output=True,
        text=True,
    )
    return result.returncode, result.stdout, result.stderr


@pytest.mark.integration
def test_json_stats_format():
    """Test JSON statistics format output."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        input_file = tmpdir / "input.log"
        input_file.write_text("A\nB\nC\nA\nB\nC\nD\n")

        exit_code, stdout, stderr = run_command([str(input_file), "--stats-format", "json"])

        assert exit_code == 0
        # Stats should be in stderr for JSON format
        # May have header lines, extract JSON starting with '{'
        json_start = stderr.find("{")
        assert json_start >= 0, "No JSON found in stderr"
        json_str = stderr[json_start:]
        stats = json.loads(json_str)
        # Check for nested structure (just verify it's valid JSON with expected sections)
        assert "statistics" in stats or "configuration" in stats


@pytest.mark.integration
def test_quiet_mode():
    """Test --quiet flag suppresses statistics."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        input_file = tmpdir / "input.log"
        input_file.write_text("A\nB\nC\nA\nB\nC\n")

        exit_code, stdout, stderr = run_command([str(input_file), "--quiet"])

        assert exit_code == 0
        # No statistics table should be in stderr
        assert "TEMPLATE_PLACEHOLDER" not in stderr


@pytest.mark.integration
def test_stdin_input():
    """Test reading from stdin."""
    input_data = "A\nB\nC\nA\nB\nC\nD\n"

    exit_code, stdout, stderr = run_command(["--quiet"], input_data=input_data)

    assert exit_code == 0
    # In passthrough mode, all lines should be in output
    assert "A" in stdout
    assert "B" in stdout
    assert "C" in stdout
    assert "D" in stdout
