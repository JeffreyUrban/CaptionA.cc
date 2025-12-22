# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working with this repository.

## Overview

This file is the **entry point** for Claude guidance. Detailed guidance is organized by scope in the `.claude/` directory.

**Philosophy:** Keep this file focused on universal rules and navigation. Put detailed, scope-specific guidance in dedicated files.

## Critical Rules

### Design Before Implementation

**MANDATORY: Before writing ANY code, ask and answer these design questions OUT LOUD to the user:**

**For API Design:**
1. "What does the ideal API for this look like, ignoring current implementation?"
2. "What would Python standard library or well-known packages do?" (e.g., itertools, csv module)
3. "Am I designing around current limitations or designing the right thing?"

**For Refactoring:**
1. "What is the clean architecture, ignoring how much code needs to change?"
2. "Where should the responsibility for X live?" (e.g., "Should output formatting live in _emit_merged_lines or in a wrapper?")
3. "Am I refactoring toward the right design, or just rearranging the current design?"

**For Any Change:**
1. "If I was building this from scratch today, would I design it this way?"
2. "Am I adding complexity to avoid changing existing complexity?"

**State your answers to these questions and get user agreement BEFORE implementing.**

### Version Numbers

**NEVER mention version numbers** (v0.x, v1.x, etc.) unless they have been explicitly agreed upon and documented in planning. Use:
- **"Stage X"** for implementation phases (e.g., "Stage 3: Pattern Libraries")
- **"Current implementation"** for what exists now
- **"Planned features"** or **"Future features"** for what's coming
- **"Milestone"** for completed work

**DO NOT** add version numbers to:
- Documentation
- Code comments
- Commit messages
- Planning documents
- Unless the user has explicitly specified and approved a versioning scheme and specific versions

### Requirements and Scope

**CRITICAL: NEVER assume content is not applicable without explicit user confirmation!**
- If the user asks you to integrate or verify content coverage, ALL content is relevant unless the user explicitly says otherwise
- NEVER mark content as "low priority" or "not applicable" based on your own judgment
- NEVER skip content because you think it's "too advanced" or "project-specific"
- If you think something might not be needed, ASK the user - do NOT decide on your own
- When asked to verify coverage, you must verify EVERY piece of content, not just what you think is important

**CRITICAL: Implement requirements correctly, don't document violations as limitations!**
- When given a requirement (e.g., "keep the most recent value"), implement it correctly
- Do NOT implement the opposite behavior and add a TODO noting it should be fixed later
- If the requirement needs clarification or would require significant changes, ASK first

### Problem-Solving Standards

**CRITICAL: Use proper solutions, not workarounds!**
- When encountering issues (especially in CI/testing), investigate the root cause
- Find the standard/best-practice solution for the problem
- Examples of workarounds to AVOID:
- Weakening test assertions to pass (e.g., changing "window-size" to "window")
- Adding `# type: ignore` comments instead of fixing type issues
- Disabling linters/checkers instead of fixing the underlying issue
- Examples of proper solutions:
- Setting environment variables for consistent behavior (e.g., `COLUMNS` for terminal width)
- Using appropriate imports for Python version compatibility (e.g., `Optional` vs `|`)
- Configuring tools correctly in config files
- If unsure whether a solution is a workaround or proper fix, ASK the user

### Data Safety

**CRITICAL: Protect user's work products!**

**Before modifying files containing user data/work:**
1. **STOP and assess risk**: Hours of work? Irreplaceable?
2. **Suggest backup FIRST**: "Let's backup X before making changes"
3. **Test on sample data**: Never test destructive operations on real data
4. **Design for safety**: Default behavior should preserve, not destroy

**For "resume" or "state tracking" features:**
- Resume means "skip already done" NOT "overwrite existing output"
- Must test with BOTH empty state AND existing output files
- When in doubt: preserve existing files, don't touch them

**Red flags requiring extra caution:**
- Modifying output files that took >30 minutes to generate
- Implementing "skip" or "resume" logic
- Batch operations on user's work products
- State tracking that touches existing files

**Testing requirement for data-modifying code:**
Before recommending user run ANY code that modifies their files or data:
- Test it yourself if possible, OR
- Explicitly tell user "I haven't tested this - please test on sample data first"
- For data-modifying operations: ALWAYS suggest backup first

### Documentation Standards

**Evidence-Based Documentation:**
- Distinguish between **observed facts** and **inferred causes**
- Use precise language: "observed", "measured", "specified by user" vs "causes", "due to", "because"
- When debugging, document what was tried and what was observed, not assumed root causes
- If stating a cause, cite the evidence or mark as hypothesis

**When Asked to Justify Decisions:**
- If the user asks why you made a decision or assumption, search documentation and code comments for supporting evidence
- Present the evidence with specific references (file paths and line numbers where applicable)
- If no supporting evidence is found, acknowledge the assumption and ask for clarification
- Example: "I assumed X based on the comment at normalization_engine.py:117 which states '...'"

## Navigation

### Scope-Specific Guidance

