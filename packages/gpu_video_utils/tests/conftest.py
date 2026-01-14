"""Pytest configuration and fixtures for gpu_video_utils tests."""

import pytest


def pytest_addoption(parser):
    """Add custom command-line options."""
    parser.addoption(
        "--full-video",
        action="store_true",
        default=False,
        help="Use full-length test video instead of short test video",
    )


@pytest.fixture
def test_video_path(request, tmp_path):
    """Download test video from Wasabi and return local path.

    Uses same test fixtures as captionacc-modal tests:
    - short-test.mp4 (18s, ~184 frames at 10 Hz)
    - car-teardown-comparison-08.mp4 (full length)
    """
    import sys
    from pathlib import Path

    # Import Wasabi service
    sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent / "services" / "api"))
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
