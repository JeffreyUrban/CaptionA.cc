"""Command-line interface for ocr_utils."""

import sys
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
)

from . import __version__
from .processing import process_frames_directory, process_frames_streaming
from .visualization import create_ocr_visualization

app = typer.Typer(
    name="ocr_utils",
    help="OCR utilities for processing video frames using macOS LiveText",
    context_settings={"help_option_names": ["-h", "--help"]},
    add_completion=False,
)

console = Console(stderr=True)


def version_callback(value: bool) -> None:
    """Print version and exit if --version flag is provided."""
    if value:
        typer.echo(f"ocr_utils version {__version__}")
        raise typer.Exit()


@app.command()
def run(
    frames_dir: Path = typer.Argument(
        ...,
        help="Directory containing frame images to process",
        exists=True,
        file_okay=False,
        resolve_path=True,
    ),
    output_file: Path = typer.Argument(
        ...,
        help="Output JSONL file for OCR results",
    ),
    language: str = typer.Option(
        "zh-Hans",
        "--language",
        "-l",
        help="OCR language preference (e.g., 'zh-Hans' for Simplified Chinese, 'en' for English)",
    ),
    pattern: str = typer.Option(
        "frame_*.jpg",
        "--pattern",
        "-p",
        help="Glob pattern for frame files",
    ),
    max_workers: int = typer.Option(
        1,
        "--max-workers",
        "-w",
        help="Maximum number of parallel OCR workers (1 recommended for stability)",
    ),
    keep_frames: bool = typer.Option(
        True,
        "--keep-frames/--delete-frames",
        help="Keep frames after processing (default: keep)",
    ),
    visualize: bool = typer.Option(
        False,
        "--visualize",
        "-v",
        help="Create OCR visualization PNG after processing",
    ),
    width: Optional[int] = typer.Option(
        None,
        "--width",
        help="Frame width in pixels (required for visualization)",
    ),
    height: Optional[int] = typer.Option(
        None,
        "--height",
        help="Frame height in pixels (required for visualization)",
    ),
    version: Optional[bool] = typer.Option(
        None,
        "--version",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Run OCR on all frames in a directory.

    Processes all matching frames in the specified directory using macOS LiveText OCR,
    and outputs results as JSONL (one JSON object per line, one per frame).

    \b
    Example:
        ocr_utils run frames/ output.jsonl --language zh-Hans
        ocr_utils run cropped_frames/ ocr_cropped.jsonl --visualize --width 1920 --height 1080
    """
    console.print(f"[bold cyan]OCR Processing[/bold cyan]")
    console.print(f"Input: {frames_dir}")
    console.print(f"Output: {output_file}")
    console.print(f"Language: {language}")
    console.print(f"Pattern: {pattern}")
    console.print()

    try:
        # Count frames
        frame_files = sorted(frames_dir.glob(pattern))
        total_frames = len(frame_files)

        if total_frames == 0:
            console.print(f"[red]Error:[/red] No frames found matching pattern '{pattern}'")
            raise typer.Exit(1)

        console.print(f"Found {total_frames} frames")
        console.print()

        # Create output directory if needed
        output_file.parent.mkdir(parents=True, exist_ok=True)

        # Process frames with progress
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Processing OCR...", total=total_frames)

            first_frame = process_frames_directory(
                frames_dir,
                output_file,
                language,
                pattern=pattern,
                max_workers=max_workers,
                keep_frames=keep_frames,
                progress_callback=lambda current, total: progress.update(
                    task, completed=current
                ),
            )

        console.print(f"[green]✓[/green] Processed {total_frames} frames")
        console.print(f"[green]✓[/green] Results saved to {output_file}")

        # Create visualization if requested
        if visualize:
            if width is None or height is None:
                console.print(
                    "[yellow]Warning:[/yellow] --width and --height required for visualization, skipping"
                )
            else:
                console.print()
                console.print("Creating OCR visualization...")
                viz_output = output_file.parent / f"{output_file.stem}_viz.png"
                create_ocr_visualization(output_file, viz_output, width, height)
                console.print(f"[green]✓[/green] Visualization saved to {viz_output}")

    except FileNotFoundError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def run_streaming(
    frames_dir: Path = typer.Argument(
        ...,
        help="Directory to watch for frame images",
        exists=True,
        file_okay=False,
        resolve_path=True,
    ),
    output_file: Path = typer.Argument(
        ...,
        help="Output JSONL file for OCR results",
    ),
    language: str = typer.Option(
        "zh-Hans",
        "--language",
        "-l",
        help="OCR language preference (e.g., 'zh-Hans' for Simplified Chinese, 'en' for English)",
    ),
    max_workers: int = typer.Option(
        1,
        "--max-workers",
        "-w",
        help="Maximum number of parallel OCR workers (1 recommended for stability)",
    ),
    check_interval: float = typer.Option(
        0.1,
        "--check-interval",
        "-i",
        help="How often to check for new frames (seconds)",
    ),
    version: Optional[bool] = typer.Option(
        None,
        "--version",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Process frames as they appear in directory with streaming OCR.

    Watches the directory for new frames and processes them as they're created.
    Designed to work with streaming frame extraction (e.g., from FFmpeg).
    Frames are deleted after successful processing.

    \b
    Example:
        ocr_utils run-streaming frames/ output.jsonl --language zh-Hans
        ocr_utils run-streaming frames/ output.jsonl --max-workers 2
    """
    console.print("[bold cyan]OCR Processing (Streaming)[/bold cyan]")
    console.print(f"Input: {frames_dir}")
    console.print(f"Output: {output_file}")
    console.print(f"Language: {language}")
    console.print(f"Max workers: {max_workers}")
    console.print()

    try:
        # Create output directory if needed
        output_file.parent.mkdir(parents=True, exist_ok=True)

        # Track progress
        current_count = [0]  # Use list for mutable reference

        def progress_callback(count, total):
            current_count[0] = count
            console.print(f"\rProcessed {count} frames...", end="")

        console.print("Watching for frames...")

        # Process frames with streaming
        process_frames_streaming(
            frames_dir,
            output_file,
            language,
            max_workers=max_workers,
            progress_callback=progress_callback,
            check_interval=check_interval,
        )

        console.print()
        console.print(f"[green]✓[/green] Processed {current_count[0]} frames")
        console.print(f"[green]✓[/green] Results saved to {output_file}")

    except FileNotFoundError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
