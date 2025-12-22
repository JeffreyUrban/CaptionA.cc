"""Command-line interface for caption_frames."""

import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import typer
from image_utils import resize_image
from rich.console import Console
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
)
from video_utils import extract_frames_streaming

from . import __version__
from .caption_frames import extract_frames_from_episode, resize_frames_in_directory

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
    output_dir: Path = typer.Argument(
        ...,
        help="Output directory for frames",
    ),
    crop: str = typer.Option(
        ...,
        "--crop",
        "-c",
        help="Crop bounds as 'left,top,right,bottom' in pixels",
    ),
    rate: float = typer.Option(
        10.0,
        "--rate",
        "-r",
        help="Frame sampling rate in Hz",
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
) -> None:
    """Extract and resize frames in streaming fashion.

    \b
    Example:
        caption_frames extract-and-resize video.mp4 ./output \\
          --crop "100,200,700,250" --rate 10 --width 480 --height 48
    """
    # Parse crop bounds [left, top, right, bottom]
    try:
        parts = [int(x.strip()) for x in crop.split(",")]
        if len(parts) != 4:
            raise ValueError("Crop must have exactly 4 values")
        left, top, right, bottom = parts
        # Convert to x, y, width, height for FFmpeg
        x = left
        y = top
        crop_width = right - left
        crop_height = bottom - top
        crop_box = (x, y, crop_width, crop_height)
    except ValueError as e:
        console.print(f"[red]Error:[/red] Invalid crop format: {e}")
        console.print(
            "Expected format: 'left,top,right,bottom' (e.g., '100,200,700,250')"
        )
        raise typer.Exit(1)

    # Create output directories
    output_dir.mkdir(parents=True, exist_ok=True)
    cropped_dir = output_dir / "cropped"
    resized_dir = output_dir / "resized"

    console.print("[bold cyan]Streaming Frame Extraction & Resize[/bold cyan]")
    console.print(f"Video: {video_path}")
    console.print(f"Output: {output_dir}")
    console.print(f"Crop: [{left}, {top}, {right}, {bottom}]")
    console.print(f"Rate: {rate} Hz")
    console.print(f"Size: {width}×{height}")
    console.print()

    # Start FFmpeg extraction with cropping
    ffmpeg_process = extract_frames_streaming(
        video_path=video_path,
        output_dir=cropped_dir,
        rate_hz=rate,
        crop_box=crop_box,
    )

    # Process frames as they appear
    submitted_frames = set()
    current_count = 0

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Processing frames...", total=None)

        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {}
            ffmpeg_done = False

            while True:
                # Check for new frames
                frame_files = sorted(cropped_dir.glob("frame_*.jpg"))
                new_frames = [
                    frame for frame in frame_files if frame not in submitted_frames
                ]

                # Submit new frames to worker pool
                for frame_path in new_frames:
                    time.sleep(0.05)  # Ensure file is fully written
                    output_path = resized_dir / frame_path.name
                    future = executor.submit(
                        resize_image,
                        frame_path,
                        output_path,
                        target_size=(width, height),
                        preserve_aspect=False,
                    )
                    futures[future] = frame_path
                    submitted_frames.add(frame_path)

                # Collect completed results
                for future in list(futures.keys()):
                    if future.done():
                        frame_path = futures.pop(future)
                        try:
                            future.result()
                            current_count += 1
                            progress.update(task, completed=current_count)
                        except Exception as e:
                            console.print(f"ERROR processing {frame_path.name}: {e}")

                # Check if FFmpeg has completed
                if not ffmpeg_done:
                    poll_result = ffmpeg_process.poll()
                    if poll_result is not None:
                        ffmpeg_done = True

                # Exit when FFmpeg is done and all futures are complete
                if ffmpeg_done and not futures:
                    break

                time.sleep(0.1)

    # Check for FFmpeg errors
    if ffmpeg_process.returncode != 0:
        raise RuntimeError(
            f"FFmpeg failed with return code {ffmpeg_process.returncode}"
        )

    console.print(f"[green]✓[/green] Processed {current_count} frames")
    console.print(f"  Cropped: {cropped_dir}")
    console.print(f"  Resized: {resized_dir}")


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
