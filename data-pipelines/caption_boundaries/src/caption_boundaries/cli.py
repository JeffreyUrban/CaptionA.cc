"""Command-line interface for caption boundaries detection pipeline."""

import subprocess
from pathlib import Path
from typing import Literal, cast

import typer
from rich.console import Console

app = typer.Typer(
    name="caption_boundaries",
    help="Caption boundary detection via deep learning on frame pair transitions",
    add_completion=False,
)

console = Console(stderr=True)


def get_project_root() -> Path:
    """Get the git repository root directory.

    Returns:
        Absolute path to the git root directory
    """
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
        )
        return Path(result.stdout.strip())
    except Exception:
        # Fallback: assume we're in data-pipelines/caption_boundaries/src/caption_boundaries
        # and go up to project root
        return Path(__file__).parent.parent.parent.parent.parent


@app.command()
def train(
    dataset_name: str = typer.Argument(..., help="Dataset name (e.g., 'my_dataset')"),
    experiment_name: str = typer.Option(..., "--name", "-n", help="Experiment name for W&B"),
    architecture: str = typer.Option(
        "triple_backbone_resnet50", "--architecture", "-a", help="Model architecture from registry"
    ),
    pretrained: bool = typer.Option(True, "--pretrained/--no-pretrained", help="Use ImageNet pretrained weights"),
    epochs: int = typer.Option(50, "--epochs", "-e", help="Number of training epochs"),
    batch_size: int = typer.Option(32, "--batch-size", "-b", help="Training batch size"),
    lr_features: float = typer.Option(1e-3, "--lr-features", help="Learning rate for feature extractor"),
    lr_classifier: float = typer.Option(1e-2, "--lr-classifier", help="Learning rate for classifier head"),
    transform_strategy: str = typer.Option(
        "mirror_tile", "--transform", help="Transform strategy: 'crop', 'mirror_tile', or 'adaptive'"
    ),
    ocr_viz_variant: str = typer.Option(
        "boundaries", "--ocr-viz", help="OCR visualization variant: 'boundaries', 'centers', 'both', or '3d_channels'"
    ),
    device: str = typer.Option(None, "--device", help="Device: 'cuda', 'mps', 'cpu', or None for auto-detect"),
    wandb_project: str = typer.Option("caption-boundary-detection", "--wandb-project", help="W&B project name"),
    checkpoint_dir: Path = typer.Option(
        None,
        "--checkpoint-dir",
        help="Directory to save checkpoints (default: {project_root}/local/models/caption_boundaries/experiments)",
    ),
    balanced_sampling: bool = typer.Option(
        True,
        "--balanced-sampling/--no-balanced-sampling",
        help="Use balanced sampling to undersample majority classes per epoch",
    ),
    max_samples_per_class: int = typer.Option(
        None,
        "--max-samples",
        help="Max samples per class per epoch (recommended for scaling). Overrides --sampling-ratio.",
    ),
    sampling_ratio: float = typer.Option(
        3.0, "--sampling-ratio", help="Max ratio of majority to minority class (legacy, for backward compat)"
    ),
):
    """Train caption boundary detection model with W&B tracking.

    Examples:
        # Cap-based sampling (recommended for scaling)
        caption_boundaries train my_dataset --name exp_baseline --max-samples 10000

        # Quick experiment (fast epochs)
        caption_boundaries train my_dataset --name quick_test --max-samples 5000 --epochs 10

        # Ratio-based sampling (legacy)
        caption_boundaries train my_dataset --name exp_ratio --sampling-ratio 3.0 --epochs 50

        # Disable balanced sampling (use all data)
        caption_boundaries train my_dataset --name exp_full --no-balanced-sampling --epochs 50
    """
    from caption_boundaries.data.transforms import ResizeStrategy
    from caption_boundaries.database import get_dataset_db_path
    from caption_boundaries.training import CaptionBoundaryTrainer

    # Set default checkpoint_dir if not provided
    if checkpoint_dir is None:
        project_root = get_project_root()
        checkpoint_dir = project_root / "local" / "models" / "caption_boundaries" / "experiments"

    # Get dataset database path
    dataset_db_path = get_dataset_db_path(dataset_name)
    if not dataset_db_path.exists():
        console.print(f"[red]✗[/red] Dataset '{dataset_name}' not found at {dataset_db_path}")
        console.print("Available datasets:")
        datasets_dir = dataset_db_path.parent
        if datasets_dir.exists():
            for db_file in datasets_dir.glob("*.db"):
                console.print(f"  - {db_file.stem}")
        raise typer.Exit(code=1)

    # Validate transform strategy
    try:
        strategy = ResizeStrategy(transform_strategy)
    except ValueError:
        console.print(f"[red]✗[/red] Invalid transform strategy: {transform_strategy}")
        console.print("Valid options: crop, mirror_tile, adaptive")
        raise typer.Exit(code=1) from None

    # Validate OCR viz variant
    valid_viz = ["boundaries", "centers", "both", "3d_channels"]
    if ocr_viz_variant not in valid_viz:
        console.print(f"[red]✗[/red] Invalid OCR visualization variant: {ocr_viz_variant}")
        console.print(f"Valid options: {', '.join(valid_viz)}")
        raise typer.Exit(code=1)

    try:
        # Initialize trainer
        trainer = CaptionBoundaryTrainer(
            dataset_db_path=dataset_db_path,
            experiment_name=experiment_name,
            architecture_name=architecture,
            model_config={"pretrained": pretrained},
            transform_strategy=strategy,
            ocr_viz_variant=ocr_viz_variant,
            epochs=epochs,
            batch_size=batch_size,
            lr_features=lr_features,
            lr_classifier=lr_classifier,
            device=device,
            wandb_project=wandb_project,
            checkpoint_dir=checkpoint_dir,
            balanced_sampling=balanced_sampling,
            max_samples_per_class=max_samples_per_class,
            sampling_ratio=sampling_ratio,
        )

        # Run training
        trainer.train()

    except Exception as e:
        console.print(f"[red]✗ Training failed:[/red] {e}")
        import traceback

        traceback.print_exc()
        raise typer.Exit(code=1) from e