Claude guidance is organized by scope:

- **[Development](.claude/development.md)** - Coding standards, patterns, tools, modern practices
- **[Testing](.claude/testing.md)** - Test strategy, pytest, coverage, oracle testing
- **[Documentation](.claude/documentation.md)** - Doc standards, MkDocs, Sybil, doc testing
- **[Data Safety](.claude/data-safety.md)** - Protecting user work, backup strategies, safe defaults
- **[Workflows](.claude/workflows/)** - Common task workflows and checklists
- **[Handoffs](.claude/handoffs/)** - Context preservation between Claude instances

### Project Documentation

Key documentation by purpose:

**User Documentation:**
- **[README.md](./README.md)** - Project overview and installation

**Design Documentation:**
- **[dev-docs/design/IMPLEMENTATION.md](./dev-docs/design/IMPLEMENTATION.md)** - Implementation overview and design decisions
- **[dev-docs/design/ALGORITHM_DESIGN.md](./dev-docs/design/ALGORITHM_DESIGN.md)** - Detailed algorithm design
- **[dev-docs/design/DESIGN_RATIONALE.md](./dev-docs/design/DESIGN_RATIONALE.md)** - Design rationale and trade-offs

**Planning Documentation:**
- **[dev-docs/planning/PLANNING.md](./dev-docs/planning/PLANNING.md)** - Roadmap and feature planning

**Testing Documentation:**
- **[dev-docs/testing/TESTING_STRATEGY.md](./dev-docs/testing/TESTING_STRATEGY.md)** - Test strategy and organization
- **[dev-docs/testing/TEST_COVERAGE.md](./dev-docs/testing/TEST_COVERAGE.md)** - Test coverage plan
- **[dev-docs/testing/ORACLE_TESTING.md](./dev-docs/testing/ORACLE_TESTING.md)** - Oracle-based testing approach

## Project Context

**Tech Stack:**
- **Language:** Python 3.14+
- **CLI Framework:** typer + rich
- **Testing:** pytest with organized markers
- **Documentation:** MkDocs Material with Sybil (tested code examples)
- **Code Quality:** ruff (lint + format) + pyright (type checking)
- **Package Management:** uv for fast installs
- **Version Control:** Git with conventional commits

**Project Structure:**
- `src/caption-layout/` - Source code
- `tests/` - Test files with pytest markers
- `docs/` - MkDocs documentation with tested examples
- `dev-docs/` - Design and planning documentation
- `.claude/` - Claude guidance files (this system)

**Current Date & Version Awareness:**
- **IMPORTANT:** Always check the current date in the system `<env>` tag
- When searching or making decisions based on versions/dates, use the current date from `<env>`, NOT historical information
- Python 3.13 was released in October 2024
- Python 3.14 was released in October 2025 (per devguide.python.org/versions/)

<!-- TEMPLATE-KICKOFF-SPECIFIC: Remove immediately after initial project kickoff -->
## Initial Project Kickoff

**This section defines project kickoff tasks for Claude Code to handle immediately after cookiecutter project generation.**

When the user starts working on the freshly generated project, Claude should:

### 1. Update Python Version Support

Check the status of Python versions from https://devguide.python.org/versions/

```bash
# Check the current date from system <env> tag
# Determine a range of supported Python versions based on:
# - Minimum version: The most recent end-of-life version (include it)
# - Maximum version: Latest numbered supported version (not main)
# Example: If 3.4 is end-of-life and 3.5-3.9 are supported, use range 3.4-3.9
```

Replace the `PYTHON_VERSION_*_KICKOFF` placeholders with actual version numbers:
- "3.14"
- "PYTHON_VERSION_INTERMEDIATE_<integer>_KICKOFF"
- 3.14

Search throughout the project and ensure all instances are replaced.

### 2. Configure Project Metadata

Review and update if needed:
- [ ] `pyproject.toml` - Verify author, description, repository URL
- [ ] `LICENSE` - Verify license matches project intent
- [ ] `README.md` - Verify badges have correct repository path

### 3. Verify Template Generation

Check that cookiecutter variables were properly substituted:
```bash
# Look for any remaining template syntax
grep -r "{{cookiecutter\." . --exclude-dir=.git
grep -r "TEMPLATE_PLACEHOLDER" . --exclude-dir=.git
```

Check that all kickoff placeholders have been replaced:
```bash
# Should return no results after kickoff is complete
grep -r "PYTHON_VERSION_.*_KICKOFF" . --exclude-dir=.git
```

### 4. Initialize Development Environment

If not already done:
```bash
uv venv
source .venv/bin/activate  # or activate.fish, activate.ps1
uv pip install -e ".[dev,docs]"
pre-commit install
```

### 5. Run Initial Checks

