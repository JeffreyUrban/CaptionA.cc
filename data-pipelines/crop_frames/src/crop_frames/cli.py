"""Command-line interface for crop_frames."""

from pathlib import Path

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
from .crop_frames import extract_frames as extract_frames_core
from .crop_frames import resize_frames as resize_frames_core
from .database import get_database_path, write_frames_to_database

app = typer.Typer(
    name="crop_frames",
    help="Extract and process video frames for caption regions",
    context_settings={"help_option_names": ["-h", "--help"]},
    add_completion=False,
)

console = Console(stderr=True)


def version_callback(value: bool) -> None:
    """Print version and exit if --version flag is provided."""
    if value:
        typer.echo(f"crop_frames version {__version__}")
        raise typer.Exit()


@app.command()
def extract_frames(
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
        help="Crop region as 'left,top,right,bottom' in pixels",
    ),
    rate: float = typer.Option(
        10.0,
        "--rate",
        "-r",
        help="Frame sampling rate in Hz",
    ),
    resize_width: int | None = typer.Option(
        None,
        "--resize-width",
        help="Optional: resize frames to this width",
    ),
    resize_height: int | None = typer.Option(
        None,
        "--resize-height",
        help="Optional: resize frames to this height",
    ),
    preserve_aspect: bool = typer.Option(
        False,
        "--preserve-aspect/--stretch",
        help="Preserve aspect ratio when resizing (default: stretch)",
    ),
    write_to_db: bool = typer.Option(
        False,
        "--write-to-db",
        help="Write frames to database and cleanup filesystem frames",
    ),
    crop_region_version: int = typer.Option(
        1,
        "--crop-region-version",
        help="Crop region version from video_layout_config (required if --write-to-db)",
    ),
    version: bool | None = typer.Option(
        None,
        "--version",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Extract frames from video with optional cropping and resizing.

    Crop coordinates specify the region to extract in pixel coordinates.
    Optionally resize extracted frames to a target size.
    Optionally run OCR on cropped frames and write to database.

    \b
    Example (extract only):
        crop_frames extract-frames video.mp4 ./output --crop "100,200,700,250"

    \b
    Example (extract, OCR, and write to database):
        crop_frames extract-frames video.mp4 ./output \\
          --crop "100,200,700,250" --run-ocr --write-to-db
    """
    # Parse crop region [left, top, right, bottom]
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
        console.print("Expected format: 'left,top,right,bottom' (e.g., '100,200,700,250')")
        raise typer.Exit(1) from None

    # Validate resize parameters
    resize_params = None
    if resize_width is not None or resize_height is not None:
        if resize_width is None or resize_height is None:
            console.print("[red]Error:[/red] Both --resize-width and --resize-height must be specified together")
            raise typer.Exit(1)
        resize_params = (resize_width, resize_height)

    console.print("[bold cyan]Frame Extraction[/bold cyan]")
    console.print(f"Video: {video_path}")
    console.print(f"Output: {output_dir}")
    console.print(f"Crop: [{left}, {top}, {right}, {bottom}]")
    console.print(f"Rate: {rate} Hz")
    if resize_params:
        console.print(f"Resize: {resize_width}×{resize_height}")
        console.print(f"Mode: {'preserve aspect' if preserve_aspect else 'stretch'}")
    if write_to_db:
        console.print(f"Database: Write to DB and cleanup (crop_region_version: {crop_region_version})")
    console.print()

    # Clear existing frames before processing (to avoid stale frames from previous runs)
    if output_dir.exists():
        console.print("[bold]Clearing existing frames...[/bold]")
        cleared_count = 0
        for frame_file in output_dir.glob("frame_*.jpg"):
            frame_file.unlink()
            cleared_count += 1
        if cleared_count > 0:
            console.print(f"  [green]✓[/green] Cleared {cleared_count} existing frames")
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

            result_dir, num_frames = extract_frames_core(
                video_path=video_path,
                output_dir=output_dir,
                crop_box=crop_box,
                rate_hz=rate,
                resize_to=resize_params,
                preserve_aspect=preserve_aspect,
                progress_callback=update_progress,
            )

        console.print(f"[green]✓[/green] Extracted {num_frames} frames to {result_dir}")

        # Write frames to database and cleanup if requested
        if write_to_db:
            console.print()
            console.print("[bold]Writing frames to database...[/bold]")

            db_path = get_database_path(result_dir)
            # Crop region as (left, top, right, bottom)
            crop_region_tuple = (left, top, right, bottom)

            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                TaskProgressColumn(),
                console=console,
            ) as progress:
                task = progress.add_task("Writing frames...", total=num_frames)

                frames_written = write_frames_to_database(
                    frames_dir=result_dir,
                    db_path=db_path,
                    crop_region=crop_region_tuple,
                    crop_region_version=crop_region_version,
                    progress_callback=lambda current, total: progress.update(task, completed=current),
                    delete_after_write=True,
                )

            console.print(f"  [green]✓[/green] Stored {frames_written} frames in database")
            console.print("  [green]✓[/green] Deleted filesystem frames")

            # Remove empty output directory
            if result_dir.exists() and not any(result_dir.iterdir()):
                result_dir.rmdir()
                console.print("  [green]✓[/green] Removed empty directory")

    except FileNotFoundError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1) from None
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1) from None


@app.command()
def resize_frames(
    input_dir: Path = typer.Argument(
        ...,
        help="Directory containing frames to resize",
        exists=True,
        file_okay=False,
        resolve_path=True,
    ),
    output_dir: Path = typer.Argument(
        ...,
        help="Output directory for resized frames",
    ),
    width: int = typer.Option(
        ...,
        "--width",
        "-w",
        help="Target width in pixels",
    ),
    height: int = typer.Option(
        ...,
        "--height",
        "-h",
        help="Target height in pixels",
    ),
    preserve_aspect: bool = typer.Option(
        False,
        "--preserve-aspect/--stretch",
        help="Preserve aspect ratio with padding (default: stretch to fill)",
    ),
    version: bool | None = typer.Option(
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
        crop_frames resize-frames ./input ./output --width 480 --height 48
        crop_frames resize-frames ./cropped ./resized -w 480 -h 48 --preserve-aspect
    """
    console.print("[bold cyan]Frame Resizing[/bold cyan]")
    console.print(f"Input: {input_dir}")
    console.print(f"Output: {output_dir}")
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

            result_dir, num_frames = resize_frames_core(
                input_dir=input_dir,
                output_dir=output_dir,
                target_width=width,
                target_height=height,
                preserve_aspect=preserve_aspect,
                progress_callback=update_progress,
            )

        console.print(f"[green]✓[/green] Resized {num_frames} frames to {result_dir}")

    except FileNotFoundError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1) from None
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1) from None


if __name__ == "__main__":
    app()
