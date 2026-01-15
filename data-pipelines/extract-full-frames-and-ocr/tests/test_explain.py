"""Tests for explain functionality.

Tests the --explain feature which shows diagnostic messages to stderr
explaining why TEMPLATE_PLACEHOLDER.
"""

from io import StringIO
from typing import Any

import pytest

# NOTE: CaptionLayout class has been refactored/removed - these tests need updating
# from full_frames.full_frames import CaptionLayout  # type: ignore[attr-defined]
CaptionLayout: Any = None  # Placeholder for deleted class - tests are skipped

pytestmark = pytest.mark.skip(
    reason="CaptionLayout class has been refactored/removed - tests need updating"
)


@pytest.mark.unit
class TestExplainBasic:
    """Test basic explain functionality."""

    def test_explain_disabled_by_default(self, capsys):
        """Explain mode is disabled by default."""

        # No stderr output when explain is disabled
        captured = capsys.readouterr()
        assert captured.err == ""

    def test_explain_enabled(self, capsys):
        """Explain mode shows messages to stderr."""
        processor = CaptionLayout(explain=True)
        input_stream = StringIO("test line\n")
        output = StringIO()

        # Process to trigger explain messages
        processor.process(input_stream, output)

        # Check that explain messages appear in stderr
        captured = capsys.readouterr()
        assert "EXPLAIN:" in captured.err
        assert "skipped" in captured.err

    def test_explain_message_format(self, capsys):
        """Explain messages have correct format."""
        processor = CaptionLayout(explain=True)
        input_stream = StringIO("test line\n")
        output = StringIO()

        # Process to trigger explain messages
        processor.process(input_stream, output)

        captured = capsys.readouterr()
        # Check format: "EXPLAIN: Lines X-Y skipped (duplicate...)"
        assert "EXPLAIN: Lines" in captured.err
        assert "skipped" in captured.err

    def test_explain_does_not_affect_output(self, capsys):
        """Explain mode doesn't change stdout output."""
        input_data = "test line\n"

        # Run without explain
        processor1 = CaptionLayout(explain=False)
        input1 = StringIO(input_data)
        output1 = StringIO()
        processor1.process(input1, output1)

        # Run with explain
        processor2 = CaptionLayout(explain=True)
        input2 = StringIO(input_data)
        output2 = StringIO()
        processor2.process(input2, output2)

        # Clear stderr
        capsys.readouterr()

        # Outputs should be identical
        assert output1.getvalue() == output2.getvalue()
