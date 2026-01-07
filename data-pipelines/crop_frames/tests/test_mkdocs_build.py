"""Test that MkDocs documentation builds successfully."""

import pytest


@pytest.mark.skip(reason="No mkdocs.yml configured for this project")
def test_mkdocs_build():
    """Test that mkdocs build completes without errors."""
    pass
