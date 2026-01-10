# Video Deduplication Script

## Problem

During the UUID-based storage migration, all 374 videos were duplicated, creating 748 total video files. Each video exists in two different UUID-based directories with identical content but different UUIDs.

## Solution

The `deduplicate-videos.py` script safely removes duplicate videos by:

1. **Analyzing all duplicates**: Groups videos by `display_path` to find pairs
2. **Prioritizing user work**: Keeps the copy with more:
   - Captions (most important)
   - Box labels (layout annotations)
   - Cropped frames (processed frames)
   - Layout approvals
   - Recent modifications
3. **Safe execution**:
   - Dry run mode first (shows what would be deleted without actually deleting)
   - Saves decisions to JSON file for review
   - Logs all actions
   - Requires explicit confirmation

## Usage

### Step 1: Run dry run to see what will be deleted

```bash
python3 scripts/deduplicate-videos.py
```

This will:
- Analyze all 374 duplicate pairs
- Show which copy will be kept (the one with your annotations)
- Save decisions to `scripts/deduplication-decisions.json`
- Run in DRY RUN mode (no files deleted)
- Show summary of space to be saved

### Step 2: Review the decisions

```bash
cat scripts/deduplication-decisions.json
```

Review the JSON file to ensure the correct copies are being kept.

### Step 3: Execute actual deletion

Run the script again and confirm when prompted:

```bash
python3 scripts/deduplicate-videos.py
```

When asked "Execute ACTUAL deletion?", type `yes` to proceed.

## What Gets Deleted

For each duplicate pair, the script will DELETE the entire directory containing:
- The duplicate video file (`.mp4`)
- The duplicate database (`captions.db`)
- Any associated processing files (`full_frames/`, `crop_frames/`, etc.)

## What Gets Kept

The script keeps the copy with:
- More captions (your transcription work)
- More box labels (your layout annotation work)
- More cropped frames (processed output)
- Layout configuration if present
- Most recent database modifications (if work is identical)

## Safety Features

1. **Dry run first**: Always runs dry run before actual deletion
2. **Decision logging**: All decisions saved to `deduplication-decisions.json`
3. **Action logging**: All deletions logged to `deduplicate-videos.log`
4. **Confirmation required**: Must type `yes` or `DELETE` to proceed
5. **Score display**: Shows work score for each copy so you can verify

## Expected Results

- **Before**: 748 videos (374 duplicates)
- **After**: 374 videos (all unique)
- **Space saved**: ~50% of total video storage (exact amount shown in script output)

## Rollback

**⚠️ WARNING**: Once deleted, the duplicate directories cannot be recovered unless you have a backup.

Before running the script in actual mode, consider backing up your `!__local/data/_has_been_deprecated__!` directory:

```bash
# Optional: Create backup before deduplication
tar -czf ~/captionacc-backup-$(date +%Y%m%d).tar.gz !__local/data/_has_been_deprecated__!
```

## Verification After Deduplication

After running the script, verify the results:

```bash
# Count remaining videos
find !__local/data/_has_been_deprecated__! -name "*.mp4" | wc -l
# Should show: 374

# Check for remaining duplicates
python3 << 'EOF'
from pathlib import Path
import sqlite3
from collections import Counter

display_paths = []
for db_path in Path("!__local/data/_has_been_deprecated__!").rglob("captions.db"):
    try:
        conn = sqlite3.connect(db_path)
        result = conn.execute("SELECT display_path FROM video_metadata WHERE id = 1").fetchone()
        if result:
            display_paths.append(result[0])
        conn.close()
    except:
        pass

duplicates = [path for path, count in Counter(display_paths).items() if count > 1]
print(f"Unique videos: {len(set(display_paths))}")
print(f"Remaining duplicates: {len(duplicates)}")
EOF
```

Expected output:
```
Unique videos: 374
Remaining duplicates: 0
```
