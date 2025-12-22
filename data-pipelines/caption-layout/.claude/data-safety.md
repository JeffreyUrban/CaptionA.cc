# Data Safety Guidelines

## Core Principle

**User's work is sacred. Losing hours of work is a catastrophic failure.**

Every line of code that touches user's work products must be designed with safety as the primary concern.

## Risk Assessment

### HIGH RISK Operations

The following operations require backup + careful design + testing with existing data:

- **Modifying output files from long-running processes** (>30 minutes of work)
- **Implementing resume/state tracking on existing workflows**
- **Batch operations on user-created content**
- **Database migrations or schema changes**
- **File reorganization or renaming scripts**
- **Cleanup or deduplication scripts**

### When Implementing HIGH RISK Features

**MANDATORY steps before any implementation:**

1. **Suggest backup FIRST**
   - "Before we modify these files, let's create a backup: `cp -r output/ output.backup/`"
   - Or: "Let's commit the current state to git first"
   - Never proceed without user confirming backup strategy

2. **Ask design questions about edge cases**
   - "What happens to existing output when we resume?"
   - "What if the state file and output files are out of sync?"
   - "What should happen if a file already exists?"

3. **Test with existing data scenarios**
   - Create sample existing output files
   - Test resume/state logic with those files present
   - Verify existing files are NOT modified

