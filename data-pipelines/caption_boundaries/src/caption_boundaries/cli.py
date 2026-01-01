"""Command-line interface for caption boundaries detection pipeline."""

from pathlib import Path

import typer
from rich.console import Console

app = typer.Typer(
    name="caption_boundaries",
    help="Caption boundary detection via deep learning on frame pair transitions",
    add_completion=False,
)

console = Console(stderr=True)


@app.command()
def train(
    dataset_id: int = typer.Argument(..., help="Training dataset ID"),
    experiment_name: str = typer.Option(..., "--name", "-n", help="Experiment name for W&B"),
    training_db: Path = typer.Option(
        Path("../../local/models/caption_boundaries/training.db"),
        "--db",
        help="Central training database"
    ),
    epochs: int = typer.Option(50, "--epochs", "-e", help="Number of training epochs"),
    batch_size: int = typer.Option(32, "--batch-size", "-b", help="Training batch size"),
    learning_rate: float = typer.Option(1e-4, "--lr", help="Learning rate"),
    transform_strategy: str = typer.Option(
        "mirror_tile",
        "--transform",
        help="Transform strategy: 'crop', 'mirror_tile', or 'adaptive'"
    ),
    ocr_viz_variant: str = typer.Option(
        "boundaries",
        "--ocr-viz",
        help="OCR visualization variant: 'boundaries', 'centers', 'both', or '3d_channels'"
    ),
    device: str = typer.Option(
        None,
        "--device",
        help="Device: 'cuda', 'mps', 'cpu', or None for auto-detect"
    ),
    wandb_project: str = typer.Option(
        "caption-boundary-detection",
        "--wandb-project",
        help="W&B project name"
    ),
    checkpoint_dir: Path = typer.Option(
        Path("../../local/models/caption_boundaries/experiments"),
        "--checkpoint-dir",
        help="Directory to save checkpoints"
    ),
):
    """Train caption boundary detection model with W&B tracking.

    Examples:
        # Basic training
        caption_boundaries train 1 --name exp_baseline --epochs 50

        # Custom configuration
        caption_boundaries train 1 --name exp_3d_viz --ocr-viz 3d_channels --epochs 100

        # Small batch for MPS (Mac M2)
        caption_boundaries train 1 --name exp_mps --batch-size 16 --device mps
    """
    from caption_boundaries.data.transforms import ResizeStrategy
    from caption_boundaries.training import CaptionBoundaryTrainer

    # Validate transform strategy
    try:
        strategy = ResizeStrategy(transform_strategy)
    except ValueError:
        console.print(f"[red]✗[/red] Invalid transform strategy: {transform_strategy}")
        console.print("Valid options: crop, mirror_tile, adaptive")
        raise typer.Exit(code=1)

    # Validate OCR viz variant
    valid_viz = ["boundaries", "centers", "both", "3d_channels"]
    if ocr_viz_variant not in valid_viz:
        console.print(f"[red]✗[/red] Invalid OCR visualization variant: {ocr_viz_variant}")
        console.print(f"Valid options: {', '.join(valid_viz)}")
        raise typer.Exit(code=1)

    try:
        # Initialize trainer
        trainer = CaptionBoundaryTrainer(
            dataset_id=dataset_id,
            experiment_name=experiment_name,
            training_db_path=training_db if training_db != Path("local/caption_boundaries_training.db") else None,
            transform_strategy=strategy,
            ocr_viz_variant=ocr_viz_variant,
            use_font_embedding=True,
            epochs=epochs,
            batch_size=batch_size,
            learning_rate=learning_rate,
            device=device,
            wandb_project=wandb_project,
            checkpoint_dir=checkpoint_dir,
        )

        # Run training
        trainer.train()

    except Exception as e:
        console.print(f"[red]✗ Training failed:[/red] {e}")
        import traceback
        traceback.print_exc()
        raise typer.Exit(code=1)


