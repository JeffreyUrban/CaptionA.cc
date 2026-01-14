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
from .database import get_database_path
from .ocr_service import process_video_with_gpu_and_ocr_service
from gpu_video_utils import GPUVideoDecoder

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
    - OCR service running (see services/ocr-service/README.md)

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

        total_boxes = process_video_with_gpu_and_ocr_service(
            video_path=video,
            db_path=db_path,
            rate_hz=frame_rate,
            language=language,
            progress_callback=None,  # OCR service pipeline handles its own progress reporting
        )

        console.print()
        console.print(f"  [green]✓[/green] GPU extraction complete")
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


if __name__ == "__main__":
    app()