4. **Default to safety (preserve, don't modify)**
   - If unsure whether to overwrite: DON'T
   - If unsure whether to delete: DON'T
   - When in doubt: preserve existing, skip processing

5. **Make destruction explicit, not accidental**
   - Destructive operations require explicit flags (e.g., `--force`, `--overwrite`)
   - Never make destruction the default behavior
   - Warn user before any destructive operation

## Resume/State Tracking Pattern

### Correct Resume Behavior

When implementing resume functionality, the goal is to **skip processing** already-completed work, NOT to touch existing output files.

**CORRECT implementation:**

```python
if task_completed_previously:
    # DON'T write to output files - they already have results!
    # ONLY skip processing the source files
    print(f"Skipping {task_name} (already completed)")
    continue  # Skip to next task

# Only process if NOT completed previously
result = process_task(task)
write_output(result)  # Only writes for NEW processing
```

**Key principle:** Completed tasks should not appear in the results list that gets written to output files.

### WRONG Resume Behavior

**NEVER do this:**

```python
if task_completed_previously:
    # WRONG - creates dummy data
    result = {"status": "completed_previously", "data": "(see previous run)"}
    results.append(result)

# Later...
write_output_file(results)  # Overwrites existing work with dummy data!
```

**Why this is wrong:**
- Overwrites actual results with placeholder text
- Destroys hours of work
- Makes resume destructive instead of safe

## Backup Strategies

### Before Modifying Valuable Output

**Always suggest one of these:**

1. **Directory backup:**
   ```bash
   cp -r output/ output.backup/
   ```

2. **Git commit:**
   ```bash
   git add output/
   git commit -m "backup: preserve output before state tracking changes"
   ```

3. **Work on copy:**
   ```bash
   cp -r output/ output.test/
   # Test changes on output.test/
   # Only replace output/ after verification
   ```

**Never proceed with HIGH RISK operations without user confirming backup.**

## Testing Requirements

### For Features That Modify User Files

**Before recommending user run the code:**

1. **Create sample input/output**
   - Small test files representing real data
   - Include "already completed" scenarios

2. **Test resume with existing output**
   - Run once to create output
   - Run again with --resume
   - **VERIFY existing output files unchanged**

3. **Test state/output file sync**
   - What if state file exists but output files don't?
   - What if output files exist but state file doesn't?
   - What if they're out of sync?

4. **Only then recommend to user**
   - If you tested: "I've tested this with sample data and verified it preserves existing output"
   - If you can't test: "I haven't tested this - please test on a copy of your data first"

### Testing Checklist for Resume/State Features

- [ ] Tested with empty state (first run)
- [ ] Tested with partial completion (interrupted run)
- [ ] Tested with full completion (resume after done)
- [ ] Verified existing output files NOT modified when resuming
- [ ] Verified state file correctly tracks completion
- [ ] Tested with state file missing but output exists
- [ ] Tested with output missing but state says completed

## Red Flags

**These situations require EXTRA caution:**

1. **User mentions time investment**
   - "ran for many hours"
   - "took all night"
   - "expensive API calls"

2. **Output files are large**
   - >10MB of results
   - Hundreds of processed documents
   - API responses or LLM outputs

3. **Implementing "optimization" that touches existing files**
   - Deduplications
   - Reorganizations
   - Format changes

4. **State tracking added to existing workflow**
   - Resume functionality
   - Progress tracking
   - Checkpoint/restart

**When you see red flags:**
1. STOP and ask design questions
2. Suggest backup FIRST
3. Test with existing data
4. Default to preserving existing work

## Recovery Strategies

**If data loss occurs:**

1. **Check version control:**
   ```bash
   git log -- path/to/output
   git checkout HEAD~1 -- path/to/output
   ```

2. **Check for .gitignore issues:**
   - Output directories might not be tracked
   - Can't recover if never committed

3. **Check system backups:**
   - Time Machine (macOS)
   - File history (Windows)
   - Trash/Recycle bin

4. **Acknowledge failure:**
   - Apologize sincerely
   - Explain what went wrong
   - Offer to help regenerate if possible
   - Learn from mistake and update guidance

## Examples

### Example 1: Adding Resume to Long-Running Process

**WRONG approach:**
```python
# Just implement it
def process_with_resume():
    state = load_state()
    for item in items:
        if item in state:
            results.append({"status": "done", "data": None})
        else:
            results.append(process(item))
    save_results(results)  # Overwrites with partial data!
```

**CORRECT approach:**
```python
# First: Ask design questions
# Q: "What happens to existing output files when resuming?"
# Q: "Is the default behavior safe (preserve) or destructive (overwrite)?"

# Second: Suggest backup
# "Before we add state tracking, let's backup your output: cp -r output/ output.backup/"

# Third: Implement safely
def process_with_resume():
    state = load_state()
    new_results = []  # Only collect NEW results

    for item in items:
        if state.is_completed(item):
            print(f"Skipping {item} (already completed)")
            continue  # Don't add to results!

        result = process(item)
        new_results.append(result)
        state.mark_completed(item)

    # Only write new results, don't touch existing output
    if new_results:
        append_results(new_results)  # Append, don't overwrite
```

### Example 2: Cleanup Script

**WRONG approach:**
```python
# Delete files that look redundant
for file in files:
    if "backup" in file.name or "old" in file.name:
        file.unlink()  # Dangerous!
```

**CORRECT approach:**
```python
# First: Suggest backup
# "Before cleaning up, let's see what would be deleted:"

# Second: Dry run
for file in files:
    if "backup" in file.name or "old" in file.name:
        print(f"Would delete: {file}")

# Third: Require explicit confirmation
# "Should I delete these files? (y/n)"

# Fourth: Use safe deletion
import shutil
trash_dir = Path("trash")
trash_dir.mkdir(exist_ok=True)
for file in files_to_delete:
    shutil.move(file, trash_dir / file.name)  # Move to trash, don't delete
```

## Summary

**Golden Rules:**

1. **User's work is sacred** - losing it is catastrophic failure
2. **Backup before modifying** - always suggest, never skip
3. **Test with existing data** - not just empty state
4. **Preserve by default** - make destruction explicit
5. **When in doubt, don't** - ask user first

**If you're implementing resume/state tracking:**
- Resume means "skip processing," not "overwrite output"
- Test that existing output files are NOT modified
- Default to safe (preserve) not destructive (overwrite)

**If you can't test it:**
- Tell user explicitly: "I haven't tested this"
- Recommend they test on copy/backup first
- Never say "this should work" for data-modifying code