# Removed: Local inference command deprecated
# Frame storage migrated from SQLite BLOBs to Wasabi VP9 chunks
# Use Modal serverless inference instead (see inference/service.py)


@app.command()
def analyze(
    predictions_json: Path = typer.Argument(..., help="Path to predictions JSON file"),
    video_db: Path = typer.Option(..., "--video-db", help="Path to video captions.db"),
    ocr_confidence_min: float = typer.Option(0.7, "--ocr-min", help="Minimum OCR confidence"),
):
    """Run quality checks on existing boundary predictions.

    Examples:
        # Analyze predictions from file
        caption_boundaries analyze predictions.json --video-db local/data/61/61c3*/captions.db
    """
    import json

    from caption_boundaries.inference.quality_checks import run_quality_checks

    try:
        console.print(f"\n[cyan]Analyzing predictions from:[/cyan] {predictions_json}")

        # Load predictions
        with open(predictions_json) as f:
            data = json.load(f)
            boundaries = data.get("boundaries", [])

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
        console.print("\n[cyan]Quality Analysis Results:[/cyan]")
        console.print(f"  Pass rate: {quality_results['pass_rate'] * 100:.1f}%")

        if quality_results["flagged_boundaries"]:
            console.print("\n[yellow]Detailed Flags:[/yellow]")
            for boundary in quality_results["flagged_boundaries"]:
                console.print(f"\n  Frames {boundary['frame1_index']} → {boundary['frame2_index']}:")
                for flag in boundary["flags"]:
                    console.print(f"    • {flag}")

    except Exception as e:
        console.print(f"[red]✗ Analysis failed:[/red] {e}")
        import traceback

        traceback.print_exc()
        raise typer.Exit(code=1) from e


