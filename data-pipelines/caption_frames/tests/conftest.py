"""Pytest configuration and shared fixtures."""

import shutil
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def temp_dir():
    """Temporary directory for test files."""
    dirpath = Path(tempfile.mkdtemp())
    yield dirpath
    shutil.rmtree(dirpath)
