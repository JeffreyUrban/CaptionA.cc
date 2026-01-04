#!/usr/bin/env python3
"""Background recalculation after model updates.

Automatically detects model version mismatches across all videos,
recalculates crop bounds, and marks captions for review if bounds changed.

This runs independently of user actions - videos are processed in the background.

Usage:
    python3 scripts/recalculate-after-model-update.py [--dry-run] [--limit N]
"""

import argparse
import sqlite3
import sys
from pathlib import Path

# Add packages to path
sys.path.insert(0, str(Path(__file__).parent.parent / "packages" / "video_utils" / "src"))


def get_database_paths(data_dir: Path) -> list[Path]:
    """Find all video databases."""
    databases = []
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


def needs_recalculation(conn: sqlite3.Connection) -> tuple[bool, str | None, str | None]:
    """Check if recalculation needed. Returns (needs_recalc, old_version, new_version)."""
    cursor = conn.cursor()

    # Check if column exists
    cursor.execute("PRAGMA table_info(video_layout_config)")
    columns = [row[1] for row in cursor.fetchall()]

    if "analysis_model_version" not in columns:
        return True, None, None

    # Get analysis model version
    cursor.execute("SELECT analysis_model_version FROM video_layout_config WHERE id = 1")
    result = cursor.fetchone()
    analysis_version = result[0] if result else None

    # Get current model version
    cursor.execute("SELECT model_version FROM box_classification_model WHERE id = 1")
    result = cursor.fetchone()
    current_version = result[0] if result else None

    needs_recalc = analysis_version is None or analysis_version != current_version

    return needs_recalc, analysis_version, current_version


def calculate_crop_bounds_from_predictions(conn: sqlite3.Connection) -> dict | None:
    """Calculate crop bounds from predicted 'in' boxes.

    Returns new bounds dict or None if no predictions available.
    """
    cursor = conn.cursor()

    # Get all boxes with predictions
    cursor.execute("""
        SELECT
            box_left, box_top, box_right, box_bottom,
            predicted_label
        FROM full_frame_box_labels
        WHERE predicted_label = 'in'
    """)

    in_boxes = cursor.fetchall()

    if not in_boxes:
        # No predicted boxes - try to use user-annotated 'in' boxes
        cursor.execute("""
            SELECT box_left, box_top, box_right, box_bottom
            FROM full_frame_box_labels
            WHERE label = 'in'
        """)
        in_boxes = cursor.fetchall()

    if not in_boxes:
        return None

    # Calculate bounding box of all 'in' boxes
    left_edges = [box[0] for box in in_boxes]
    top_edges = [box[1] for box in in_boxes]
    right_edges = [box[2] for box in in_boxes]
    bottom_edges = [box[3] for box in in_boxes]

    return {
        "crop_left": min(left_edges),
        "crop_top": min(top_edges),
        "crop_right": max(right_edges),
        "crop_bottom": max(bottom_edges),
    }


def recalculate_video(db_path: Path, dry_run: bool = False) -> tuple[bool, str, dict | None]:
    """Recalculate crop bounds for a video if model version changed.

    Returns (success, message, stats_dict)
    """
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Get display path
        cursor.execute("SELECT display_path FROM video_metadata WHERE id = 1")
        result = cursor.fetchone()
        display_path = result[0] if result else str(db_path.parent.name)

        # Check if recalculation needed
        needs_recalc, old_version, new_version = needs_recalculation(conn)

        if not needs_recalc:
            conn.close()
            return True, "Up to date", {"action": "skipped", "display_path": display_path}

        if dry_run:
            conn.close()
            return (
                True,
                f"Would recalculate ({old_version or 'null'} → {new_version})",
                {"action": "would_recalculate", "display_path": display_path},
            )

        # Get old bounds
        cursor.execute("SELECT crop_left, crop_top, crop_right, crop_bottom FROM video_layout_config WHERE id = 1")
        result = cursor.fetchone()
        if not result:
            conn.close()
            return False, "No layout config found", {"action": "error", "display_path": display_path}

        old_bounds = {
            "crop_left": result[0],
            "crop_top": result[1],
            "crop_right": result[2],
            "crop_bottom": result[3],
        }

        # Calculate new bounds
        new_bounds = calculate_crop_bounds_from_predictions(conn)

        if not new_bounds:
            # No predictions available - just update version
            cursor.execute(
                "UPDATE video_layout_config SET analysis_model_version = ? WHERE id = 1",
                (new_version,),
            )
            conn.commit()
            conn.close()
            return (
                True,
                "Updated version (no predictions)",
                {
                    "action": "version_updated",
                    "display_path": display_path,
                    "old_version": old_version,
                    "new_version": new_version,
                },
            )

        # Check if bounds changed
        bounds_changed = (
            new_bounds["crop_left"] != old_bounds["crop_left"]
            or new_bounds["crop_top"] != old_bounds["crop_top"]
            or new_bounds["crop_right"] != old_bounds["crop_right"]
            or new_bounds["crop_bottom"] != old_bounds["crop_bottom"]
        )

        if not bounds_changed:
            # Bounds unchanged - just update version
            cursor.execute(
                "UPDATE video_layout_config SET analysis_model_version = ? WHERE id = 1",
                (new_version,),
            )
            conn.commit()
            conn.close()
            return (
                True,
                "Recalculated, bounds unchanged",
                {
                    "action": "recalculated_unchanged",
                    "display_path": display_path,
                    "old_version": old_version,
                    "new_version": new_version,
                },
            )

        # Bounds changed - update config and mark captions pending
        cursor.execute(
            """
            UPDATE video_layout_config
            SET
                crop_left = ?,
                crop_top = ?,
                crop_right = ?,
                crop_bottom = ?,
                crop_bounds_version = crop_bounds_version + 1,
                analysis_model_version = ?,
                updated_at = datetime('now')
            WHERE id = 1
        """,
            (
                new_bounds["crop_left"],
                new_bounds["crop_top"],
                new_bounds["crop_right"],
                new_bounds["crop_bottom"],
                new_version,
            ),
        )

        # Mark captions as pending review
        cursor.execute(
            """
            UPDATE captions
            SET boundary_pending = 1
            WHERE boundary_state != 'gap'
        """
        )

        captions_marked = cursor.rowcount

        conn.commit()
        conn.close()

        old_bounds_str = (
            f"[{old_bounds['crop_left']},{old_bounds['crop_top']},"
            f"{old_bounds['crop_right']},{old_bounds['crop_bottom']}]"
        )
        new_bounds_str = (
            f"[{new_bounds['crop_left']},{new_bounds['crop_top']},"
            f"{new_bounds['crop_right']},{new_bounds['crop_bottom']}]"
        )
        return (
            True,
            f"Bounds changed: {old_bounds_str} → {new_bounds_str}, marked {captions_marked} captions pending",
            {
                "action": "recalculated_changed",
                "display_path": display_path,
                "old_version": old_version,
                "new_version": new_version,
                "old_bounds": old_bounds,
                "new_bounds": new_bounds,
                "captions_marked": captions_marked,
            },
        )

    except Exception as e:
        return False, f"Error: {str(e)[:200]}", {"action": "error", "display_path": "unknown"}


