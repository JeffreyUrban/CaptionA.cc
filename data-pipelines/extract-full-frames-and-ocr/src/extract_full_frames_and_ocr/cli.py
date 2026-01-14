"""Command-line interface for full_frames."""

from pathlib import Path

import typer
from gpu_video_utils import GPUVideoDecoder
from rich.console import Console

from . import __version__
from .database import get_database_path
from .pipeline import process_video_with_gpu_and_ocr

app = typer.Typer(
    name="full_frames",
    help="Analyze the layout characteristics of burned-in captions in video",
    context_settings={"help_option_names": ["-h", "--help"]},
    add_completion=False,
)

console = Console(stderr=True)  # All output to stderr to preserve stdout for data


def version_callback(value: bool) -> None:
    """Print version and exit if --version flag is provided."""
    if value:
        typer.echo(f"full_frames version {__version__}")
        raise typer.Exit()


@app.command()
def analyze(
    video: Path = typer.Argument(
        ...,
        help="Path to video file",
        exists=True,
        dir_okay=False,
        resolve_path=True,
    ),
    output_dir: Path = typer.Option(
        Path("output"),
        "--output-dir",
        "-o",
        help="Directory for output files",
    ),
    frame_rate: float = typer.Option(
        0.1,
        "--frame-rate",
        "-r",
        help="Frame sampling rate in Hz (0.1 = one frame every 10 seconds)",
    ),
    language: str = typer.Option(
        "zh-Hans",
        "--language",
        "-l",
        help="OCR language preference (e.g., 'zh-Hans' for Simplified Chinese)",
    ),
    version: bool | None = typer.Option(
        None,
        "--version",
        "-v",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Analyze caption layout from video using GPU acceleration (full pipeline).

    This GPU-accelerated pipeline:
    1. Extracts frames using PyNvVideoCodec (GPU)
    2. Processes frames in batches with Google Vision API (OCR service)
    3. Stores results and frame images in fullOCR.db

    Requirements:
    - NVIDIA GPU with CUDA support
    - Google Cloud Vision API credentials configured

    Database Storage:
    - OCR results written to full_frame_ocr table
    - Frame images stored in full_frames table as BLOBs
    - Layout config in video_layout_config table

    Frame Indexing:
    - Frames saved with index = time_in_seconds * 10
    - Example: frame_0000000100.jpg = frame at 10 seconds
    """
    console.print("[bold cyan]GPU-Accelerated Caption Layout Analysis[/bold cyan]")
    console.print(f"Video: {video}")
    console.print(f"Output: {output_dir}")
    console.print(f"Frame rate: {frame_rate} Hz")
    console.print(f"Language: {language}")
    console.print()

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Get video info upfront using GPU decoder
        decoder = GPUVideoDecoder(video)
        video_info = decoder.get_video_info()
        width = video_info["width"]
        height = video_info["height"]
        duration = video_info["duration"]
        expected_frames = int(duration * frame_rate)
        decoder.close()

        console.print(f"  Video duration: {duration:.1f}s")
        console.print(f"  Video dimensions: {width}×{height}")
        console.print(f"  Expected frames: ~{expected_frames}")
        console.print()

        # Run GPU + OCR service pipeline
        console.print("[bold]Processing with GPU + OCR Service[/bold]")
        db_path = get_database_path(output_dir)

        total_boxes = process_video_with_gpu_and_ocr(
            video_path=video,
            db_path=db_path,
            rate_hz=frame_rate,
            language=language,
            progress_callback=None,  # Pipeline handles its own progress reporting
        )

        console.print()
        console.print("  [green]✓[/green] GPU extraction complete")
        console.print(f"  [green]✓[/green] OCR processing complete ({total_boxes} text boxes)")
        console.print(f"  [green]✓[/green] Results saved to: {db_path}")
        console.print()

        # Create minimal layout config
        console.print("[bold]Creating initial layout config[/bold]")
        console.print("  Layout analysis will be performed by ML model in web app...")

        # Write minimal layout config with frame dimensions
        import sqlite3

        conn = sqlite3.connect(db_path)
        try:
            conn.execute(
                """
                INSERT OR REPLACE INTO video_layout_config (
                    id, frame_width, frame_height,
                    crop_left, crop_top, crop_right, crop_bottom,
                    crop_region_version
                ) VALUES (1, ?, ?, 0, 0, ?, ?, 1)
            """,
                (width, height, width, height),
            )
            conn.commit()
        finally:
            conn.close()

        console.print("  [green]✓[/green] Initial config created")
        console.print()

        # Print final summary
        console.print("[bold green]Pipeline Complete![/bold green]")
        console.print()
        console.print("[bold cyan]Summary:[/bold cyan]")
        console.print(f"  Processed {expected_frames} frames")
        console.print(f"  Detected {total_boxes} text boxes")
        console.print(f"  Frame dimensions: {width}×{height}")
        console.print(f"  Database: {db_path}")

    except (RuntimeError, FileNotFoundError, ValueError) as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1) from e
    except Exception as e:
        console.print(f"[red]Error:[/red] Unexpected error: {e}")
        raise typer.Exit(1) from e


if __name__ == "__main__":
    app()
