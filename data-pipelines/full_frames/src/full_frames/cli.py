"""Command-line interface for full_frames."""

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
from .database import (
    get_database_path,
    process_frames_to_database,
    write_frames_to_database,
)
from .frames import extract_frames, get_video_dimensions, get_video_duration
from .ocr import create_ocr_visualization, process_frames_directory

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
    version: bool | None = typer.Option(
        None,
        "--version",
        "-v",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Analyze caption layout from video (full pipeline).

    This command runs all pipeline steps in sequence:
    1. Extract frames from video at specified rate
    2. Run OCR on frames and write to database (full_frame_ocr table)
    3. Rename frames to match database frame_index (multiply indices by 100)
    4. Analyze subtitle region characteristics

    Database Storage:
    - OCR results are written directly to captions.db (full_frame_ocr table)
    - Database location: {output_dir}/../captions.db
    - Example: output_dir=!__local/data/_has_been_deprecated__!/show/ep/full_frames → db=!__local/data/_has_been_deprecated__!/show/ep/captions.db

    Frame Indexing:
    - Database OCR samples at 10Hz (every 0.1 seconds)
    - full_frames samples at 0.1Hz (every 10 seconds) by default
    - Frames are saved as frame_0000000000.jpg, frame_0000000100.jpg, etc.
    - Frame filename index = time_in_seconds * 10
    - This allows 1:1 mapping with database frame_index values
    """
    console.print("[bold cyan]Caption Layout Analysis Pipeline[/bold cyan]")
    console.print(f"Video: {video}")
    console.print(f"Output: {output_dir}")
    console.print(f"Frame rate: {frame_rate} Hz")
    console.print()

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Get video info upfront
        duration = get_video_duration(video)
        expected_frames = int(duration * frame_rate)
        width, height = get_video_dimensions(video)

        console.print(f"  Video duration: {duration:.1f}s")
        console.print(f"  Video dimensions: {width}×{height}")
        console.print(f"  Expected frames: ~{expected_frames}")
        console.print()

        # Step 1: Extract frames directly to output directory
        console.print("[bold]Step 1/3: Extracting frames[/bold]")

        # Clear output directory to prevent double-renaming issues
        if output_dir.exists():
            console.print("  Clearing existing frames...")
            for frame_file in output_dir.glob("frame_*.jpg"):
                frame_file.unlink()

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("  Extracting...", total=expected_frames)
            frames = extract_frames(
                video,
                output_dir,
                frame_rate,
                progress_callback=lambda current, total: progress.update(task, completed=current),
            )

        console.print(f"  [green]✓[/green] Extracted {len(frames)} frames")

        # Rename frames to match database frame_index 1:1
        # Database samples at 10Hz (frame_index 0, 1, 2, ... = times 0.0s, 0.1s, 0.2s, ...)
        # full_frames samples at 0.1Hz (frames 0, 1, 2, ... = times 0s, 10s, 20s, ...)
        # Multiply full_frames indices by 100 to map: frame 0→0, frame 1→100, frame 2→200
        # Result: frame_0000000000.jpg, frame_0000000100.jpg, frame_0000000200.jpg, etc.
        # This creates 1:1 mapping where database frame_index maps directly to frame filename
        console.print("  Renaming frames to match database frame_index...")
        frame_files = sorted(output_dir.glob("frame_*.jpg"), reverse=True)
        for frame_file in frame_files:
            # Extract frame number from filename (e.g., "frame_0000000001.jpg" → 1)
            frame_num = int(frame_file.stem.split("_")[1])
            # Multiply by 100 to match database indexing (e.g., 1 → 100)
            new_index = frame_num * 100
            new_name = f"frame_{new_index:010d}.jpg"
            new_path = output_dir / new_name
            frame_file.rename(new_path)

        console.print(f"  [green]✓[/green] Frames saved: {output_dir}")
        console.print()

        # Step 2: Run OCR and write to database
        console.print("[bold]Step 2/3: Running OCR on frames[/bold]")
        db_path = get_database_path(output_dir)

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("  Processing OCR...", total=len(frames))
            total_boxes = process_frames_to_database(
                output_dir,
                db_path,
                "zh-Hans",
                progress_callback=lambda current, total: progress.update(task, completed=current),
            )

        console.print(f"  [green]✓[/green] OCR results: {db_path} ({total_boxes} boxes)")
        console.print()

        # Step 2.5: Write frames to database
        console.print("[bold]Step 2.5/3: Writing frames to database[/bold]")

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("  Writing frames...", total=len(frames))
            frames_written = write_frames_to_database(
                output_dir,
                db_path,
                progress_callback=lambda current, total: progress.update(task, completed=current),
                delete_after_write=True,
            )

        console.print(f"  [green]✓[/green] Stored {frames_written} frames in database")
        console.print("  [green]✓[/green] Deleted filesystem frames")

        # Remove empty output directory
        if output_dir.exists() and not any(output_dir.iterdir()):
            output_dir.rmdir()
            console.print("  [green]✓[/green] Removed empty directory")
        console.print()

        # Step 3/3: Create minimal layout config
        console.print("[bold]Step 3/3: Creating initial layout config[/bold]")
        console.print("  Layout analysis will be performed by ML model in web app...")

        # Write minimal layout config with just frame dimensions
        # Full layout (crop bounds, anchor, etc.) calculated by web app using ML model
        import sqlite3

        conn = sqlite3.connect(db_path)
        try:
            conn.execute(
                """
                INSERT OR REPLACE INTO video_layout_config (
                    id, frame_width, frame_height,
                    crop_left, crop_top, crop_right, crop_bottom,
                    crop_bounds_version
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
        console.print(f"  Extracted and analyzed {frames_written} frames")
        console.print(f"  Frame dimensions: {width}×{height}")
        console.print("  Layout analysis: Will be performed by ML model in web app")

    except (RuntimeError, FileNotFoundError, ValueError) as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1) from e
    except Exception as e:
        console.print(f"[red]Error:[/red] Unexpected error: {e}")
        raise typer.Exit(1) from e


@app.command()
def sample_frames(
    video: Path = typer.Argument(
        ...,
        help="Path to video file",
        exists=True,
        dir_okay=False,
        resolve_path=True,
    ),
    output_dir: Path = typer.Option(
        Path("output/frames"),
        "--output-dir",
        "-o",
        help="Directory for extracted frames",
    ),
    frame_rate: float = typer.Option(
        0.1,
        "--frame-rate",
        "-r",
        help="Frame sampling rate in Hz (frames per second)",
    ),
) -> None:
    """Extract frames from video at specified rate.

    Samples frames using FFmpeg at the specified rate (default: 0.1Hz = 1 frame every 10 seconds).
    """
    console.print(f"[bold]Extracting frames from {video.name}[/bold]")
    console.print(f"Rate: {frame_rate} Hz")
    console.print(f"Output: {output_dir}")
    console.print()

    try:
        # Get video info
        duration = get_video_duration(video)
        expected_frames = int(duration * frame_rate)
        console.print(f"Video duration: {duration:.1f}s")
        console.print(f"Expected frames: ~{expected_frames}")
        console.print()

        # Extract frames with progress
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Extracting frames...", total=expected_frames)

            frames = extract_frames(
                video,
                output_dir,
                frame_rate,
                progress_callback=lambda current, total: progress.update(task, completed=current),
            )

        console.print(f"[green]✓[/green] Extracted {len(frames)} frames to {output_dir}")

    except (RuntimeError, FileNotFoundError) as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1) from e


