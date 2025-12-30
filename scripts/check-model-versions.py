#!/usr/bin/env python3
"""Check all videos for model version mismatches and report which need recalculation.

This script:
1. Scans all video databases
2. Checks if analysis_model_version matches current box_classification_model.model_version
3. Reports which videos need recalculation

Usage:
    python3 scripts/check-model-versions.py [--details]
"""

import argparse
import sqlite3
from pathlib import Path


def get_database_paths(data_dir: Path) -> list[Path]:
    """Find all video databases in data directory."""
    databases = []

    # Pattern: local/data/*/*/annotations.db
    for parent_dir in sorted(data_dir.iterdir()):
        if not parent_dir.is_dir():
            continue

        for video_dir in sorted(parent_dir.iterdir()):
            if not video_dir.is_dir():
                continue

            db_path = video_dir / "annotations.db"
            if db_path.exists():
                databases.append(db_path)

    return databases


def check_model_version(db_path: Path) -> dict:
    """Check if model version matches analysis version."""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Get display path
        cursor.execute("SELECT display_path FROM video_metadata WHERE id = 1")
        result = cursor.fetchone()
        display_path = result[0] if result else str(db_path.parent.name)

        # Get current model version
        cursor.execute("SELECT model_version FROM box_classification_model WHERE id = 1")
        result = cursor.fetchone()
        current_model_version = result[0] if result else None

        # Get analysis model version
        cursor.execute(
            "SELECT analysis_model_version FROM video_layout_config WHERE id = 1"
        )
        result = cursor.fetchone()
        analysis_model_version = result[0] if result else None

        # Check if column exists (for old databases)
        cursor.execute("PRAGMA table_info(video_layout_config)")
        columns = [row[1] for row in cursor.fetchall()]
        has_column = "analysis_model_version" in columns

        conn.close()

        needs_recalc = (
            not has_column
            or analysis_model_version is None
            or analysis_model_version != current_model_version
        )

        return {
            "display_path": display_path,
            "current_model_version": current_model_version,
            "analysis_model_version": analysis_model_version,
            "has_column": has_column,
            "needs_recalculation": needs_recalc,
        }

    except Exception as e:
        return {
            "display_path": str(db_path.parent.name),
            "error": str(e),
            "needs_recalculation": False,
        }


def main():
    parser = argparse.ArgumentParser(
        description="Check all videos for model version mismatches"
    )
    parser.add_argument(
        "--details", action="store_true", help="Show details for all videos"
    )
    args = parser.parse_args()

    # Find all databases
    data_dir = Path(__file__).parent.parent / "local" / "data"
    if not data_dir.exists():
        print(f"❌ Data directory not found: {data_dir}")
        return

    print(f"Scanning for video databases in {data_dir}...")
    databases = get_database_paths(data_dir)
    print(f"Found {len(databases)} video databases\n")

    # Check each database
    needs_recalc = []
    up_to_date = []
    errors = []

    for db_path in databases:
        result = check_model_version(db_path)

        if "error" in result:
            errors.append(result)
        elif result["needs_recalculation"]:
            needs_recalc.append(result)
        else:
            up_to_date.append(result)

    # Print summary
    print("=" * 70)
    print(f"Summary:")
    print(f"  ✅ Up to date: {len(up_to_date)}")
    print(f"  ⚠️  Needs recalculation: {len(needs_recalc)}")
    print(f"  ❌ Errors: {len(errors)}")
    print("=" * 70)

    # Print videos needing recalculation
    if needs_recalc:
        print(f"\n📋 Videos needing recalculation ({len(needs_recalc)}):\n")
        for result in needs_recalc[:20]:  # Show first 20
            reason = ""
            if not result.get("has_column"):
                reason = "(missing column)"
            elif result["analysis_model_version"] is None:
                reason = "(never analyzed)"
            else:
                reason = (
                    f"({result['analysis_model_version']} → "
                    f"{result['current_model_version']})"
                )

            print(f"  • {result['display_path']:<50} {reason}")

        if len(needs_recalc) > 20:
            print(f"\n  ... and {len(needs_recalc) - 20} more")

    # Print details if requested
    if args.details and up_to_date:
        print(f"\n✅ Up-to-date videos ({len(up_to_date)}):\n")
        for result in up_to_date[:20]:
            print(
                f"  • {result['display_path']:<50} (model: {result['current_model_version']})"
            )

        if len(up_to_date) > 20:
            print(f"\n  ... and {len(up_to_date) - 20} more")

    # Print errors
    if errors:
        print(f"\n❌ Errors ({len(errors)}):\n")
        for result in errors:
            print(f"  • {result['display_path']}: {result['error']}")

    print(
        f"\n💡 To trigger recalculation, access each video's layout analysis page in the web UI."
    )
    print(
        "   The model version check will run automatically and recalculate if needed."
    )


if __name__ == "__main__":
    main()
