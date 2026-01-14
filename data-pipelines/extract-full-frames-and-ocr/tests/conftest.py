"""Pytest configuration and shared fixtures."""

import shutil
import sys
import tempfile
from pathlib import Path

import pytest


def pytest_addoption(parser):
    """Add custom command-line options."""
    parser.addoption(
        "--full-video",
        action="store_true",
        default=False,
        help="Use full-length test video instead of short test video",
    )
    parser.addoption(
        "--run-gpu-tests",
        action="store_true",
        default=False,
        help="Run GPU tests (requires CUDA and Wasabi credentials)",
    )


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers",
        "gpu: mark test as requiring GPU (CUDA required)",
    )
    config.addinivalue_line(
        "markers",
        "integration: mark test as integration test (slower, may require external services)",
    )


def pytest_collection_modifyitems(config, items):
    """Skip GPU tests unless --run-gpu-tests is provided."""
    if not config.getoption("--run-gpu-tests"):
        skip_gpu = pytest.mark.skip(reason="need --run-gpu-tests option to run")
        for item in items:
            if "gpu" in item.keywords:
                item.add_marker(skip_gpu)


@pytest.fixture
def temp_dir():
    """Temporary directory for test files."""
    dirpath = Path(tempfile.mkdtemp())
    yield dirpath
    shutil.rmtree(dirpath)


@pytest.fixture
def test_video_path(request, tmp_path):
    """Download test video from Wasabi and return local path.

    Uses same test fixtures as captionacc-modal tests:
    - short-test.mp4 (18s, ~184 frames at 10 Hz)
    - car-teardown-comparison-08.mp4 (full length)
    """
    # Import Wasabi service
    repo_root = Path(__file__).parent.parent.parent.parent
    sys.path.insert(0, str(repo_root / "services" / "api"))
    from app.config import get_settings
    from app.services.wasabi_service import WasabiServiceImpl

    settings = get_settings()
    wasabi = WasabiServiceImpl(
        access_key=settings.effective_wasabi_access_key,
        secret_key=settings.effective_wasabi_secret_key,
        bucket=settings.wasabi_bucket,
        region=settings.wasabi_region,
    )

    # Select test video based on --full-video flag
    if request.config.getoption("--full-video"):
        fixture_key = "test-fixtures/videos/car-teardown-comparison-08.mp4"
    else:
        fixture_key = "test-fixtures/videos/short-test.mp4"

    # Download to temp directory
    local_path = tmp_path / "test_video.mp4"
    wasabi.download_file(fixture_key, local_path)

    return local_path
