#!/bin/bash
# Batch process videos with confirmed boundaries through crop_frames pipeline
#
# This script:
# 1. Finds videos with >=50 confirmed caption boundaries
# 2. Extracts crop bounds from video_layout_config
# 3. Runs crop_frames pipeline on each video
# 4. Stores results in cropped_frames table

set -euo pipefail

DATA_DIR="${1:-/Users/jurban/PycharmProjects/CaptionA.cc/local/data}"
MIN_CONFIRMED="${2:-50}"
MAX_VIDEOS="${3:-5}"

echo "Batch Crop Frames for Confirmed Boundaries"
echo "==========================================="
echo "Data directory: $DATA_DIR"
echo "Min confirmed: $MIN_CONFIRMED"
echo "Max videos: $MAX_VIDEOS"
echo ""

# Find videos with confirmed boundaries
videos_processed=0

for db in $(find "$DATA_DIR" -name "annotations.db" | sort); do
    # Check if video has enough confirmed boundaries (exclude 'issue' state - not clean boundaries)
    confirmed=$(sqlite3 "$db" "SELECT COUNT(*) FROM captions WHERE boundary_state = 'confirmed' AND boundary_state != 'issue' AND boundary_pending = 0" 2>/dev/null || echo "0")

    if [ "$confirmed" -lt "$MIN_CONFIRMED" ]; then
        continue
    fi

    # Get video info
    video_dir=$(dirname "$db")
    video_parent=$(basename $(dirname "$video_dir"))
    video_name=$(basename "$video_dir")

    echo "[$((videos_processed + 1))/$MAX_VIDEOS] Processing $video_parent/$video_name ($confirmed confirmed)..."

    # Find video file
    video_file=""
    for ext in mp4 mkv avi mov; do
        candidate="$video_dir/$video_name.$ext"
        if [ -f "$candidate" ]; then
            video_file="$candidate"
            break
        fi
    done

    if [ -z "$video_file" ]; then
        echo "  ⚠️  Video file not found, skipping"
        continue
    fi

    # Get crop bounds from video_layout_config
    crop_bounds=$(sqlite3 "$db" "SELECT caption_left, caption_top, caption_right, caption_bottom FROM video_layout_config LIMIT 1" 2>/dev/null || echo "")

    if [ -z "$crop_bounds" ]; then
        echo "  ⚠️  No crop bounds in video_layout_config, skipping"
        continue
    fi

    # Parse crop bounds
    left=$(echo "$crop_bounds" | cut -d'|' -f1)
    top=$(echo "$crop_bounds" | cut -d'|' -f2)
    right=$(echo "$crop_bounds" | cut -d'|' -f3)
    bottom=$(echo "$crop_bounds" | cut -d'|' -f4)

    crop_str="$left,$top,$right,$bottom"

    echo "  Crop bounds: $crop_str"
    echo "  Extracting frames..."

    # Run crop_frames pipeline
    output_dir="$video_dir/cropped_frames_tmp"
    mkdir -p "$output_dir"

    cd /Users/jurban/PycharmProjects/CaptionA.cc/data-pipelines/crop_frames

    if uv run crop_frames extract-frames "$video_file" "$output_dir" \
        --crop "$crop_str" \
        --rate 10.0 \
        --resize-width 480 \
        --resize-height 48 2>&1 | tail -5; then

        echo "  ✓ Frames extracted to $output_dir"

        # TODO: Load frames into cropped_frames table using frames_db
        # For now, just track that cropping succeeded

    else
        echo "  ✗ Failed to extract frames"
    fi

    videos_processed=$((videos_processed + 1))

    if [ "$videos_processed" -ge "$MAX_VIDEOS" ]; then
        break
    fi

    echo ""
done

echo "==========================================="
echo "Processed $videos_processed videos"
echo "==========================================="
