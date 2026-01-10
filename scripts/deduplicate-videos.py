#!/usr/bin/env python3
"""
Deduplicate videos that were duplicated during UUID migration.

For each pair of duplicates with the same display_path:
- Keeps the copy with more annotation work (captions, box labels, cropped frames)
- Deletes the other copy (video file, database, entire directory)
- Logs all actions to deduplicate-videos.log
"""

import json
import shutil
import sqlite3
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# Paths
DATA_DIR = Path("!__local/data/_has_been_deprecated__!")
LOG_FILE = Path("scripts/deduplicate-videos.log")
DECISIONS_FILE = Path("scripts/deduplication-decisions.json")


def get_video_info(db_path: Path) -> dict | None:
    """Extract video information and work progress from database."""
    conn = None
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check if video_metadata table exists
        table_check = cursor.execute("""
            SELECT name FROM sqlite_master
            WHERE type='table' AND name='video_metadata'
        """).fetchone()

        if not table_check:
            conn.close()
            return None

        # Get video metadata
        result = cursor.execute("""
            SELECT display_path, video_id, storage_path
            FROM video_metadata WHERE id = 1
        """).fetchone()

        if not result:
            conn.close()
            return None

        display_path, video_id, storage_path = result
    except Exception:
        # Skip databases that can't be read or don't have expected schema
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        return None

    try:
        # Get database modification time
        db_mtime = db_path.stat().st_mtime

        # Count captions
        captions_count = 0
        try:
            captions_count = cursor.execute("SELECT COUNT(*) FROM captions").fetchone()[0]
        except Exception:
            pass

        # Count box labels
        box_labels_count = 0
        try:
            box_labels_count = cursor.execute("SELECT COUNT(*) FROM full_frame_box_labels").fetchone()[0]
        except Exception:
            pass

        # Check layout config
        layout_config = None
        try:
            layout_config = cursor.execute("SELECT * FROM video_layout_config WHERE id = 1").fetchone()
        except Exception:
            pass

        # Count cropped frames
        cropped_frames_count = 0
        try:
            cropped_frames_count = cursor.execute("SELECT COUNT(*) FROM cropped_frames").fetchone()[0]
        except Exception:
            pass

        # Count full frames
        full_frames_count = 0
        try:
            full_frames_count = cursor.execute("SELECT COUNT(*) FROM full_frames").fetchone()[0]
        except Exception:
            pass

        return {
            "display_path": display_path,
            "video_id": video_id,
            "storage_path": storage_path,
            "db_path": db_path,
            "db_mtime": db_mtime,
            "captions": captions_count,
            "box_labels": box_labels_count,
            "layout_config": layout_config is not None,
            "cropped_frames": cropped_frames_count,
            "full_frames": full_frames_count,
        }
    finally:
        conn.close()


def calculate_work_score(info: dict) -> int:
    """Calculate priority score based on annotation work."""
    return (
        info["captions"] * 100  # Captions most important
        + info["box_labels"] * 10  # Box labels next
        + info["cropped_frames"] * 5  # Cropped frames
        + (10 if info["layout_config"] else 0)  # Layout approval
        + info["full_frames"]  # Full frames least important
    )


def find_duplicates():
    """Find all duplicate videos grouped by display_path."""
    by_display_path = defaultdict(list)

    # Find all databases
    for db_path in DATA_DIR.rglob("captions.db"):
        info = get_video_info(db_path)
        if info:
            by_display_path[info["display_path"]].append(info)

    # Filter to only duplicates
    duplicates = {path: infos for path, infos in by_display_path.items() if len(infos) > 1}

    return duplicates


def decide_which_to_keep(duplicates: dict) -> list:
    """
    For each duplicate pair, decide which to keep based on work score.
    Returns list of decisions with 'keep' and 'delete' info.
    """
    decisions = []

    for display_path, videos in sorted(duplicates.items()):
        if len(videos) != 2:
            print(f"Warning: {display_path} has {len(videos)} copies, expected 2. Skipping.")
            continue

        v1, v2 = videos
        score1 = calculate_work_score(v1)
        score2 = calculate_work_score(v2)

        # Determine which to keep
        if score1 > score2:
            keep, delete = v1, v2
            reason = f"more work (score {score1} vs {score2})"
        elif score2 > score1:
            keep, delete = v2, v1
            reason = f"more work (score {score2} vs {score1})"
        else:
            # Same score, use most recently modified
            if v1["db_mtime"] > v2["db_mtime"]:
                keep, delete = v1, v2
                reason = "more recent modifications"
            else:
                keep, delete = v2, v1
                reason = "more recent modifications"

        decisions.append(
            {
                "display_path": display_path,
                "keep": keep,
                "delete": delete,
                "reason": reason,
            }
        )

    return decisions


