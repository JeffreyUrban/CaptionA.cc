"""Pytest configuration and fixtures for extract-crop-frames-and-infer-extents tests."""

import pytest


def pytest_addoption(parser):
    """Add custom command-line options."""
    parser.addoption(
        "--run-modal",
        action="store_true",
        default=False,
        help="Run tests that require Modal deployment (requires Wasabi credentials and Modal setup)",
    )
    parser.addoption(
        "--full-video",
        action="store_true",
        default=False,
        help="Use full-length test video instead of short test video",
    )
    parser.addoption(
        "--batch-size",
        type=int,
        default=32,
        help="Inference batch size for pipelined tests (default: 32)",
    )


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers",
        "modal: mark test as requiring Modal deployment and Wasabi credentials",
    )
    config.addinivalue_line(
        "markers",
        "integration: mark test as integration test (slower, requires external services)",
    )


def pytest_collection_modifyitems(config, items):
    """Skip Modal tests unless --run-modal is provided."""
    if not config.getoption("--run-modal"):
        skip_modal = pytest.mark.skip(reason="need --run-modal option to run")
        for item in items:
            if "modal" in item.keywords:
                item.add_marker(skip_modal)


@pytest.fixture
def test_video_fixture(request):
    """Return the appropriate test video fixture based on --full-video flag."""
    if request.config.getoption("--full-video"):
        return "car-teardown-comparison-08.mp4"
    return "short-test.mp4"


@pytest.fixture
def batch_size(request):
    """Return the batch size from --batch-size flag."""
    return request.config.getoption("--batch-size")