def main():
    parser = argparse.ArgumentParser(description="Recalculate crop bounds after model updates (background job)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without making changes")
    parser.add_argument("--limit", type=int, help="Limit number of videos to process (for testing)")
    args = parser.parse_args()

    # Find all databases
    data_dir = Path(__file__).parent.parent / "local" / "data"
    if not data_dir.exists():
        print(f"❌ Data directory not found: {data_dir}")
        return

    print(f"Scanning for video databases in {data_dir}...")
    databases = get_database_paths(data_dir)

    if args.limit:
        databases = databases[: args.limit]

    print(f"Found {len(databases)} video databases\n")

    if args.dry_run:
        print("🔍 DRY RUN MODE - No changes will be made\n")

    # Process each database
    stats = {
        "skipped": 0,
        "version_updated": 0,
        "recalculated_unchanged": 0,
        "recalculated_changed": 0,
        "errors": 0,
    }

    changed_videos = []

    for i, db_path in enumerate(databases, 1):
        success, message, result = recalculate_video(db_path, args.dry_run)

        action = result.get("action", "unknown")

        if action == "skipped":
            stats["skipped"] += 1
        elif action == "version_updated":
            stats["version_updated"] += 1
        elif action == "recalculated_unchanged":
            stats["recalculated_unchanged"] += 1
        elif action == "recalculated_changed":
            stats["recalculated_changed"] += 1
            changed_videos.append(result)
            print(f"[{i}/{len(databases)}] ✓ {result['display_path']}")
            print(f"    {message}")
        elif action == "error":
            stats["errors"] += 1
            print(f"[{i}/{len(databases)}] ✗ {result.get('display_path', 'unknown')}: {message}")

        # Show progress every 50 videos
        if i % 50 == 0:
            print(
                f"\n[Progress] {i}/{len(databases)} processed - "
                f"{stats['recalculated_changed']} changed, {stats['errors']} errors\n"
            )

    # Summary
    print("\n" + "=" * 70)
    print("Recalculation complete:")
    print(f"  ⏭️  Already up to date: {stats['skipped']}")
    print(f"  🔄 Version updated (no predictions): {stats['version_updated']}")
    print(f"  ✅ Recalculated (bounds unchanged): {stats['recalculated_unchanged']}")
    print(f"  🎯 Recalculated (bounds changed): {stats['recalculated_changed']}")
    print(f"  ❌ Errors: {stats['errors']}")
    print("=" * 70)

    if changed_videos:
        print(f"\n📋 Videos with changed bounds ({len(changed_videos)}):\n")
        for video in changed_videos[:20]:
            print(f"  • {video['display_path']}")
            print(f"    Old: {video['old_bounds']}")
            print(f"    New: {video['new_bounds']}")
            print(f"    Captions marked: {video['captions_marked']}")
            print()

        if len(changed_videos) > 20:
            print(f"  ... and {len(changed_videos) - 20} more")

    if args.dry_run:
        print("\n💡 Run without --dry-run to apply changes")


if __name__ == "__main__":
    main()