def save_decisions(decisions: list):
    """Save decisions to JSON file for review."""
    simplified = []
    for d in decisions:
        simplified.append(
            {
                "display_path": d["display_path"],
                "keep_video_id": d["keep"]["video_id"],
                "keep_score": calculate_work_score(d["keep"]),
                "delete_video_id": d["delete"]["video_id"],
                "delete_score": calculate_work_score(d["delete"]),
                "reason": d["reason"],
            }
        )

    DECISIONS_FILE.write_text(json.dumps(simplified, indent=2))
    print(f"Saved deduplication decisions to {DECISIONS_FILE}")


def execute_deduplication(decisions: list, dry_run: bool = True):
    """Execute the deduplication by deleting duplicate directories."""
    log_entries = []

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entries.append(f"\n{'=' * 80}")
    log_entries.append(f"Deduplication run: {timestamp}")
    log_entries.append(f"Mode: {'DRY RUN' if dry_run else 'ACTUAL DELETION'}")
    log_entries.append(f"{'=' * 80}\n")

    deleted_count = 0
    total_size_saved = 0

    for decision in decisions:
        delete_info = decision["delete"]
        keep_info = decision["keep"]

        # Get directory to delete (parent of db_path)
        delete_dir = delete_info["db_path"].parent

        # Calculate directory size
        dir_size = sum(f.stat().st_size for f in delete_dir.rglob("*") if f.is_file())
        total_size_saved += dir_size

        log_msg = f"""
{decision["display_path"]}:
  KEEPING:  {keep_info["video_id"]} (score: {calculate_work_score(keep_info)})
            captions={keep_info["captions"]}, box_labels={keep_info["box_labels"]},
            cropped={keep_info["cropped_frames"]}, layout={keep_info["layout_config"]}
  DELETING: {delete_info["video_id"]} (score: {calculate_work_score(delete_info)})
            captions={delete_info["captions"]}, box_labels={delete_info["box_labels"]},
            cropped={delete_info["cropped_frames"]}, layout={delete_info["layout_config"]}
  Directory: {delete_dir}
  Size: {dir_size:,} bytes
  Reason: {decision["reason"]}
"""
        log_entries.append(log_msg)

        if not dry_run:
            try:
                shutil.rmtree(delete_dir)
                deleted_count += 1
                log_entries.append("  ✓ Deleted successfully\n")
            except Exception as e:
                log_entries.append(f"  ✗ Error deleting: {e}\n")
        else:
            log_entries.append("  [DRY RUN - would delete]\n")

    # Write log
    LOG_FILE.parent.mkdir(exist_ok=True)
    with open(LOG_FILE, "a") as f:
        f.write("\n".join(log_entries))

    # Summary
    summary = f"""
{"=" * 80}
Summary:
  Total duplicates processed: {len(decisions)}
  Directories deleted: {deleted_count if not dry_run else 0}
  Space saved: {total_size_saved / (1024**3):.2f} GB
  Mode: {"DRY RUN" if dry_run else "ACTUAL DELETION"}
{"=" * 80}
"""
    print(summary)
    log_entries.append(summary)

    with open(LOG_FILE, "a") as f:
        f.write(summary)

    print(f"\nFull log written to {LOG_FILE}")


def main():
    print("Finding duplicate videos...")
    duplicates = find_duplicates()
    print(f"Found {len(duplicates)} videos with duplicates\n")

    if not duplicates:
        print("No duplicates found!")
        return

    print("Analyzing which copies to keep...")
    decisions = decide_which_to_keep(duplicates)

    # Save decisions for review
    save_decisions(decisions)

    # Show sample decisions
    print("\nSample deduplication decisions:")
    for decision in decisions[:5]:
        keep_score = calculate_work_score(decision["keep"])
        delete_score = calculate_work_score(decision["delete"])
        print(f"\n{decision['display_path']}:")
        print(f"  KEEP:   {decision['keep']['video_id']} (score: {keep_score})")
        print(f"  DELETE: {decision['delete']['video_id']} (score: {delete_score})")
        print(f"  Reason: {decision['reason']}")

    print(f"\n... and {len(decisions) - 5} more")

    # Ask for confirmation
    print(f"\n{'=' * 80}")
    print("This will DELETE 374 duplicate video directories permanently!")
    print(f"Review decisions in: {DECISIONS_FILE}")
    print(f"{'=' * 80}\n")

    response = input("Run in DRY RUN mode first? (Y/n): ").strip().lower()
    if response != "n":
        print("\nRunning DRY RUN (no files will be deleted)...")
        execute_deduplication(decisions, dry_run=True)

        print("\n" + "=" * 80)
        response = input("DRY RUN complete. Execute ACTUAL deletion? (yes/no): ").strip().lower()
        if response == "yes":
            print("\nExecuting ACTUAL deletion...")
            execute_deduplication(decisions, dry_run=False)
            print("\n✓ Deduplication complete!")
        else:
            print("\nCancelled. No files were deleted.")
    else:
        response = input("Execute ACTUAL deletion NOW? (type 'DELETE' to confirm): ").strip()
        if response == "DELETE":
            print("\nExecuting ACTUAL deletion...")
            execute_deduplication(decisions, dry_run=False)
            print("\n✓ Deduplication complete!")
        else:
            print("\nCancelled. No files were deleted.")


if __name__ == "__main__":
    main()
