"""Command-line interface for OCR development utilities.

Provides local development tools for frame extraction and OCR processing
without requiring GPU or cloud API access.
"""

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

app = typer.Typer(
    name="ocr",
    help="OCR development utilities for frame extraction and text recognition",
    context_settings={"help_option_names": ["-h", "--help"]},
    add_completion=False,
    rich_markup_mode="rich",
)

console = Console(stderr=True)


@app.command()
def extract_frames(
    video: Path = typer.Argument(
        ...,
        help="Path to video file",
        exists=True,
        dir_okay=False,
        resolve_path=True,
    ),
    output_dir: Path = typer.Option(
        Path("frames"),
        "--output-dir",
        "-o",
        help="Directory for extracted frames",
    ),
    frame_rate: float = typer.Option(
        0.1,
        "--frame-rate",
        "-r",
        help="Frame sampling rate in Hz (0.1 = one frame every 10 seconds)",
    ),
) -> None:
    """Extract frames from video at specified rate using FFmpeg.

    CPU-based frame extraction for development on machines without NVIDIA GPUs.
    """
    from video_utils import extract_frames as do_extract, get_video_duration

    console.print(f"[bold]Extracting frames from {video.name}[/bold]")
    console.print(f"Rate: {frame_rate} Hz")
    console.print(f"Output: {output_dir}")
    console.print()

    try:
        duration = get_video_duration(video)
        expected_frames = int(duration * frame_rate)
        console.print(f"Video duration: {duration:.1f}s")
        console.print(f"Expected frames: ~{expected_frames}")
        console.print()

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Extracting frames...", total=expected_frames)

            frames = do_extract(
                video,
                output_dir,
                frame_rate,
                progress_callback=lambda current, _: progress.update(task, completed=current),
            )

        console.print(f"[green]✓[/green] Extracted {len(frames)} frames to {output_dir}")

    except (RuntimeError, FileNotFoundError) as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1) from e


@app.command()
def run_livetext(
    frames_dir: Path = typer.Argument(
        ...,
        help="Directory containing frame images (frame_*.jpg)",
        exists=True,
        file_okay=False,
        resolve_path=True,
    ),
    output: Path = typer.Option(
        Path("ocr_results.jsonl"),
        "--output",
        "-o",
        help="Output JSONL file for OCR results",
    ),
    language: str = typer.Option(
        "zh-Hans",
        "--language",
        "-l",
        help="OCR language preference (e.g., 'zh-Hans', 'en')",
    ),
    visualize: bool = typer.Option(
        False,
        "--visualize",
        "-v",
        help="Create visualization of OCR bounding boxes",
    ),
) -> None:
    """Run OCR on frames using macOS LiveText.

    Processes all frame_*.jpg files in the directory. Requires macOS with
    the ocrmac package installed (pip install ocrmac).
    """
    import json
    from PIL import Image

    try:
        from .backends.livetext import LiveTextBackend
    except ImportError:
        console.print("[red]Error:[/red] LiveText backend requires macOS with ocrmac installed")
        console.print("Install with: pip install ocrmac")
        raise typer.Exit(1)

    console.print(f"[bold]Running LiveText OCR on {frames_dir.name}[/bold]")
    console.print(f"Language: {language}")
    console.print(f"Output: {output}")
    console.print()

    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    if not frame_files:
        console.print("[red]Error:[/red] No frame_*.jpg files found in directory")
        raise typer.Exit(1)

    console.print(f"Found {len(frame_files)} frames")

    # Get dimensions from first frame
    with Image.open(frame_files[0]) as img:
        width, height = img.size
    console.print(f"Frame dimensions: {width}×{height}")
    console.print()

    # Initialize backend
    backend = LiveTextBackend()

    # Process frames
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Processing OCR...", total=len(frame_files))

        with output.open("w") as f:
            for frame_path in frame_files:
                # Read frame
                frame_bytes = frame_path.read_bytes()
                frame_id = frame_path.stem

                # Run OCR
                result = backend.process_single(frame_id, frame_bytes, language)

                # Convert to JSONL format
                annotations = []
                for char in result.characters:
                    annotations.append([
                        char.text,
                        1.0,  # LiveText doesn't provide confidence
                        [char.bbox.x, char.bbox.y, char.bbox.width, char.bbox.height]
                    ])

                record = {
                    "image_path": str(frame_path.relative_to(frames_dir.parent)),
                    "framework": "livetext",
                    "annotations": annotations,
                }
                json.dump(record, f, ensure_ascii=False)
                f.write("\n")

                progress.update(task, advance=1)

    console.print(f"[green]✓[/green] OCR results saved to {output}")

    # Create visualization if requested
    if visualize:
        from .visualization import create_ocr_visualization

        viz_output = output.with_suffix(".png")
        console.print("Creating visualization...")
        create_ocr_visualization(output, viz_output, width, height)
        console.print(f"[green]✓[/green] Visualization saved to {viz_output}")


@app.command()
def visualize(
    ocr_file: Path = typer.Argument(
        ...,
        help="Path to OCR results JSONL file",
        exists=True,
        dir_okay=False,
        resolve_path=True,
    ),
    output: Path = typer.Option(
        None,
        "--output",
        "-o",
        help="Output PNG file (default: same name as input with .png extension)",
    ),
    width: int = typer.Option(
        ...,
        "--width",
        "-w",
        help="Frame width in pixels",
    ),
    height: int = typer.Option(
        ...,
        "--height",
        "-h",
        help="Frame height in pixels",
    ),
) -> None:
    """Create visualization of OCR bounding boxes.

    Generates a heatmap-style image showing where text was detected across
    all frames. Filters out text appearing in >80% of frames (watermarks).
    """
    from .visualization import create_ocr_visualization

    if output is None:
        output = ocr_file.with_suffix(".png")

    console.print(f"[bold]Creating OCR visualization[/bold]")
    console.print(f"Input: {ocr_file}")
    console.print(f"Output: {output}")
    console.print(f"Dimensions: {width}×{height}")
    console.print()

    create_ocr_visualization(ocr_file, output, width, height)
    console.print(f"[green]✓[/green] Visualization saved to {output}")


if __name__ == "__main__":
    app()
