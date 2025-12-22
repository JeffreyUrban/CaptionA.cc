"""Command-line interface for caption-layout."""

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
from .analysis import (
    analyze_subtitle_region,
    create_analysis_visualization,
    load_ocr_annotations,
    save_analysis_text,
)
from .frames import extract_frames, get_video_duration
from .ocr import create_ocr_visualization, process_frames_directory

app = typer.Typer(
    name="caption-layout",
    help="Analyze the layout characteristics of burned-in captions in video",
    context_settings={"help_option_names": ["-h", "--help"]},
    add_completion=False,
)

console = Console(stderr=True)  # All output to stderr to preserve stdout for data


def version_callback(value: bool) -> None:
    """Print version and exit if --version flag is provided."""
    if value:
        typer.echo(f"caption-layout version {__version__}")
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
        help="Frame sampling rate in Hz (frames per second)",
    ),
    version: Optional[bool] = typer.Option(
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
    1. Extract frames from video
    2. Run OCR on frames
    3. Analyze subtitle region characteristics
    """
    console.print(f"[bold cyan]Caption Layout Analysis Pipeline[/bold cyan]")
    console.print(f"Video: {video}")
    console.print(f"Output: {output_dir}")
    console.print(f"Frame rate: {frame_rate} Hz")
    console.print()

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Step 1: Extract frames
        console.print("[bold]Step 1/3: Extracting frames[/bold]")
        frames_dir = output_dir / "frames" / "0.1Hz_full_frames"
        frames_dir.mkdir(parents=True, exist_ok=True)

        duration = get_video_duration(video)
        expected_frames = int(duration * frame_rate)
        console.print(f"  Video duration: {duration:.1f}s")
        console.print(f"  Expected frames: ~{expected_frames}")

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
                frames_dir,
                frame_rate,
                progress_callback=lambda current, total: progress.update(
                    task, completed=current
                ),
            )

        console.print(f"  [green]✓[/green] Extracted {len(frames)} frames")
        console.print()

        # Step 2: Run OCR
        console.print("[bold]Step 2/3: Running OCR[/bold]")
        ocr_output = output_dir / "OCR.jsonl"

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("  Processing...", total=len(frames))
            ocr_results = process_frames_directory(
                frames_dir,
                ocr_output,
                "zh-Hans",  # Default language
                progress_callback=lambda current, total: progress.update(
                    task, completed=current
                ),
            )

        console.print(f"  [green]✓[/green] OCR complete: {ocr_output}")

        # Create OCR visualization
        viz_output = output_dir / "OCR.png"
        create_ocr_visualization(ocr_results, viz_output, frames_dir)
        console.print(f"  [green]✓[/green] Visualization: {viz_output}")
        console.print()

        # Step 3: Analyze region
        console.print("[bold]Step 3/3: Analyzing subtitle region[/bold]")
        annotations = load_ocr_annotations(ocr_output)
        region = analyze_subtitle_region(annotations, frames[0])

        # Save analysis
        text_output = output_dir / "subtitle_analysis.txt"
        save_analysis_text(region, text_output)
        console.print(f"  [green]✓[/green] Analysis: {text_output}")

        # Create analysis visualization
        analysis_viz = output_dir / "subtitle_analysis.png"
        create_analysis_visualization(region, annotations, analysis_viz, frames[0])
        console.print(f"  [green]✓[/green] Visualization: {analysis_viz}")
        console.print()

        # Print final summary
        console.print("[bold green]Pipeline Complete![/bold green]")
        console.print()
        console.print("[bold cyan]Subtitle Layout Summary:[/bold cyan]")
        console.print(f"  Boxes analyzed: {region.total_boxes}")
        console.print(f"  Vertical position: {region.vertical_position:.3f}")
        console.print(f"  Box height: {region.box_height:.3f}")
        console.print(f"  Anchor: {region.anchor_type} at {region.anchor_position:.3f}")
        console.print(f"  Recommended crop: [{region.crop_left:.3f}, {region.crop_top:.3f}, {region.crop_right:.3f}, {region.crop_bottom:.3f}]")

    except (RuntimeError, FileNotFoundError, ValueError) as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error:[/red] Unexpected error: {e}")
        raise typer.Exit(1)


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
                progress_callback=lambda current, total: progress.update(
                    task, completed=current
                ),
            )

        console.print(f"[green]✓[/green] Extracted {len(frames)} frames to {output_dir}")

    except (RuntimeError, FileNotFoundError) as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


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

            results = process_frames_directory(
                frames_dir,
                ocr_output,
                language,
                progress_callback=lambda current, total: progress.update(
                    task, completed=current
                ),
            )

        console.print(f"[green]✓[/green] OCR results saved to {ocr_output}")

        # Create visualization
        console.print("Creating OCR visualization...")
        viz_output = output_dir / "OCR.png"
        create_ocr_visualization(results, viz_output, frames_dir)
        console.print(f"[green]✓[/green] Visualization saved to {viz_output}")

    except FileNotFoundError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def analyze_region(
    ocr_file: Path = typer.Argument(
        ...,
        help="Path to OCR.jsonl file",
        exists=True,
        dir_okay=False,
        resolve_path=True,
    ),
    output_dir: Path = typer.Option(
        Path("output"),
        "--output-dir",
        "-o",
        help="Directory for analysis output files",
    ),
) -> None:
    """Analyze subtitle region characteristics from OCR data.

    Analyzes OCR bounding boxes to determine:
    - Vertical position and height of subtitle region
    - Horizontal anchoring (left/center/right)
    - Crop coordinates for future processing

    Outputs:
    - subtitle_analysis.txt: Statistical summary
    - subtitle_analysis.png: Visualization with detected bounds
    """
    console.print(f"[bold]Analyzing subtitle region from {ocr_file.name}[/bold]")
    console.print(f"Output: {output_dir}")
    console.print()

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Load OCR annotations
        console.print("Loading OCR annotations...")
        annotations = load_ocr_annotations(ocr_file)
        console.print(f"Loaded {len(annotations)} frames with OCR data")
        console.print()

        # Find first frame for reference
        frames_dir = ocr_file.parent / "frames" / "0.1Hz_full_frames"
        if not frames_dir.exists():
            frames_dir = ocr_file.parent.parent / "frames" / "0.1Hz_full_frames"

        frame_files = sorted(frames_dir.glob("frame_*.jpg"))
        if not frame_files:
            console.print("[red]Error:[/red] No frames found for analysis")
            raise typer.Exit(1)

        # Analyze subtitle region
        console.print("Analyzing subtitle region characteristics...")
        region = analyze_subtitle_region(annotations, frame_files[0])

        # Save text analysis
        text_output = output_dir / "subtitle_analysis.txt"
        save_analysis_text(region, text_output)
        console.print(f"[green]✓[/green] Analysis saved to {text_output}")

        # Create visualization
        console.print("Creating analysis visualization...")
        viz_output = output_dir / "subtitle_analysis.png"
        create_analysis_visualization(
            region, annotations, viz_output, frame_files[0]
        )
        console.print(f"[green]✓[/green] Visualization saved to {viz_output}")

        # Print summary
        console.print()
        console.print("[bold cyan]Analysis Summary:[/bold cyan]")
        console.print(f"  Boxes analyzed: {region.total_boxes}")
        console.print(f"  Vertical position: {region.vertical_position:.3f}")
        console.print(f"  Box height: {region.box_height:.3f}")
        console.print(f"  Anchor: {region.anchor_type} at {region.anchor_position:.3f}")
        console.print(f"  Crop: [{region.crop_left:.3f}, {region.crop_top:.3f}, {region.crop_right:.3f}, {region.crop_bottom:.3f}]")

    except (ValueError, FileNotFoundError) as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
