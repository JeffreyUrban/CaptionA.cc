"""Command-line interface for caption_frames."""

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
from .caption_frames import extract_frames_from_episode, resize_frames_in_directory
from .streaming import stream_extract_and_resize, stream_extract_frames

app = typer.Typer(
    name="caption_frames",
    help="Extract and process video frames for caption regions",
    context_settings={"help_option_names": ["-h", "--help"]},
    add_completion=False,
)

console = Console(stderr=True)


def version_callback(value: bool) -> None:
    """Print version and exit if --version flag is provided."""
    if value:
        typer.echo(f"caption_frames version {__version__}")
        raise typer.Exit()


@app.command()
def extract_frames(
    episode_dir: Path = typer.Argument(
        ...,
        help="Episode directory containing video and subtitle_analysis.txt",
        exists=True,
        file_okay=False,
        resolve_path=True,
    ),
    video_filename: str = typer.Option(
        ...,
        "--video",
        "-v",
        help="Video filename in episode directory",
    ),
    analysis_filename: str = typer.Option(
        "subtitle_analysis.txt",
        "--analysis",
        "-a",
        help="Subtitle analysis filename (default: subtitle_analysis.txt)",
    ),
    output_subdir: str = typer.Option(
        "10Hz_cropped_frames",
        "--output-subdir",
        "-o",
        help="Output subdirectory name for extracted frames",
    ),
    rate_hz: float = typer.Option(
        10.0,
        "--rate-hz",
        "-r",
        help="Frame sampling rate in Hz (frames per second)",
    ),
    version: Optional[bool] = typer.Option(
        None,
        "--version",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Extract frames from video with cropping based on subtitle analysis.

    Reads subtitle_analysis.txt to determine crop region, then extracts frames
    at the specified rate with FFmpeg cropping applied during extraction.

    \b
    Example:
        caption_frames extract-frames /path/to/episode --video episode.mp4
        caption_frames extract-frames /path/to/episode --video ep01.mkv --rate-hz 10
    """
    console.print("[bold cyan]Caption Frame Extraction[/bold cyan]")
    console.print(f"Episode: {episode_dir}")
    console.print(f"Video: {video_filename}")
    console.print(f"Analysis: {analysis_filename}")
    console.print(f"Output: {output_subdir}")
    console.print(f"Rate: {rate_hz} Hz")
    console.print()

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Extracting frames...", total=None)

            def update_progress(current: int, total: int) -> None:
                progress.update(task, completed=current, total=total)

            output_dir, num_frames = extract_frames_from_episode(
                episode_dir,
                video_filename,
                analysis_filename,
                output_subdir,
                rate_hz=rate_hz,
                progress_callback=update_progress,
            )

        console.print(f"[green]✓[/green] Extracted {num_frames} frames to {output_dir}")

    except FileNotFoundError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def extract_and_resize(
    video_path: Path = typer.Argument(
        ...,
        help="Path to video file",
        exists=True,
        dir_okay=False,
        resolve_path=True,
    ),
    output_dir: Optional[Path] = typer.Option(
        None,
        "--output-dir",
        "-o",
        help="Output directory for frame subdirectories (default: same directory as video)",
        exists=False,
        file_okay=False,
        resolve_path=True,
    ),
    analysis_filename: str = typer.Option(
        "subtitle_analysis.txt",
        "--analysis",
        "-a",
        help="Analysis filename in same directory as video (default: subtitle_analysis.txt)",
    ),
    rate_hz: float = typer.Option(
        10.0,
        "--rate-hz",
        "-r",
        help="Frame sampling rate in Hz (frames per second)",
    ),
    width: int = typer.Option(
        480,
        "--width",
        "-w",
        help="Target width in pixels",
    ),
    height: int = typer.Option(
        48,
        "--height",
        help="Target height in pixels",
    ),
    preserve_aspect: bool = typer.Option(
        False,
        "--preserve-aspect/--stretch",
        help="Preserve aspect ratio with padding (default: stretch to fill)",
    ),
    keep_cropped: bool = typer.Option(
        True,
        "--keep-cropped/--delete-cropped",
        help="Keep intermediate cropped frames (default: keep both cropped and resized)",
    ),
    max_workers: int = typer.Option(
        4,
        "--max-workers",
        help="Maximum concurrent resize workers",
    ),
    version: Optional[bool] = typer.Option(
        None,
        "--version",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Extract and resize frames in one streaming pass (RECOMMENDED).

    This command combines frame extraction and resizing in a streaming pipeline,
    processing frames as they're extracted. Output directories are automatically
    created based on parameters:
    - Cropped: {rate_hz}Hz_cropped_frames
    - Resized: {rate_hz}Hz_{width}x{height}_frames

    By default, outputs to the same directory as the video. Use --output-dir to
    specify a different location.

    Benefits:
    - Faster overall (parallelized resize during extraction)
    - Single progress bar for entire operation
    - Conventional directory naming
    - Keeps both cropped and resized frames by default

    Use --delete-cropped to save disk space by removing intermediate frames.

    \b
    Example:
        # Extract and resize to 480x48 at 10Hz
        # Creates: 10Hz_cropped_frames/ and 10Hz_480x48_frames/ in same dir as video
        caption_frames extract-and-resize /path/to/video/episode.mp4

        # Custom output directory
        caption_frames extract-and-resize /path/to/video/episode.mp4 \\
          --output-dir /path/to/frames

        # Custom rate and dimensions
        # Creates: 5Hz_cropped_frames/ and 5Hz_640x64_frames/
        caption_frames extract-and-resize /path/to/video/show.mkv \\
          --rate-hz 5 \\
          --width 640 --height 64
    """
    # Get output directory (default to video's parent directory)
    if output_dir is None:
        output_dir = video_path.parent

    # Derive directory names from parameters
    rate_int = int(rate_hz) if rate_hz == int(rate_hz) else rate_hz
    cropped_subdir = f"{rate_int}Hz_cropped_frames"
    resized_subdir = f"{rate_int}Hz_{width}x{height}_frames"

    console.print("[bold cyan]Streaming Frame Extraction & Resize[/bold cyan]")
    console.print(f"Video: {video_path}")
    console.print(f"Output directory: {output_dir}")
    console.print(f"Analysis: {analysis_filename}")
    console.print(f"Rate: {rate_hz} Hz")
    console.print(f"Target size: {width}×{height}")
    console.print(f"Cropped output: {cropped_subdir}")
    console.print(f"Resized output: {resized_subdir}")
    console.print(f"Mode: {'preserve aspect' if preserve_aspect else 'stretch to fill'}")
    console.print(f"Keep cropped: {keep_cropped}")
    console.print()

    try:
        # Analysis file is in same directory as video (from caption_layout)
        analysis_path = video_path.parent / analysis_filename
        cropped_dir = output_dir / cropped_subdir
        resized_dir = output_dir / resized_subdir

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Processing frames...", total=None)

            def update_progress(current: int, total: int) -> None:
                progress.update(task, completed=current, total=total)

            num_frames = stream_extract_and_resize(
                video_path,
                analysis_path,
                cropped_dir,
                resized_dir,
                rate_hz=rate_hz,
                target_width=width,
                target_height=height,
                preserve_aspect=preserve_aspect,
                keep_cropped=keep_cropped,
                progress_callback=update_progress,
                max_workers=max_workers,
            )

        console.print(f"[green]✓[/green] Processed {num_frames} frames")
        console.print(f"  Cropped frames: {cropped_dir}")
        console.print(f"  Resized frames: {resized_dir}")
        if not keep_cropped:
            console.print(f"[dim]  (Cropped frames deleted to save space)[/dim]")

    except FileNotFoundError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def resize_frames(
    episode_dir: Path = typer.Argument(
        ...,
        help="Episode directory containing frames subdirectory",
        exists=True,
        file_okay=False,
        resolve_path=True,
    ),
    input_subdir: str = typer.Option(
        "10Hz_cropped_frames",
        "--input-subdir",
        "-i",
        help="Input subdirectory containing frames to resize",
    ),
    output_subdir: str = typer.Option(
        ...,
        "--output-subdir",
        "-o",
        help="Output subdirectory name for resized frames (e.g., '10Hz_480x48_frames')",
    ),
    width: int = typer.Option(
        480,
        "--width",
        "-w",
        help="Target width in pixels",
    ),
    height: int = typer.Option(
        48,
        "--height",
        "-h",
        help="Target height in pixels",
    ),
    preserve_aspect: bool = typer.Option(
        False,
        "--preserve-aspect/--stretch",
        help="Preserve aspect ratio with padding (default: stretch to fill)",
    ),
    version: Optional[bool] = typer.Option(
        None,
        "--version",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Resize all frames in a directory to fixed dimensions.

    Resizes frames using high-quality LANCZOS resampling. By default, stretches
    to fill target dimensions. Use --preserve-aspect to maintain aspect ratio with padding.

    \b
    Example:
        caption_frames resize-frames /path/to/episode --output-subdir 10Hz_480x48_frames
        caption_frames resize-frames /path/to/episode -i 10Hz_cropped_frames -o 10Hz_480x48_frames --width 480 --height 48
    """
    console.print("[bold cyan]Frame Resizing[/bold cyan]")
    console.print(f"Episode: {episode_dir}")
    console.print(f"Input: {input_subdir}")
    console.print(f"Output: {output_subdir}")
    console.print(f"Target size: {width}×{height}")
    console.print(f"Mode: {'preserve aspect' if preserve_aspect else 'stretch to fill'}")
    console.print()

    try:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Resizing frames...", total=None)

            def update_progress(current: int, total: int) -> None:
                progress.update(task, completed=current, total=total)

            output_dir, num_frames = resize_frames_in_directory(
                episode_dir,
                input_subdir,
                output_subdir,
                target_width=width,
                target_height=height,
                preserve_aspect=preserve_aspect,
                progress_callback=update_progress,
            )

        console.print(f"[green]✓[/green] Resized {num_frames} frames to {output_dir}")

    except FileNotFoundError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
