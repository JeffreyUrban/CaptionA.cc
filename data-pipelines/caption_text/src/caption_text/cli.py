"""Command-line interface for caption_text pipeline."""

from pathlib import Path

import typer
from rich.console import Console

from . import __version__
from .database import (
    get_captions_needing_text,
    get_database_path,
    get_layout_config,
    save_vlm_inference_result,
)
from .ocr_comparison import compare_from_csv
from .text_vetting import extract_errors_from_vetting_results, vet_video_captions
from .vlm_inference import generate_caption, load_finetuned_model

app = typer.Typer(
    name="caption_text",
    help="VLM-based caption text extraction and correction pipeline",
    context_settings={"help_option_names": ["-h", "--help"]},
    add_completion=False,
)

console = Console(stderr=True)


def version_callback(value: bool) -> None:
    """Print version and exit if --version flag is provided."""
    if value:
        typer.echo(f"caption_text version {__version__}")
        raise typer.Exit()


@app.command()
def infer(
    video_dir: Path = typer.Argument(
        ...,
        help="Path to video directory (e.g., local/data/video_id/)",
        exists=True,
        dir_okay=True,
        file_okay=False,
        resolve_path=True,
    ),
    checkpoint: Path = typer.Option(
        ...,
        "--checkpoint",
        "-c",
        help="Path to fine-tuned model checkpoint (.ckpt)",
        exists=True,
    ),
    font_example: Path = typer.Option(
        ...,
        "--font-example",
        "-f",
        help="Path to font example image (for font style reference)",
        exists=True,
    ),
    output_csv: Path | None = typer.Option(
        None,
        "--output",
        "-o",
        help="Output CSV file (default: {video_dir}/vlm_inference_results.csv)",
    ),
    limit: int | None = typer.Option(
        None,
        "--limit",
        "-n",
        help="Maximum number of captions to process",
    ),
    version: bool | None = typer.Option(
        None,
        "--version",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Run VLM inference on captions needing text.

    Generates caption text using fine-tuned Qwen2.5-VL model with layout priors
    and font example. Saves results to database and optionally to CSV.

    Example:
        caption_text infer local/data/video_id \\
            --checkpoint models/qwen_finetuned.ckpt \\
            --font-example local/data/video_id/font_example.jpg
    """
    from PIL import Image
    from tqdm import tqdm

    # Get database and config
    db_path = get_database_path(video_dir)
    layout_config = get_layout_config(db_path)

    # Get captions needing text
    captions = get_captions_needing_text(db_path, limit=limit)
    console.print(f"Found {len(captions)} captions needing text")

    if not captions:
        console.print("[yellow]No captions need text annotation[/yellow]")
        return

    # Load model
    with console.status("[bold blue]Loading model..."):
        model_dict = load_finetuned_model(checkpoint)

    # Load font example image
    font_image = Image.open(font_example)

    # Set up output CSV
    if output_csv is None:
        output_csv = video_dir / "vlm_inference_results.csv"

    # Process captions
    results = {}

    with open(output_csv, "w") as f:
        for caption in tqdm(captions, desc="Generating captions"):
            start_frame = caption["start_frame_index"]
            end_frame = caption["end_frame_index"]

            # Load main image from cropped_frames
            # Note: Need to read from database
            from frames_db import get_frame_from_db

            frame_data = get_frame_from_db(db_path, start_frame, table="cropped_frames")
            if not frame_data:
                console.print(f"[yellow]Warning: No frame image for frame {start_frame}[/yellow]")
                continue

            main_image = frame_data.to_pil_image()

            # Generate caption
            try:
                caption_text = generate_caption(
                    model_dict=model_dict,
                    main_image=main_image,
                    font_example_image=font_image,
                    ocr_annotations=[],  # TODO: Use average cropped frame OCR when implemented
                    layout_config=layout_config,
                )

                # Save to database
                save_vlm_inference_result(
                    db_path=db_path,
                    caption_id=caption["id"],
                    vlm_text=caption_text,
                    source="vlm_finetuned",
                )

                # Save to CSV
                f.write(f"{start_frame},{end_frame},{caption_text}\n")
                f.flush()

                results[(start_frame, end_frame)] = caption_text

            except Exception as e:
                console.print(f"[red]Error processing caption {caption['id']}: {e}[/red]")
                continue

    console.print(f"[green]Successfully generated {len(results)} captions[/green]")
    console.print(f"Results saved to: {output_csv}")


@app.command()
def compare(
    video_dir: Path = typer.Argument(
        ...,
        help="Path to video directory",
        exists=True,
        dir_okay=True,
        file_okay=False,
        resolve_path=True,
    ),
    vlm_csv: Path | None = typer.Option(
        None,
        "--vlm-csv",
        help="Path to VLM results CSV (default: {video_dir}/vlm_inference_results.csv)",
    ),
    auto_validate: bool = typer.Option(
        True,
        "--auto-validate/--no-auto-validate",
        help="Automatically validate exact matches",
    ),
    version: bool | None = typer.Option(
        None,
        "--version",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Compare VLM results (legacy command - OCR comparison no longer available).

    Note: OCR data from cropped_frame_ocr is no longer available.
    This command is kept for backward compatibility but will report all captions
    as missing OCR data.

    Example:
        caption_text compare local/data/video_id
    """
    if vlm_csv is None:
        vlm_csv = video_dir / "vlm_inference_results.csv"

    if not vlm_csv.exists():
        console.print(f"[red]Error: VLM results CSV not found: {vlm_csv}[/red]")
        raise typer.Exit(1)

    console.print(f"Comparing VLM results from: {vlm_csv}")

    stats = compare_from_csv(
        video_dir=video_dir,
        vlm_csv_path=vlm_csv,
        auto_validate=auto_validate,
    )

    console.print("\n[bold]Comparison Results:[/bold]")
    console.print(f"  Total captions: {stats['total']}")
    console.print(f"  [green]Exact matches: {stats['matches']}[/green]")
    console.print(f"  [yellow]Mismatches: {stats['mismatches']}[/yellow]")
    console.print(f"  [red]Missing OCR: {stats['missing_ocr']}[/red]")

    if auto_validate:
        console.print(f"\n[green]✓ Auto-validated {stats['matches']} captions[/green]")


@app.command()
def vet(
    video_dir: Path = typer.Argument(
        ...,
        help="Path to video directory",
        exists=True,
        dir_okay=True,
        file_okay=False,
        resolve_path=True,
    ),
    output: Path | None = typer.Option(
        None,
        "--output",
        "-o",
        help="Output JSONL file (default: {video_dir}/caption_vetting_results.jsonl)",
    ),
    model: str = typer.Option(
        "claude-sonnet-4-5",
        "--model",
        "-m",
        help="LLM model name (for Anthropic or Ollama)",
    ),
    use_ollama: bool = typer.Option(
        False,
        "--ollama",
        help="Use Ollama instead of Anthropic API",
    ),
    context_size: int = typer.Option(
        5,
        "--context",
        help="Number of captions before/after for context",
    ),
    version: bool | None = typer.Option(
        None,
        "--version",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Vet caption text for transcription errors using LLM.

    Uses an LLM to check for character transcription errors, segment words,
    provide translations, and explain meaning in context.

    Example:
        caption_text vet local/data/video_id --model claude-sonnet-4-5
        caption_text vet local/data/video_id --ollama --model qwen3:14b
    """
    if output is None:
        output = video_dir / "caption_vetting_results.jsonl"

    console.print(f"Vetting captions using model: {model}")
    if use_ollama:
        console.print("Using Ollama API")
    else:
        console.print("Using Anthropic API")

    results = vet_video_captions(
        video_dir=video_dir,
        output_path=output,
        model=model,
        use_ollama=use_ollama,
        context_size=context_size,
    )

    console.print(f"\n[green]Successfully vetted {len(results)} captions[/green]")
    console.print(f"Results saved to: {output}")

    # Count errors
    errors = [r for r in results if r.get("has_error")]
    if errors:
        console.print(f"\n[yellow]Found {len(errors)} captions with potential errors[/yellow]")


@app.command()
def extract_errors(
    vetting_results: Path = typer.Argument(
        ...,
        help="Path to vetting results JSONL file",
        exists=True,
    ),
    output_csv: Path | None = typer.Option(
        None,
        "--output",
        "-o",
        help="Output CSV file (default: caption_errors.csv)",
    ),
    version: bool | None = typer.Option(
        None,
        "--version",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Extract captions with errors from vetting results.

    Reads vetting results JSONL and extracts entries with detected errors,
    writing them to a CSV file with suggested corrections.

    Example:
        caption_text extract-errors caption_vetting_results.jsonl -o errors.csv
    """
    if output_csv is None:
        output_csv = Path("caption_errors.csv")

    errors = extract_errors_from_vetting_results(
        vetting_results_path=vetting_results,
        output_csv_path=output_csv,
    )

    console.print(f"\n[yellow]Found {len(errors)} captions with errors[/yellow]")
    if errors:
        console.print(f"Errors saved to: {output_csv}")


@app.command()
def collect_data(
    data_root: Path = typer.Argument(
        ...,
        help="Root data directory (e.g., local/data/)",
        exists=True,
        dir_okay=True,
        file_okay=False,
        resolve_path=True,
    ),
    output_dir: Path = typer.Option(
        Path("training_data"),
        "--output",
        "-o",
        help="Output directory for training data manifest",
    ),
    save_images: bool = typer.Option(
        False,
        "--save-images",
        help="Save sample images for debugging",
    ),
    version: bool | None = typer.Option(
        None,
        "--version",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Collect training data from all confirmed text annotations.

    Scans all video directories in data root and collects confirmed text annotations
    for model training. Saves a manifest in JSONL format.

    Example:
        caption_text collect-data local/data --output training_data
    """
    from .training_data import collect_all_training_data, get_training_data_stats

    console.print(f"Collecting training data from: {data_root}")

    samples = collect_all_training_data(
        data_root=data_root,
        output_dir=output_dir,
        save_images=save_images,
    )

    if not samples:
        console.print("[red]No training samples found![/red]")
        raise typer.Exit(1)

    # Show statistics
    stats = get_training_data_stats(samples)

    console.print("\n[bold]Training Data Statistics:[/bold]")
    console.print(f"  Total samples: {stats['total_samples']}")
    console.print(f"  Unique videos: {stats['unique_videos']}")
    console.print(f"  Avg text length: {stats['avg_text_length']:.1f} chars")
    console.print(f"  Max text length: {stats['max_text_length']} chars")
    console.print(f"  Avg OCR count: {stats['avg_ocr_count']:.1f} boxes")

    console.print(f"\n[green]✓ Successfully collected {stats['total_samples']} training samples[/green]")
    console.print(f"Manifest saved to: {output_dir / 'training_manifest.jsonl'}")


@app.command()
def train(
    data_root: Path = typer.Argument(
        ...,
        help="Root data directory (e.g., local/data/)",
        exists=True,
        dir_okay=True,
        file_okay=False,
        resolve_path=True,
    ),
    output_dir: Path = typer.Option(
        Path("models/caption_text"),
        "--output",
        "-o",
        help="Output directory for model checkpoints",
    ),
    epochs: int = typer.Option(
        3,
        "--epochs",
        "-e",
        help="Number of training epochs",
    ),
    batch_size: int = typer.Option(
        4,
        "--batch-size",
        "-b",
        help="Batch size per device",
    ),
    learning_rate: float = typer.Option(
        2e-4,
        "--learning-rate",
        "-lr",
        help="Learning rate",
    ),
    val_split: float = typer.Option(
        0.1,
        "--val-split",
        help="Validation split ratio (0.0-1.0)",
    ),
    max_length: int = typer.Option(
        512,
        "--max-length",
        help="Maximum sequence length",
    ),
    accumulate_grad_batches: int = typer.Option(
        4,
        "--accumulate",
        help="Gradient accumulation steps",
    ),
    version: bool | None = typer.Option(
        None,
        "--version",
        callback=version_callback,
        is_eager=True,
        help="Show version and exit",
    ),
) -> None:
    """Train Qwen2.5-VL model on confirmed text annotations.

    Collects training data from all videos and fine-tunes the model with LoRA.
    Automatically handles data collection, training, and checkpoint saving.

    Example:
        caption_text train local/data \\
            --output models/caption_text \\
            --epochs 3 \\
            --batch-size 4
    """
    from .finetune import train_model
    from .training_data import collect_all_training_data, get_training_data_stats

    console.print("[bold]Step 1: Collecting training data[/bold]")
    samples = collect_all_training_data(data_root=data_root)

    if not samples:
        console.print("[red]No training samples found![/red]")
        raise typer.Exit(1)

    # Show statistics
    stats = get_training_data_stats(samples)
    console.print(f"\n  Total samples: {stats['total_samples']}")
    console.print(f"  Unique videos: {stats['unique_videos']}")
    console.print(f"  Avg text length: {stats['avg_text_length']:.1f} chars")

    console.print("\n[bold]Step 2: Training model[/bold]")
    console.print(f"  Epochs: {epochs}")
    console.print(f"  Batch size: {batch_size}")
    console.print(f"  Learning rate: {learning_rate}")
    console.print(f"  Validation split: {val_split:.1%}")

    best_checkpoint = train_model(
        samples=samples,
        output_dir=output_dir,
        epochs=epochs,
        batch_size=batch_size,
        learning_rate=learning_rate,
        val_split=val_split,
        max_length=max_length,
        accumulate_grad_batches=accumulate_grad_batches,
    )

    console.print("\n[green]✓ Training complete![/green]")
    console.print(f"Best checkpoint: {best_checkpoint}")
