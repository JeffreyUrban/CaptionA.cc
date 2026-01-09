#!/bin/bash
# Fix videos with OCR boxes but no layout config

DB_PATH="$1"

if [ -z "$DB_PATH" ]; then
  echo "Usage: $0 <path-to-captions.db>"
  exit 1
fi

# Check if layout_config exists but is empty
CONFIG_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM video_layout_config")

if [ "$CONFIG_COUNT" -eq 0 ]; then
  echo "Creating missing layout config entry..."

  # Get frame dimensions from first full frame
  DIMENSIONS=$(sqlite3 "$DB_PATH" "SELECT width, height FROM full_frames WHERE frame_index = (SELECT MIN(frame_index) FROM full_frames) LIMIT 1")

  if [ -z "$DIMENSIONS" ]; then
    echo "Error: No frames found in database"
    exit 1
  fi

  WIDTH=$(echo "$DIMENSIONS" | cut -d'|' -f1)
  HEIGHT=$(echo "$DIMENSIONS" | cut -d'|' -f2)

  # Insert default layout config (full frame, no crop)
  sqlite3 "$DB_PATH" <<EOF
INSERT INTO video_layout_config (
  id, frame_width, frame_height,
  crop_left, crop_top, crop_right, crop_bottom,
  crop_bounds_version, updated_at
) VALUES (
  1, $WIDTH, $HEIGHT,
  0, 0, $WIDTH, $HEIGHT,
  1, datetime('now')
);
EOF

  echo "✓ Created layout config: ${WIDTH}x${HEIGHT} (full frame)"
else
  echo "Layout config already exists (count: $CONFIG_COUNT)"
fi