@app.command()
def run_ocr(
    frames_dir: Path = typer.Argument(
        ...,
        help="Directory containing extracted frames",
        exists=True,
        file_okay=False,
        resolve_path=True,
    ),
    output_dir: Path = typer.Option(
        Path("output"),
        "--output-dir",
        "-o",
        help="Directory for OCR output files",
    ),
    language: str = typer.Option(
        "zh-Hans",
        "--language",
        "-l",
        help="OCR language preference (e.g., 'zh-Hans' for Simplified Chinese)",
    ),
) -> None:
    """Run OCR on extracted frames using macOS LiveText.

    Processes all frames in the specified directory and outputs:
    - OCR.jsonl: OCR annotations with bounding boxes
    - OCR.png: Visualization of detected text boxes
    """
    console.print(f"[bold]Running OCR on frames in {frames_dir.name}[/bold]")
    console.print(f"Language: {language}")
    console.print(f"Output: {output_dir}")
    console.print()

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Count frames
        frame_files = sorted(frames_dir.glob("frame_*.jpg"))
        total_frames = len(frame_files)

        if total_frames == 0:
            console.print("[red]Error:[/red] No frames found in directory")
            raise typer.Exit(1)

        console.print(f"Found {total_frames} frames")
        console.print()

        # Get dimensions from first frame
        import cv2

        first_frame_img = cv2.imread(str(frame_files[0]))
        if first_frame_img is None:
            console.print(f"[red]Error:[/red] Failed to read {frame_files[0]}")
            raise typer.Exit(1)
        height, width = first_frame_img.shape[:2]
        console.print(f"Frame dimensions: {width}×{height}")
        console.print()

        # Process frames with OCR
        ocr_output = output_dir / "OCR.jsonl"

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Processing OCR...", total=total_frames)

            process_frames_directory(
                frames_dir,
                ocr_output,
                language,
                progress_callback=lambda current, total: progress.update(task, completed=current),
                keep_frames=True,  # Keep frames for standalone OCR command
            )

        console.print(f"[green]✓[/green] OCR results saved to {ocr_output}")

        # Create visualization
        console.print("Creating OCR visualization...")
        viz_output = output_dir / "OCR.png"
        create_ocr_visualization(ocr_output, viz_output, width, height)
        console.print(f"[green]✓[/green] Visualization saved to {viz_output}")

    except FileNotFoundError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1) from e
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1) from e