Run quality checks (some may have warnings with template placeholders - that's expected):
```bash
ruff format .
ruff check .
pytest
```

**Note:** Skip `pyright` and `mkdocs build` during kickoff - they may fail with template placeholders. These will pass once you implement your project logic.

### 6. Gitignore Local Settings

Add `.claude/settings.local.json` to `.gitignore` so users can customize permissions without committing:
```bash
echo "" >> .gitignore
echo "# Claude Code local settings" >> .gitignore
echo ".claude/settings.local.json" >> .gitignore
```

### 7. Remove This Section

After completing initial kickoff tasks:
- [ ] Delete this "Initial Project Kickoff" section (lines 147-XXX)

**DO NOT create a git commit** - the user will handle git initialization and commits per the README workflow.

**When to skip this section:**
- Project already has commits beyond initial template generation
- User explicitly says to skip initial setup
- Project has real implementation (no placeholders remaining)

<!-- END TEMPLATE-KICKOFF-SPECIFIC -->

## Universal Workflows

### Git & Commits

**Session Start:**
- Always `git pull` when starting work on a project with a git repository
- Ensures you're working with the latest code, especially when multiple people or Claude instances work on the project

**Remote Configuration:**
- Use SSH for GitHub remotes, not HTTPS
- Check: `git remote -v`
- Switch if needed: `git remote set-url origin git@github.com:username/repo.git`

**Only create commits when requested by the user.** If unclear, ask first.

When creating commits:
- Follow conventional commit format
- Include co-authorship footer:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
- See detailed commit workflow in system instructions

### Tool Usage

- **Proactively use Task tool** with specialized agents when the task matches the agent's description
- **Use dedicated tools** instead of bash for file operations (Read/Edit/Write, not cat/sed)
- **Run tools in parallel** when they're independent (multiple reads, searches, etc.)
- See [Development](.claude/development.md) for tool-specific guidance

### Communication

- **Be concise** - CLI output is displayed in terminal
- **Use markdown** - GitHub-flavored markdown for formatting
- **Avoid emojis** unless explicitly requested
- **Output text directly** - never use bash echo or comments to communicate
- **Don't be markety** - Avoid promotional language, "New!" callouts, or marketing-style announcements

**Background Jobs:**
- **ALWAYS provide full transparency** when running background jobs
- When running any command in the background, you MUST immediately tell the user:
  1. **What command you're running** - show the exact command with full path and arguments
  2. **Why you're running it in background** - explain the purpose and expected duration
  3. **Shell ID** - provide the background job ID so user can manage it
  4. **How to monitor it** - show commands to check status, view output, or kill it
- **Example good communication:**
  ```
  Running in background (shell ID: abc123):
    command: python3 scripts/comprehensive_mining.py --category personal_branding
    purpose: Mining 6 documents, takes ~5-10 minutes

  To monitor: Use /tasks or BashOutput tool with bash_id: abc123
  To kill: Use /kill abc123
  ```
- Background jobs are appropriate for long-running operations (>30 seconds)
- The user needs enough information to manage the job themselves

## Handoffs Between Claude Instances

**When transitioning work to another Claude instance:**

1. **Create handoff document** in `.claude/handoffs/YYYY-MM-DD-topic.md`
2. **Document state**: What's complete, in progress, blocked
3. **List decisions**: Key technical decisions and rationale
4. **Note open questions**: Ambiguities or needed clarifications
5. **Provide commands**: How to resume work

See [Handoffs README](.claude/handoffs/README.md) for detailed template and guidance.

**When to create handoffs:**
- Switching Claude instances mid-task
- End of session with incomplete work
- Blocked by external dependency
- Complex feature requiring context preservation

## Maintenance Rules

**When code works correctly:**
- Remove outdated code and documentation
- Update relevant documentation
- Add test cases for issues found and fixed

**Before creating directory structures:**
- Discuss scope and organization with user
- Don't create documentation/planning hierarchies without approval

## Getting Started

1. **Review this CLAUDE.md** for universal rules and navigation
2. **Check scope-specific guidance** in `.claude/` for your current task:
   - Adding features? → [Development](.claude/development.md)
   - Writing tests? → [Testing](.claude/testing.md)
   - Updating docs? → [Documentation](.claude/documentation.md)
   - Modifying user data/output? → [Data Safety](.claude/data-safety.md)
3. **Reference project documentation** in `dev-docs/` for design decisions
4. **Follow workflows** in `.claude/workflows/` for common tasks

## About This Structure

**Why split CLAUDE.md?**
- Main file stays focused and navigable
- Scope-specific details don't clutter universal rules
- Different Claude instances can focus on relevant guidance
- Easier to maintain and update

**When to update:**
- **This file:** Universal rules, navigation, project context
- **`.claude/*.md`:** Scope-specific patterns, standards, examples
- **`dev-docs/`:** Design decisions, architecture, rationale
- **`docs/`:** User-facing documentation

**File organization principle:**
- `CLAUDE.md` - Project-wide rules, entry point (this file)
- `.claude/*.md` - Specialized guidance by scope
- `dev-docs/**/*.md` - Design decisions, architecture
- `docs/**/*.md` - User-facing documentation

**Never** put implementation details in CLAUDE.md files - link to dev-docs or code instead.
