#!/usr/bin/env python3
"""Test frame extraction from WebM chunks.

This script tests the frame_extractor module by downloading a chunk
from Wasabi and extracting frames.
"""

import sys
from pathlib import Path

# Add src to path
src_path = Path(__file__).parent.parent / "src"
sys.path.insert(0, str(src_path))

from rich.console import Console  # noqa: E402

from caption_boundaries.inference.frame_extractor import (  # noqa: E402
    calculate_frame_offset,
    determine_modulo_for_frame,
)

console = Console()


def test_frame_offset_calculation():
    """Test frame offset calculation logic."""
    console.print("\n[cyan]Testing frame offset calculation...[/cyan]")

    test_cases = [
        # (frame_index, expected_modulo, expected_offset)
        (0, 16, 0),  # First frame in modulo 16
        (16, 16, 1),  # Second frame in modulo 16
        (32, 16, 2),  # Third frame in modulo 16
        (4, 4, 0),  # First frame in modulo 4 (not divisible by 16)
        (8, 4, 1),  # Second frame in modulo 4
        (1, 1, 0),  # First frame in modulo 1
        (2, 1, 1),  # Second frame in modulo 1
        (3, 1, 2),  # Third frame in modulo 1
    ]

    passed = 0
    for frame_idx, expected_modulo, expected_offset in test_cases:
        # Verify modulo detection
        detected_modulo = determine_modulo_for_frame(frame_idx)
        if detected_modulo != expected_modulo:
            console.print(
                f"[red]✗ Frame {frame_idx}: expected modulo {expected_modulo}, got {detected_modulo}[/red]"
            )
            continue

        # Verify offset calculation
        try:
            offset = calculate_frame_offset(frame_idx, detected_modulo)
            if offset == expected_offset:
                console.print(f"[green]✓ Frame {frame_idx}: modulo {detected_modulo}, offset {offset}[/green]")
                passed += 1
            else:
                console.print(
                    f"[red]✗ Frame {frame_idx}: expected offset {expected_offset}, got {offset}[/red]"
                )
        except ValueError as e:
            console.print(f"[red]✗ Frame {frame_idx}: {e}[/red]")

    console.print(f"\n[{'green' if passed == len(test_cases) else 'yellow'}]Passed {passed}/{len(test_cases)} tests[/]")


def main():
    """Run frame extraction tests."""
    console.print("[bold cyan]Frame Extraction Test Suite[/bold cyan]")

    test_frame_offset_calculation()

    console.print("\n[green]✅ Frame extraction tests complete![/green]")
    console.print("\n[yellow]Note: To test with real Wasabi chunks, you need:[/yellow]")
    console.print("  1. Wasabi credentials configured")
    console.print("  2. A video with cropped frames uploaded")
    console.print("  3. Signed URLs for chunks")


if __name__ == "__main__":
    main()
