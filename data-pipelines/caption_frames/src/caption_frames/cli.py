"""Command-line interface for caption_frames."""

import json
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Optional, TextIO

import typer
from rich.console import Console
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
)
from rich.table import Table

from . import __version__
from .caption_frames import (
    CaptionFrames,
)

app = typer.Typer(
    name="caption_frames",
    help="TEMPLATE_PLACEHOLDER",
    context_settings={"help_option_names": ["-h", "--help"]},
    add_completion=False,
)

console = Console(stderr=True)  # All output to stderr to preserve stdout for data


def version_callback(value: bool) -> None:
    """Print version and exit if --version flag is provided."""
    if value:
        typer.echo(f"caption_frames version {__version__}")
        raise typer.Exit()


def TEMPLATE_PLACEHOLDER(stream: TextIO) -> Iterator[str]:
    """Read TEMPLATE_PLACEHOLDER from stream

    Args:
        stream: Input stream (file or stdin)

    Yields:
        TEMPLATE_PLACEHOLDER
    """
    for _line in stream:
        yield "TEMPLATE_PLACEHOLDER"


def validate_arguments(
    stats_format: str,
) -> None:
    """Validate argument combinations and constraints.

    Args:
        stats_format: Statistics output format

    Raises:
        typer.BadParameter: If validation fails with clear message
    """

    # Validate stats format
    valid_formats = {"table", "json"}
    if stats_format not in valid_formats:
        raise typer.BadParameter(
            f"--stats-format must be one of {valid_formats}, got '{stats_format}'"
        )


@app.command()
def main(
    input_file: Optional[Path] = typer.Argument(
        None,
        help="Input file to deduplicate (reads from stdin if not specified)",
        exists=True,
        dir_okay=False,
    ),
    version: Optional[bool] = typer.Option(
        None,
        "--version",
        "-v",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
    # Input Format
    TEMPLATE_PLACEHOLDER: bool = typer.Option(
        False,
        "--TEMPLATE_PLACEHOLDER",
        "-b",
        help="TEMPLATE_PLACEHOLDER",
        rich_help_panel="TEMPLATE_PLACEHOLDER",
    ),
    # StdErr Control
    quiet: bool = typer.Option(
        False,
        "--quiet",
        "-q",
        help="Suppress statistics output to stderr",
        rich_help_panel="StdErr Control",
    ),
    progress: bool = typer.Option(
        False,
        "--progress",
        "-p",
        help="Show progress indicator (auto-disabled for pipes)",
        rich_help_panel="StdErr Control",
    ),
    stats_format: str = typer.Option(
        "table",
        "--stats-format",
        help="Statistics output format: 'table' (default, Rich table) or 'json' (machine-readable)",
        rich_help_panel="StdErr Control",
    ),
    explain: bool = typer.Option(
        False,
        "--explain",
        "-e",
        help="Show explanations to stderr for why lines were kept or skipped",
        rich_help_panel="StdErr Control",
    ),
) -> None:
    """
    TEMPLATE_PLACEHOLDER from streaming input.

    This tool TEMPLATE_PLACEHOLDER.

    \b
    Quick Start:
        caption_frames input.log > output.log              # TEMPLATE_PLACEHOLDER a file
        cat TEMPLATE_PLACEHOLDER | caption_frames                          # Use in pipeline

    \b
    More Examples:
        caption_frames --TEMPLATE_PLACEHOLDER
        caption_frames --quiet input.log > output.log      # No statistics

    \b
    Documentation:
        https://github.com/yourusername/caption_frames

    \b
    Report Issues:
        https://github.com/yourusername/caption_frames/issues
    """
    # Check if running interactively with no input
    if input_file is None and sys.stdin.isatty():
        console.print("[yellow]No input provided.[/yellow]")
        console.print("\n[bold]Usage:[/bold] caption_frames [FILE] or pipe data via stdin")
        console.print("\n[bold]Examples:[/bold]")
        console.print("  caption_frames input.log > output.log")
        console.print("  cat TEMPLATE_PLACEHOLDER | caption_frames")
        console.print("\n[dim]For full help: caption_frames --help[/dim]")
        raise typer.Exit(0)

    # Validate arguments
    validate_arguments(
        stats_format,
    )

    # Disable progress if outputting to a pipe
    show_progress = progress and sys.stdout.isatty()

    if input_file is not None:
        # File mode
        if not quiet:
            console.print(
                "[dim]Auto-detected file input: using TEMPLATE_PLACEHOLDER "
                "(override with --TEMPLATE_PLACEHOLDER)[/dim]"
            )
    else:
        # Streaming mode
        pass

    if TEMPLATE_PLACEHOLDER:
        pass
    else:
        pass

    # Create processor
    processor = CaptionFrames(
        explain=explain,
    )

    try:
        if show_progress:
            # Create progress display
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                TaskProgressColumn(),
                console=console,
                transient=True,
            ) as progress_bar:
                task = progress_bar.add_task(
                    "Processing TEMPLATE_PLACEHOLDER...",
                    total=None,
                    skipped=0,
                )

                def update_progress(line_num: int, lines_skipped: int) -> None:
                    progress_bar.update(
                        task,
                        completed=line_num,
                        skipped=lines_skipped,
                    )

                # Process with progress
                if input_file:
                    with input_file.open("r") as f:
                        processor.process(f, sys.stdout, progress_callback=update_progress)
                else:
                    processor.process(sys.stdin, sys.stdout, progress_callback=update_progress)
        else:
            # Process without progress
            if input_file:
                with input_file.open("r") as f:
                    processor.process(f, sys.stdout, progress_callback=None)
            else:
                processor.process(sys.stdin, sys.stdout, progress_callback=None)

        # Print stats to stderr unless quiet
        if not quiet:
            if stats_format == "json":
                print_stats_json(processor)
            else:
                print_stats(processor)

    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted by user[/yellow]")
        # Flush what we have
        if TEMPLATE_PLACEHOLDER:
            processor.flush(sys.stdout.buffer)
        else:
            processor.flush(sys.stdout)
        if not quiet:
            if stats_format == "json":
                print_stats_json(processor)
            else:
                console.print("[dim]Partial statistics:[/dim]")
                print_stats(processor)
        raise typer.Exit(1) from None
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1) from e


def print_stats(processor: CaptionFrames) -> None:
    """Print TEMPLATE_PLACEHOLDER statistics using rich."""
    stats = processor.get_stats()

    if stats["TEMPLATE_PLACEHOLDER"] == 0:
        console.print("[yellow]TEMPLATE_PLACEHOLDER[/yellow]")
        return

    # Create stats table
    table = Table(title="TEMPLATE_PLACEHOLDER Statistics", show_header=True, header_style="bold cyan")
    table.add_column("Metric", style="cyan", no_wrap=True)
    table.add_column("Value", justify="right", style="green")

    table.add_row("TEMPLATE_PLACEHOLDER", f"{stats['TEMPLATE_PLACEHOLDER']:,}")

    console.print()
    console.print(table)
    console.print()


def print_stats_json(processor: CaptionFrames) -> None:
    """Print TEMPLATE_PLACEHOLDER statistics as JSON to stderr."""
    stats = processor.get_stats()

    output = {
        "statistics": stats,
        "configuration": {
            "TEMPLATE_PLACEHOLDER": processor.TEMPLATE_PLACEHOLDER,
        },
    }

    # Print to stderr (console already configured for stderr)
    print(json.dumps(output, indent=2), file=sys.stderr)


if __name__ == "__main__":
    app()