@app.command()
def analyze_region(
    ocr_file: Path = typer.Argument(
        ...,
        help="Path to OCR.jsonl file",
        exists=True,
        dir_okay=False,
        resolve_path=True,
    ),
    video: Path = typer.Option(
        None,
        "--video",
        help="Path to original video file (to get dimensions)",
        exists=True,
        dir_okay=False,
        resolve_path=True,
    ),
    width: int = typer.Option(
        None,
        "--width",
        help="Video width in pixels (if not providing --video)",
    ),
    height: int = typer.Option(
        None,
        "--height",
        help="Video height in pixels (if not providing --video)",
    ),
    output_dir: Path = typer.Option(
        Path("output"),
        "--output-dir",
        "-o",
        help="Directory for analysis output files",
    ),
) -> None:
    """DEPRECATED: Analyze subtitle region characteristics from OCR data.

    This command is deprecated because it used hardcoded heuristics (e.g., assuming
    subtitles are in the bottom third of the frame) which are not valid for all videos.

    Layout analysis is now performed by the ML box classification model in the web app.

    Migration path:
    1. Use 'full_frames analyze' command to process your video
    2. Open the video in the web app (http://localhost:5173)
    3. The ML model will automatically classify OCR boxes and calculate layout
    """
    console.print("[yellow]⚠ DEPRECATED COMMAND[/yellow]")
    console.print()
    console.print("This command has been deprecated because it relied on hardcoded heuristics")
    console.print("(e.g., assuming subtitles are in the bottom third of frame) which are")
    console.print("not valid for all videos.")
    console.print()
    console.print("[bold cyan]New Workflow:[/bold cyan]")
    console.print("1. Run: full_frames analyze <video> --output-dir <dir>")
    console.print("2. Open video in web app: http://localhost:5173")
    console.print("3. ML model automatically classifies boxes and calculates layout")
    console.print()
    console.print("The ML model uses 26 features and is trained on real data,")
    console.print("providing more accurate layout analysis than hardcoded rules.")
    raise typer.Exit(1)


if __name__ == "__main__":
    app()