@app.command()
def create_dataset(
    name: str = typer.Argument(..., help="Dataset name (will be used as database filename)"),
    video_dirs: list[Path] = typer.Argument(..., help="Paths to video directories (glob patterns supported)"),
    split_strategy: str = typer.Option("random", "--split", help="Split strategy: 'random' or 'show_based'"),
    train_ratio: float = typer.Option(0.8, "--train-ratio", help="Fraction of data for training (default: 0.8)"),
    random_seed: int = typer.Option(42, "--seed", help="Random seed for reproducibility"),
    description: str = typer.Option(None, "--description", "-d", help="Dataset description"),
):
    """Create training dataset from annotated videos.

    Extracts frame pairs from confirmed caption boundaries in the specified
    video directories. Supports glob patterns like 'local/data/*/*/captions.db'.

    Examples:
        # Single video
        caption_boundaries create-dataset my_dataset local/data/61/61c3123f-*/

        # Multiple videos with glob
        caption_boundaries create-dataset my_dataset 'local/data/*/*/'

        # Specific videos
        caption_boundaries create-dataset my_dataset local/data/61/*/ local/data/95/*/
    """
    from caption_boundaries.data.dataset_builder import create_training_dataset

    # Expand glob patterns and find captions.db files
    video_db_paths = []
    for pattern in video_dirs:
        if "*" in str(pattern):
            # Glob pattern
            import glob

            matches = glob.glob(str(pattern))
            for match in matches:
                db_path = Path(match) / "captions.db"
                if db_path.exists():
                    video_db_paths.append(db_path)
        else:
            # Direct path
            db_path = Path(pattern) / "captions.db"
            if db_path.exists():
                video_db_paths.append(db_path)
            else:
                console.print(f"[yellow]⚠[/yellow] No captions.db found in {pattern}")

    if not video_db_paths:
        console.print("[red]✗[/red] No valid video databases found")
        raise typer.Exit(code=1)

    console.print(f"Found {len(video_db_paths)} video databases")

    # Validate split strategy
    if split_strategy not in ("random", "show_based"):
        console.print(f"[red]✗[/red] Invalid split strategy: {split_strategy}")
        console.print("Valid options: random, show_based")
        raise typer.Exit(code=1)

    try:
        create_training_dataset(
            name=name,
            video_db_paths=video_db_paths,
            split_strategy=cast(Literal["random", "show_based"], split_strategy),
            train_split_ratio=train_ratio,
            random_seed=random_seed,
            description=description,
        )

        # Success message already printed by create_training_dataset

    except Exception as e:
        console.print(f"[red]✗ Failed to create dataset:[/red] {e}")
        raise typer.Exit(code=1) from e


@app.command()
def list_models():
    """List available model architectures."""
    from caption_boundaries.models import create_model, get_model_info, list_architectures

    console.print("[cyan]Available Model Architectures:[/cyan]\n")

    for arch_name in sorted(list_architectures()):
        info = get_model_info(arch_name)

        # Create model to get parameter counts
        model = create_model(arch_name, device="cpu", pretrained=False)
        # Use getattr to access custom model methods (not on nn.Module base)
        get_total = getattr(model, "get_num_total_params", None)
        get_trainable = getattr(model, "get_num_trainable_params", None)
        # Fallback to standard parameter counting if custom methods not available
        if callable(get_total):
            total_params: int = get_total()  # type: ignore[assignment]
        else:
            total_params = sum(p.numel() for p in model.parameters())
        if callable(get_trainable):
            trainable_params: int = get_trainable()  # type: ignore[assignment]
        else:
            trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)

        console.print(f"[green]{arch_name}[/green]")
        trainable_pct = trainable_params / total_params * 100 if total_params > 0 else 0
        console.print(f"  Parameters: {total_params:,} total, {trainable_params:,} trainable ({trainable_pct:.1f}%)")
        console.print(f"  Module: {info['module']}")

        if info["docstring"]:
            # Extract first line of docstring
            first_line = info["docstring"].split("\n")[0].strip()
            console.print(f"  Description: {first_line}")

        console.print()


@app.command()
def version():
    """Show version information."""
    from caption_boundaries import __version__

    console.print(f"caption_boundaries version: {__version__}")


if __name__ == "__main__":
    app()
