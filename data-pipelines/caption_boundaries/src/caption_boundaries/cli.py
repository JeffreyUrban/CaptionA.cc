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
    balanced_sampling: bool = typer.Option(
        True,
        "--balanced-sampling/--no-balanced-sampling",
        help="Use balanced sampling to undersample majority classes per epoch"
    ),
    sampling_ratio: float = typer.Option(
        3.0,
        "--sampling-ratio",
        help="Max ratio of majority to minority class (higher = more data per epoch)"
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
            balanced_sampling=balanced_sampling,
            sampling_ratio=sampling_ratio,
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
    confidence_threshold: float = typer.Option(0.8, "--confidence", help="Minimum prediction confidence"),
    ocr_confidence_min: float = typer.Option(0.7, "--ocr-min", help="Minimum OCR confidence"),
    output_json: Path = typer.Option(None, "--output", "-o", help="Save results to JSON file"),
    show_all_transitions: bool = typer.Option(False, "--all", help="Show all transitions (not just boundaries)"),
):
    """Run boundary prediction inference on a video.

    Examples:
        # Basic inference
        caption_boundaries infer local/data/61/61c3*/annotations.db --checkpoint local/models/caption_boundaries/experiments/production_baseline/checkpoints/best.pt

        # With quality checks
        caption_boundaries infer local/data/61/61c3*/annotations.db --checkpoint best.pt --confidence 0.9 --ocr-min 0.8

        # Save results to file
        caption_boundaries infer video.db --checkpoint best.pt --output results.json
    """
    from caption_boundaries.inference import BoundaryPredictor

    try:
        console.print(f"\n[cyan]Running inference on:[/cyan] {video_db}")
        console.print(f"[cyan]Model:[/cyan] {checkpoint}")
        console.print(f"[cyan]Confidence threshold:[/cyan] {confidence_threshold}")

        # Initialize predictor
        predictor = BoundaryPredictor(checkpoint_path=checkpoint)

        # Run prediction with quality checks
        results = predictor.predict_with_quality_checks(
            video_db_path=video_db,
            confidence_threshold=confidence_threshold,
            ocr_confidence_min=ocr_confidence_min,
        )

        # Display results
        console.print(f"\n[green]✓[/green] Found {results['num_boundaries']} boundaries")
        console.print(f"[yellow]⚠[/yellow] Flagged {results['num_flagged']} for quality issues")

        # Show boundaries
        if results['boundaries']:
            console.print("\n[cyan]Predicted Boundaries:[/cyan]")
            for i, boundary in enumerate(results['boundaries'], 1):
                console.print(
                    f"  {i}. Frames {boundary['frame1_index']} → {boundary['frame2_index']}: "
                    f"{boundary['predicted_label']} (conf={boundary['confidence']:.3f})"
                )

        # Show flagged boundaries
        if results['quality']['flagged_boundaries']:
            console.print("\n[yellow]Flagged Boundaries:[/yellow]")
            for boundary in results['quality']['flagged_boundaries']:
                console.print(
                    f"  Frames {boundary['frame1_index']} → {boundary['frame2_index']}: "
                    f"{', '.join(boundary['flags'])}"
                )

        # Save to file if requested
        if output_json:
            import json
            with open(output_json, 'w') as f:
                # Convert to JSON-serializable format
                json_results = {
                    'boundaries': results['boundaries'],
                    'quality_stats': results['quality']['quality_stats'],
                    'num_boundaries': results['num_boundaries'],
                    'num_flagged': results['num_flagged'],
                }
                json.dump(json_results, f, indent=2)
            console.print(f"\n[green]✓[/green] Results saved to {output_json}")

    except Exception as e:
        console.print(f"[red]✗ Inference failed:[/red] {e}")
        import traceback
        traceback.print_exc()
        raise typer.Exit(code=1)


@app.command()
def analyze(
    predictions_json: Path = typer.Argument(..., help="Path to predictions JSON file"),
    video_db: Path = typer.Option(..., "--video-db", help="Path to video annotations.db"),
    ocr_confidence_min: float = typer.Option(0.7, "--ocr-min", help="Minimum OCR confidence"),
):
    """Run quality checks on existing boundary predictions.

    Examples:
        # Analyze predictions from file
        caption_boundaries analyze predictions.json --video-db local/data/61/61c3*/annotations.db
    """
    from caption_boundaries.inference.quality_checks import run_quality_checks
    import json

    try:
        console.print(f"\n[cyan]Analyzing predictions from:[/cyan] {predictions_json}")

        # Load predictions
        with open(predictions_json, 'r') as f:
            data = json.load(f)
            boundaries = data.get('boundaries', [])

        if not boundaries:
            console.print("[yellow]⚠[/yellow] No boundaries found in file")
            return

        # Run quality checks
        quality_results = run_quality_checks(
            video_db_path=video_db,
            boundaries=boundaries,
            ocr_confidence_min=ocr_confidence_min,
        )

        # Display detailed results
        console.print(f"\n[cyan]Quality Analysis Results:[/cyan]")
        console.print(f"  Pass rate: {quality_results['pass_rate']*100:.1f}%")

        if quality_results['flagged_boundaries']:
            console.print(f"\n[yellow]Detailed Flags:[/yellow]")
            for boundary in quality_results['flagged_boundaries']:
                console.print(f"\n  Frames {boundary['frame1_index']} → {boundary['frame2_index']}:")
                for flag in boundary['flags']:
                    console.print(f"    • {flag}")

    except Exception as e:
        console.print(f"[red]✗ Analysis failed:[/red] {e}")
        import traceback
        traceback.print_exc()
        raise typer.Exit(code=1)


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