@app.command()
def infer(
    video_db: Path = typer.Argument(..., help="Path to video annotations.db"),
    checkpoint: Path = typer.Option(..., "--checkpoint", "-c", help="Model checkpoint path"),
    model_version: str = typer.Option("v1.0", "--version", help="Model version identifier"),
    batch_size: int = typer.Option(64, "--batch-size", "-b", help="Inference batch size"),
):
    """Run boundary prediction inference on a video."""
    console.print(f"[cyan]Running inference on:[/cyan] {video_db}")
    console.print(f"Model: {checkpoint} (version: {model_version})")

    # TODO: Implement inference pipeline
    console.print("[yellow]⚠[/yellow] Inference not yet implemented")


@app.command()
def analyze(
    video_db: Path = typer.Argument(..., help="Path to video annotations.db"),
    confidence_threshold: float = typer.Option(0.7, "--threshold", "-t", help="Low confidence threshold"),
):
    """Run quality checks on boundary predictions."""
    console.print(f"[cyan]Analyzing predictions in:[/cyan] {video_db}")
    console.print(f"Confidence threshold: {confidence_threshold}")

    # TODO: Implement quality checks
    console.print("[yellow]⚠[/yellow] Analysis not yet implemented")


@app.command()
def create_dataset(
    name: str = typer.Argument(..., help="Dataset name"),
    video_dirs: list[Path] = typer.Argument(..., help="Paths to video directories (glob patterns supported)"),
    training_db: Path = typer.Option(
        Path("../../local/models/caption_boundaries/training.db"),
        "--db",
        help="Central training database"
    ),
    split_strategy: str = typer.Option(
        "random",
        "--split",
        help="Split strategy: 'random' or 'show_based'"
    ),
    train_ratio: float = typer.Option(
        0.8,
        "--train-ratio",
        help="Fraction of data for training (default: 0.8)"
    ),
    random_seed: int = typer.Option(
        42,
        "--seed",
        help="Random seed for reproducibility"
    ),
    description: str = typer.Option(
        None,
        "--description",
        "-d",
        help="Dataset description"
    ),
):
    """Create training dataset from annotated videos.

    Extracts frame pairs from confirmed caption boundaries in the specified
    video directories. Supports glob patterns like 'local/data/*/*/annotations.db'.

    Examples:
        # Single video
        caption_boundaries create-dataset my_dataset local/data/61/61c3123f-*/

        # Multiple videos with glob
        caption_boundaries create-dataset my_dataset 'local/data/*/*/'

        # Specific videos
        caption_boundaries create-dataset my_dataset local/data/61/*/ local/data/95/*/
    """
    from caption_boundaries.data.dataset_builder import create_training_dataset

    # Expand glob patterns and find annotations.db files
    video_db_paths = []
    for pattern in video_dirs:
        if '*' in str(pattern):
            # Glob pattern
            import glob
            matches = glob.glob(str(pattern))
            for match in matches:
                db_path = Path(match) / "annotations.db"
                if db_path.exists():
                    video_db_paths.append(db_path)
        else:
            # Direct path
            db_path = Path(pattern) / "annotations.db"
            if db_path.exists():
                video_db_paths.append(db_path)
            else:
                console.print(f"[yellow]⚠[/yellow] No annotations.db found in {pattern}")

    if not video_db_paths:
        console.print("[red]✗[/red] No valid video databases found")
        raise typer.Exit(code=1)

    console.print(f"Found {len(video_db_paths)} video databases")

    try:
        dataset_id = create_training_dataset(
            name=name,
            video_db_paths=video_db_paths,
            training_db_path=training_db if training_db != Path("local/caption_boundaries_training.db") else None,
            split_strategy=split_strategy,
            train_split_ratio=train_ratio,
            random_seed=random_seed,
            description=description,
        )

        console.print(f"\n[green]✓ Dataset created successfully![/green]")
        console.print(f"Dataset ID: {dataset_id}")
        console.print(f"Database: {training_db}")

    except Exception as e:
        console.print(f"[red]✗ Failed to create dataset:[/red] {e}")
        raise typer.Exit(code=1)


@app.command()
def version():
    """Show version information."""
    from caption_boundaries import __version__
    console.print(f"caption_boundaries version: {__version__}")


if __name__ == "__main__":
    app()
