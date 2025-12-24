"""Command-line interface for video_utils."""

import time
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.live import Live
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
)

from . import __version__
from .frames import extract_frames_streaming, get_video_duration

app = typer.Typer(
    name="video_utils",
    help="Video processing utilities using FFmpeg",
    context_settings={"help_option_names": ["-h", "--help"]},
    add_completion=False,
)

console = Console(stderr=True)


def version_callback(value: bool) -> None:
    """Print version and exit if --version flag is provided."""
    if value:
        typer.echo(f"video_utils version {__version__}")
        raise typer.Exit()


@app.command()
def extract_streaming(
    video_path: Path = typer.Argument(
        ...,
        help="Path to input video file",
        exists=True,
        dir_okay=False,
        resolve_path=True,
    ),
    output_dir: Path = typer.Argument(
        ...,
        help="Directory to save extracted frames",
    ),
    rate_hz: float = typer.Option(
        0.1,
        "--rate",
        "-r",
        help="Frame sampling rate in Hz (frames per second)",
        min=0.001,
        max=60.0,
    ),
    crop: Optional[str] = typer.Option(
        None,
        "--crop",
        "-c",
        help="Crop region as 'x,y,width,height' (e.g., '100,200,800,600')",
    ),
    version: Optional[bool] = typer.Option(
        None,
        "--version",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Extract frames from video as streaming background process.

    Launches FFmpeg to extract frames at the specified rate. Frames are saved
    as they're extracted, allowing downstream processing to start immediately.

    \b
    Example:
        video_utils extract-streaming video.mp4 frames/ --rate 0.1
        video_utils extract-streaming video.mp4 frames/ --rate 0.5 --crop 100,200,800,600
    """
    console.print("[bold cyan]Frame Extraction (Streaming)[/bold cyan]")
    console.print(f"Input: {video_path}")
    console.print(f"Output: {output_dir}")
    console.print(f"Rate: {rate_hz} Hz ({1/rate_hz:.1f} seconds per frame)")

    # Parse crop box if provided
    crop_box = None
    if crop:
        try:
            parts = [int(x.strip()) for x in crop.split(",")]
            if len(parts) != 4:
                raise ValueError("Crop must have exactly 4 values")
            crop_box = tuple(parts)
            console.print(f"Crop: x={parts[0]}, y={parts[1]}, w={parts[2]}, h={parts[3]}")
        except ValueError as e:
            console.print(f"[red]Error:[/red] Invalid crop format: {e}")
            console.print("Expected format: 'x,y,width,height' (e.g., '100,200,800,600')")
            raise typer.Exit(1)

    console.print()

    try:
        # Get video duration to estimate frame count
        duration = get_video_duration(video_path)
        expected_frames = int(duration * rate_hz)
        console.print(f"Video duration: {duration:.1f}s")
        console.print(f"Expected frames: {expected_frames}")
        console.print()

        # Start FFmpeg extraction
        ffmpeg_process = extract_frames_streaming(
            video_path,
            output_dir,
            rate_hz=rate_hz,
            crop_box=crop_box,
        )

        # Monitor progress
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Extracting frames...", total=expected_frames)

            # Poll FFmpeg and count frames
            while ffmpeg_process.poll() is None:
                # Count frames extracted so far
                frame_count = len(list(output_dir.glob("frame_*.jpg")))
                progress.update(task, completed=frame_count)
                time.sleep(0.5)

            # Final count
            frame_count = len(list(output_dir.glob("frame_*.jpg")))
            progress.update(task, completed=frame_count)

        # Check for errors
        if ffmpeg_process.returncode != 0:
            console.print(f"[red]Error:[/red] FFmpeg failed with return code {ffmpeg_process.returncode}")
            raise typer.Exit(1)

        console.print(f"[green]✓[/green] Extracted {frame_count} frames")
        console.print(f"[green]✓[/green] Frames saved to {output_dir}")

    except FileNotFoundError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
