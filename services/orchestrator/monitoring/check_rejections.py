#!/usr/bin/env python3
"""Check for unacknowledged boundary inference rejections.

Usage:
    python services/orchestrator/monitoring/check_rejections.py

This script:
- Queries for recent unacknowledged rejections
- Displays summary statistics
- Highlights issues requiring attention
- Can be run manually or scheduled as a cron job
"""

from datetime import datetime

from rich.console import Console
from rich.table import Table

from services.orchestrator.monitoring.rejection_logger import (
    get_rejection_summary,
    get_unacknowledged_rejections,
)

console = Console()


def format_timestamp(ts_str: str) -> str:
    """Format ISO timestamp as relative time."""
    try:
        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        now = datetime.now(ts.tzinfo)
        delta = now - ts

        if delta.days > 0:
            return f"{delta.days}d ago"
        elif delta.seconds > 3600:
            return f"{delta.seconds // 3600}h ago"
        elif delta.seconds > 60:
            return f"{delta.seconds // 60}m ago"
        else:
            return "just now"
    except Exception:
        return ts_str


def main():
    console.print("\n[cyan]═══════════════════════════════════════════════════════[/cyan]")
    console.print("[cyan]   Boundary Inference Rejections Monitor[/cyan]")
    console.print("[cyan]═══════════════════════════════════════════════════════[/cyan]\n")

    # Get summary statistics
    console.print("[yellow]Fetching rejection summary (last 7 days)...[/yellow]")
    summary = get_rejection_summary(days=7)

    if isinstance(summary, dict) and "total_rejections" in summary:
        total = summary["total_rejections"]
        by_type = summary.get("by_type", {})

        console.print(f"\n[bold]Total rejections:[/bold] {total}")
        if by_type:
            console.print("\n[bold]By type:[/bold]")
            for rejection_type, count in sorted(by_type.items(), key=lambda x: -x[1]):
                console.print(f"  • {rejection_type}: {count}")
    else:
        console.print("[red]Could not fetch rejection summary[/red]")

    # Get unacknowledged rejections
    console.print("\n[yellow]Fetching unacknowledged rejections...[/yellow]")
    rejections = get_unacknowledged_rejections(limit=50)

    if not rejections:
        console.print("\n[green]✓ No unacknowledged rejections[/green]")
        console.print("[green]  All issues have been reviewed.[/green]\n")
        return

    console.print(f"\n[red]⚠️  {len(rejections)} unacknowledged rejection(s)[/red]\n")

    # Display rejections in table
    table = Table(show_header=True, header_style="bold cyan")
    table.add_column("Age", style="dim", width=10)
    table.add_column("Type", style="yellow", width=20)
    table.add_column("Video ID", style="blue", width=12)
    table.add_column("Frames", justify="right", width=10)
    table.add_column("Cost", justify="right", width=10)
    table.add_column("Details", width=40)

    for rejection in rejections:
        age = format_timestamp(rejection["created_at"])
        rejection_type = rejection["rejection_type"]
        video_id = rejection["video_id"][:8]  # First 8 chars
        frame_count = f"{rejection['frame_count']:,}" if rejection.get("frame_count") else "N/A"
        cost = f"${rejection['estimated_cost_usd']:.2f}" if rejection.get("estimated_cost_usd") else "N/A"

        # Extract key detail from message
        message = rejection["rejection_message"]
        if "Frame count too high" in message:
            detail = f"Exceeds limit ({rejection.get('frame_count', 0):,} frames)"
        elif "too expensive" in message:
            detail = f"Cost ${rejection.get('estimated_cost_usd', 0):.2f}"
        else:
            detail = message[:40] + "..." if len(message) > 40 else message

        table.add_row(age, rejection_type, video_id, frame_count, cost, detail)

    console.print(table)

    # Recommendations
    console.print("\n[cyan]Recommendations:[/cyan]")
    console.print("  1. Review rejections to determine if limits need adjustment")
    console.print("  2. Check if videos are valid or data errors")
    console.print("  3. Update config.py if supporting longer videos")
    console.print("  4. Mark as acknowledged after reviewing:")
    console.print("     [dim]from services.orchestrator.monitoring.rejection_logger import acknowledge_rejection[/dim]")
    console.print("     [dim]acknowledge_rejection(rejection_id='...')[/dim]\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        console.print(f"\n[red]Error:[/red] {e}")
        import traceback

        traceback.print_exc()
        exit(1)
