"""CLI commands for box classification."""

from pathlib import Path

import typer
from rich.console import Console

from .train import train_model

app = typer.Typer(help='Box classification model training CLI')
console = Console()


@app.command()
def train(
    db_path: Path = typer.Argument(..., help='Path to annotations database'),
    min_samples: int = typer.Option(10, help='Minimum number of training samples required'),
) -> None:
    """Train Bayesian model from user annotations."""
    try:
        console.print(f'Training model from [cyan]{db_path}[/cyan]...')

        # Train model
        model_params = train_model(db_path, min_samples)

        # Display results
        console.print('[green]✓[/green] Model trained successfully!')
        console.print(f'  Training samples: {model_params["n_training_samples"]}')
        console.print(f'  Prior P(in): {model_params["prior_in"]:.3f}')
        console.print(f'  Prior P(out): {model_params["prior_out"]:.3f}')
        console.print(f'  Model version: {model_params["model_version"]}')

    except FileNotFoundError:
        console.print(f'[red]Error:[/red] Database not found: {db_path}', style='red')
        raise typer.Exit(1)
    except ValueError as e:
        console.print(f'[red]Error:[/red] {e}', style='red')
        raise typer.Exit(1)
    except Exception as e:
        console.print(f'[red]Error:[/red] {e}', style='red')
        raise typer.Exit(1)


if __name__ == '__main__':
    app()
