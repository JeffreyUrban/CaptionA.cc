#!/bin/bash
# Migrate data from *_old tables to current tables
# Run this BEFORE using the repair service to clean up _old tables

set -e

LOCAL_DATA_DIR="${LOCAL_DATA_DIR:-/Users/jurban/PycharmProjects/CaptionA.cc/local/data}"

migrated=0
failed=0
skipped=0

echo "Starting migration of *_old tables..."
echo

find "$LOCAL_DATA_DIR" -name "captions.db" -type f | while read db; do
  video_id=$(basename $(dirname "$db"))

  # Check which _old tables exist
  old_tables=$(sqlite3 "$db" "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_old'" 2>/dev/null || echo "")

  if [ -z "$old_tables" ]; then
    continue
  fi

  echo "Processing $video_id..."

  for old_table in $old_tables; do
    # Derive current table name
    current_table="${old_table%_old}"

    # Get row counts
    old_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM $old_table" 2>/dev/null)
    current_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM $current_table" 2>/dev/null || echo "0")

    if [ "$current_count" -gt 0 ]; then
      echo "  $current_table already has data ($current_count rows), skipping $old_table"
      skipped=$((skipped + 1))
      continue
    fi

    if [ "$old_count" -eq 0 ]; then
      echo "  $old_table is empty, skipping"
      continue
    fi

    echo "  Migrating $old_table ($old_count rows) → $current_table..."

    # Get columns from current table (target schema)
    current_columns=$(sqlite3 "$db" "PRAGMA table_info($current_table)" | cut -d'|' -f2)

    # Get columns from old table
    old_columns=$(sqlite3 "$db" "PRAGMA table_info($old_table)" | cut -d'|' -f2)

    # Find intersection of columns (only migrate columns that exist in both)
    common_columns=""
    for col in $current_columns; do
      if echo "$old_columns" | grep -q "^${col}$"; then
        if [ -z "$common_columns" ]; then
          common_columns="$col"
        else
          common_columns="$common_columns, $col"
        fi
      fi
    done

    if [ -z "$common_columns" ]; then
      echo "  ✗ ERROR: No common columns found between $old_table and $current_table"
      failed=$((failed + 1))
      continue
    fi

    # Copy data using explicit column list
    if sqlite3 "$db" "INSERT INTO $current_table ($common_columns) SELECT $common_columns FROM $old_table" 2>/dev/null; then
      # Verify
      new_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM $current_table")
      if [ "$new_count" -eq "$old_count" ]; then
        echo "  ✓ Success: $new_count rows migrated"
        migrated=$((migrated + 1))
      else
        echo "  ✗ ERROR: Row count mismatch (expected $old_count, got $new_count)"
        failed=$((failed + 1))
      fi
    else
      echo "  ✗ ERROR: Migration failed"
      failed=$((failed + 1))
    fi
  done

  echo
done

echo "Migration complete:"
echo "  Migrated: $migrated tables"
echo "  Skipped: $skipped tables (current table already has data)"
echo "  Failed: $failed tables"
