"""Test that MkDocs documentation builds successfully."""

import subprocess
from pathlib import Path


def test_mkdocs_build():
    """Test that mkdocs build completes without errors."""
    # Run from project root where mkdocs.yml is located
    project_root = Path(__file__).parent.parent

    result = subprocess.run(
        ["mkdocs", "build", "--strict"],
        capture_output=True,
        text=True,
        timeout=30,
        cwd=project_root,
    )

    assert result.returncode == 0, (
        f"mkdocs build failed with exit code {result.returncode}\n"
        f"STDOUT:\n{result.stdout}\n"
        f"STDERR:\n{result.stderr}"
    )
