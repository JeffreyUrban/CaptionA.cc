"""Core logic for processor."""

import sys
from typing import BinaryIO, Callable, Optional, TextIO, Union


class CaptionFrames:
    """
    TEMPLATE_PLACEHOLDER processor
    """

    def __init__(
        self,
        TEMPLATE_PLACEHOLDER: bool = False,
        explain: bool = False,
    ):
        """
        Initialize processor.

        Args:
            TEMPLATE_PLACEHOLDER: If True, TEMPLATE_PLACEHOLDER: TEMPLATE_PLACEHOLDER
                       (default: False)
            explain: If True, output explanations to stderr showing why TEMPLATE_PLACEHOLDER
                    (default: False)
        """
        self.TEMPLATE_PLACEHOLDER = TEMPLATE_PLACEHOLDER  # Inverse mode: keep duplicates, remove unique
        self.explain = explain  # Show explanations to stderr

    def _print_explain(self, message: str) -> None:
        """Print explanation message to stderr if explain mode is enabled.

        Args:
            message: The explanation message to print
        """
        if self.explain:
            print(f"EXPLAIN: {message}", file=sys.stderr)

    def process(
        self,
        stream: Union[TextIO, BinaryIO],
        output: Union[TextIO, BinaryIO],
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> None:
        """
        Process input stream and write to output.

        Args:
            stream: Input stream to read from
            output: Output stream to write to
            progress_callback: Optional callback for progress updates
        """
        # Simple passthrough - just echo lines back
        line_num = 0
        skipped = 0
        for line in stream:
            output.write(line)  # type: ignore[arg-type]
            line_num += 1

            # Template TEMPLATE_PLACEHOLDER - show explain messages
            if line_num == 1:
                self._print_explain(f"Lines {line_num} skipped (TEMPLATE_PLACEHOLDER)")

            if progress_callback:
                progress_callback(line_num, skipped)

    def flush(self, output: Union[TextIO, BinaryIO]) -> None:
        """
        Flush any buffered output.

        Args:
            output: Output stream to flush to
        """
        # Nothing to flush in simple template
        pass

    def get_stats(self) -> dict[str, Union[int, float]]:
        """
        Get TEMPLATE_PLACEHOLDER statistics.

        Returns:
            Dictionary with keys: TEMPLATE_PLACEHOLDER
        """
        return {
            "TEMPLATE_PLACEHOLDER": 0,
        }
