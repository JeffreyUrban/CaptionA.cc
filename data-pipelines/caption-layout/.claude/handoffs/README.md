# Handoffs Directory

This directory contains **handoff documents** for transitioning work between Claude instances.

## Purpose

When work needs to be handed off to another Claude instance (or to resume later), create a handoff document to preserve context, state, and decisions.

## When to Create a Handoff

**Required handoff situations:**
- Switching Claude instances mid-task
- Pausing work on a complex feature
- Blocked by external dependency
- Need different expertise/focus (testing → documentation)
- End of session with incomplete work

**Optional but recommended:**
- Completing a major milestone
- After significant design decisions
- When context is complex and might be lost

## Handoff Document Template

Create a new file: `.claude/handoffs/YYYY-MM-DD-topic-name.md`

```markdown
# Handoff: [Topic Name]

**Date:** YYYY-MM-DD
**From:** [Claude instance/session identifier or "Session ended"]
**To:** [Next Claude instance or "Future session"]
**Status:** [In Progress / Blocked / Ready for Next Steps]

---

## Context

Brief description of what we're working on and why.

**Related:**
- Issue #123
- PR #456
- Design doc: dev-docs/design/FEATURE.md

---

## Current State

### What's Complete
- [x] Implemented feature X
- [x] Added tests for Y
- [x] Updated documentation for Z

### What's In Progress
- [ ] Working on feature A (50% complete)
- [ ] Need to add integration tests for B

### What's Blocked
- [ ] Waiting for decision on approach C
- [ ] External API not available yet

---

## Key Decisions Made

1. **Decision:** Chose approach X over Y
   - **Rationale:** Better performance, simpler code
   - **Document:** dev-docs/design/DESIGN_RATIONALE.md:45

2. **Decision:** Using library Z
   - **Rationale:** Well-maintained, fits our needs
   - **Document:** See commit abc123

---

## Open Questions

1. **Question:** Should we support format A or format B?
   - **Context:** Both are valid, user preference unclear
   - **Impact:** Affects CLI interface design
   - **Action needed:** Ask user for clarification

2. **Question:** What's the performance requirement?
   - **Context:** Current implementation is O(n²)
   - **Impact:** May need optimization
   - **Action needed:** Clarify with user

---

## Next Steps

**Immediate priorities:**
1. Finish implementing feature A (see src/module.py:123)
2. Add integration tests in tests/test_integration.py
3. Update documentation in docs/features/new-feature.md

**After that:**
1. Resolve blocked items (see "What's Blocked" above)
2. Performance testing
3. Final review before PR

---

## Important Context

**Files modified:**
- `src/caption-layout/module.py` - Main implementation
- `tests/test_module.py` - Unit tests
- `docs/features/feature.md` - Documentation

**Key insights:**
- The algorithm requires X because Y
- Edge case: empty input must return Z (not None)
- Performance: Current O(n), target is O(log n)

**Gotchas:**
- Don't forget to update fixtures when changing format
- Test data in tests/fixtures/edge-cases/ is critical
- Rich output requires COLUMNS=120 env var in tests

---

## Commands to Resume

```bash
# Run tests for this feature
pytest tests/test_module.py -v

# Check current implementation
cat src/caption-layout/module.py

# View related documentation
mkdocs serve
# Navigate to: features/new-feature.md
```

---

## References

**Code:**
- Main implementation: `src/caption-layout/module.py:45-123`
- Tests: `tests/test_module.py`

**Documentation:**
- Design: `dev-docs/design/IMPLEMENTATION.md`
- User docs: `docs/features/new-feature.md`

**External:**
- [Library Z docs](https://example.com/docs)
- [Related discussion](https://github.com/owner/repo/issues/123)
```

---

## Handoff File Naming

**Format:** `YYYY-MM-DD-topic-name.md`

**Examples:**
- `2024-12-02-github-configuration.md`
- `2024-12-02-workflow-restructure.md`
- `2024-12-03-documentation-testing.md`

**Include date** to track chronology and find recent handoffs easily.

---

## Reading a Handoff

When receiving a handoff:

1. **Read the handoff document** thoroughly
2. **Check current state** - Run commands listed
3. **Review modified files** - Understand what changed
4. **Read references** - Check linked design docs
5. **Clarify questions** - Ask user about open questions
6. **Update handoff** - Mark completed items, add new insights

---

## Updating Handoffs

**When resuming work:**
- Update "Current State" section
- Mark completed items
- Add new open questions
- Document new decisions
- Update "Next Steps"

**When completing work:**
- Mark handoff as complete
- Add final summary
- Link to PR or commit
- Archive (optional: move to `.claude/handoffs/archive/`)

---

## Best Practices

### Be Specific

**Bad:** "Working on tests"
**Good:** "Added unit tests for parse_input() in tests/test_parser.py. Still need integration tests for full pipeline."

### Link to Code

**Bad:** "Made changes to parser"
**Good:** "Modified parse_input() in src/parser.py:45 to handle edge case of empty strings"

### Document Decisions

**Bad:** "Chose approach A"
**Good:** "Chose approach A over B because A has O(n) vs B's O(n²) and is simpler (30 lines vs 100)"

### Include Commands

Always include commands to:
- Run relevant tests
- View modified files
- Check current state
- Resume work

### Update Open Questions

As questions are answered:
- Update the handoff document
- Mark resolved questions
- Add new questions that emerge

---

## Handoff Lifecycle

```
1. Create handoff
   ↓
2. Another Claude reads it
   ↓
3. Updates handoff with progress
   ↓
4. Work continues
   ↓
5. Mark complete when done
   ↓
6. Archive (optional)
```

---

## Archive Old Handoffs

**When work is complete:**

```bash
mkdir -p .claude/handoffs/archive/2024-12
mv .claude/handoffs/2024-12-02-topic.md .claude/handoffs/archive/2024-12/
```

**Keep active handoffs** in `.claude/handoffs/` root
**Archive completed** handoffs by year-month

---

## Best Practices

**For handoff writer:**
- Write as if the reader knows nothing about recent work
- Include enough context to understand decisions
- Link to all relevant files and docs
- Be explicit about blockers and questions
- Err on the side of too much detail
- Include all relevant file paths
- Document all decisions (even obvious ones)
- List all commands to resume work

**For handoff reader:**
- Read the entire handoff before starting
- Verify current state matches handoff
- Update handoff as you work
- Ask user to clarify any ambiguities
