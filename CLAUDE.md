# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working with this repository.

## Session Isolation

**CRITICAL: Each worktree requires an isolated Claude Code session.**

- Start fresh sessions in each worktree - do NOT continue sessions across worktrees
- All context must come from documentation (CLAUDE.md, PROJECT.md, etc.), not chat history
- Each Claude instance works only in its assigned worktree directory
- This prevents cross-contamination and forces documentation to be the source of truth

If you find yourself with context from another worktree, the session was incorrectly continued. Ask the user to start a
fresh session.

## Your Name

At the start of each session, read your name in the `.claude-name` file in the repository root:

```bash
MY_NAME=$(cat .claude-name)
```

Use this name when creating PR comments (prefix with **[$MY_NAME]**)

**Example:**

```
**[bob]** All CI checks passing ✓
```

## Quick Links

- **[PROJECT.md](./PROJECT.md)** - Architecture vision, technology stack, design decisions
- **[SCHEMA.md](./SCHEMA.md)** - Data models and database schema
- **[development.md](./.claude/development.md)** - Environment setup, running services, deployment
- **[testing.md](./.claude/testing.md)** - Comprehensive testing practices and pytest usage
- **[documentation.md](./.claude/documentation.md)** - Documentation standards and lifecycle

## Critical Guardrails

**Monorepo Architecture - No Cross-Dependencies Between Apps/Services/Pipelines:**
→ **NEVER create imports between apps, services, or data-pipelines**

**Forbidden Patterns:**

```python
# ❌ NEVER: App importing from another app
from apps.web.app.models import Episode

# ❌ NEVER: Pipeline importing from app
from apps.web.app.database import SessionLocal

# ❌ NEVER: Service importing from pipeline
from data_pipelines.clip_content.utils import process_clip
```

**Correct Patterns:**

```python
# ✅ ALWAYS: Import from shared packages
from captionacc_db.models import Episode

# ✅ ALWAYS: Each app/service/pipeline creates its own engine
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
engine = create_engine(database_url, pool_size=5)
SessionLocal = sessionmaker(bind=engine)

# ✅ ALWAYS: Share code via packages/ directory
from captionacc_db.models import Show, Episode, Content
```

**Monorepo Structure:**

```
apps/           # Web applications (no imports between apps)
services/       # Microservices (no imports between services)
data-pipelines/ # Data processing scripts (no imports from apps/services)
packages/       # Shared code - ONLY place for shared dependencies
  └── data_access/
      ├── alembic/         # Database migrations (schema evolution)
      ├── alembic.ini      # Migration configuration
      └── captionacc_db/
          └── models/      # Shared database models (schema definitions)
```

**Dependency Rules:**

- ✅ `apps/web` → `packages/data_access` (shared models)
- ✅ `data-pipelines/clip-content` → `packages/data_access` (shared models)
- ✅ `services/clip` → `packages/data_access` (shared models)
- ❌ `apps/web` → `data-pipelines/*` (NO!)
- ❌ `services/*` → `apps/web` (NO!)
- ❌ `data-pipelines/*` → `apps/web` (NO!)

**When to Create Shared Code:**

1. Code is needed by 2+ apps/services/pipelines → Create in `packages/`
2. Database models → Always in `packages/data_access/captionacc_db/models/`
3. Database migrations → Always in `packages/data_access/alembic/`
4. Database engine → NEVER shared, each app creates its own
5. Utilities used by multiple components → Create new package in `packages/`

**Complete Integration - No Orphaned Artifacts:**
→ **NEVER create software artifacts (code, config, SQL files) that aren't actually used**

- Software artifacts must be USED by the system or REMOVED
- Do NOT create config files "for reference" - that's what .md documentation is for
- Do NOT create modules "as examples" - that's misleading
- If you create a config file, the code MUST load and use it
- If you create a module, it MUST be imported and called
- Do NOT add TODO/NOTE comments saying work remains - complete the work
- **Exception:** Draft code explicitly presented for user review before completion
- A task is NOT complete until all artifacts are fully integrated and working
- **Test that your changes actually work** - don't assume

**Collaborative Learning - You Are not Just an Assistant, but also a Tutor, :**
→ **Proactively teach modern best practices and explain tradeoffs**

**When making implementation decisions:**

1. **For established project preferences** → Use them directly
2. **For new tools/patterns without precedent** → Pause and teach:
    - Explain the modern approach vs legacy alternative
    - Describe why it's better and what tradeoffs exist
    - Recommend what fits this use case
    - Wait for agreement before proceeding
3. **For best practice opportunities** → Point them out proactively:
    - "I notice this uses bare `except:`. Best practice is specific exceptions because..."
    - "This would benefit from Python 3.11's `TaskGroup()` because..."
    - "Consider using `httpx` instead of `requests` here for async support..."
4. **When encountering outdated patterns** → Suggest modern alternatives:
    - Explain what's legacy vs what's modern and mature
    - Focus on proven improvements, not bleeding edge experiments

**Teaching principles:**

- Explain WHY, not just WHAT
- Show tradeoffs between approaches
- Use code examples with explanatory comments
- Focus on learning opportunities, not just corrections
- Be open to discussion - there may be good reasons for current approach

**Git Workflow - Branch-Based Development with Worktrees:**
→ **Claude works on feature branches using git worktrees for parallel work**

**Core Rules - ALWAYS FOLLOW:**

- **🚨 NEVER COMMIT TO `main` BRANCH 🚨** - No exceptions, regardless of worktree
    - All work goes through PRs, even in main worktree
    - Always create a feature branch first: `git checkout -b fix/description`
    - If you commit to main by accident, immediately move commits to feature branch
- **ALWAYS work on feature branches** - Even for tiny fixes in main worktree
- **Claude CAN commit to feature branches** - Commit frequently with clear messages
- **Claude CANNOT merge PRs** - User reviews and merges all PRs
- **In main worktree: ASK before creating branches** - User may want specific branch name
- **In feature worktree: CREATE branches proactively** - More autonomous workflow

**Worktree Workflow:**

User starts Claude instances in separate worktrees for parallel work:

```bash
# User creates worktrees (one per Claude instance)
git worktree add ../captionacc-claude1 main
git worktree add ../captionacc-claude2 main

# Each Claude instance works in its worktree
# Terminal 1: cd ~/PycharmProjects/captionacc-claude1
# Terminal 2: cd ~/PycharmProjects/captionacc-claude2
```

**Claude's Git Operations on Feature Branches:**

```bash
# In worktree, Claude creates feature branch
git checkout -b feature/authentication

# You commit and push FREQUENTLY (easier recovery, show progress)
git add .
git commit -m "$(cat <<'EOF'
[Worktree: captionacc-auth] Add JWT authentication middleware

Implemented token-based authentication using JWT.
EOF
)"
git push origin feature/authentication

# Continue working, commit and push after each logical change
git add .
git commit -m "$(cat <<'EOF'
[Worktree: captionacc-auth] Add authentication tests

Unit and integration tests for JWT middleware.
EOF
)"
git push origin feature/authentication

# Create PR when feature complete or ready for review
gh pr create --title "..." --body "..."  # Regular PR, not draft

# You comment on PRs to provide context
gh pr comment <pr-number> --body "**[$MY_NAME]** Initial implementation complete. Ready for review."

# User reviews PR, requests changes or merges
# User cleans up worktree after merge
```

**Push Frequency:** After each commit. This allows user to see progress and makes recovery easier if needed.

**Branching Strategy:**

**DEFAULT: Always branch from `main` without direct checkout**

```bash
git fetch origin main
git checkout -b feature/new-feature origin/main
```

**User Communication Convention:**

When user says **"new branch: X"** → Create new branch from main and work on X

Examples:

- "new branch: Add validation to API" → Creates `feature/add-validation-to-api` from main
- "new branch: Fix auth timeout" → Creates `fix/auth-timeout` from main
- Just "X" while on feature branch → Ask if continue current branch or create new

This convention avoids repeating "Create a new branch from the latest main and..." each time.

**Example mistake to avoid:**

```bash
# ❌ BAD: Branching from another feature branch
git checkout feature/stage1
git checkout -b feature/stage2  # Creates stacked PR!

# ✅ GOOD: Branch from main (or origin/main in worktree)
git fetch origin main
git checkout -b feature/stage2 origin/main
```

**When stacking IS acceptable:**

- Features genuinely depend on each other
- Document dependency clearly in PR description
- Merge in order (base feature first, then dependent)

**Worktree Isolation - CRITICAL:**

**NEVER change directories to a different worktree without asking permission**

```bash
# ❌ FORBIDDEN: Switching to different worktree
cd /Users/jurban/PycharmProjects/captionacc  # Main worktree
cd /Users/jurban/PycharmProjects/captionacc-auth  # Different worktree

# ✅ CORRECT: Stay in assigned worktree
pwd  # Check where you are
# Work only in the directory where you were started
```

**Rules:**

1. **Stay in your assigned worktree** - If started in `captionacc-claude2/`, stay there
2. **Never `cd` to main worktree or other worktrees** - Each Claude instance has its workspace
3. **If you need different worktree:** Ask user to create it or give permission
4. **Check your location:** Run `pwd` before git operations to verify you're in the right place
5. **Main worktree is shared:** Only user works there by default

**Collaboration Style by Worktree:**

The worktree you start in determines the collaboration approach:

- **Main worktree (`captionacc/`)**: Pair programming mode
    - 🚨 Still NEVER commit to main - always use feature branches
    - ASK before creating feature branches (user may want specific name)
    - ASK before commits, tests, running services
    - User drives the workflow decisions
    - Less autonomous, more interactive
    - Example: "Should I create a `fix/worktree-scripts` branch for these changes?"

- **Feature worktree (`captionacc-*/`)**: Autonomous mode
    - Work independently on feature branches (still never commit to main)
    - CREATE feature branches proactively without asking
    - COMMIT and PUSH proactively after each logical change
    - CREATE PRs when feature is ready
    - More autonomous, less interactive
    - Example: Directly create `fix/auth-timeout` and start committing

**Branch Naming Convention:**

- `feature/{description}` - New features (e.g., `feature/rate-limiting`)
- `fix/{description}` - Bug fixes (e.g., `fix/auth-timeout`)
- `refactor/{description}` - Refactoring (e.g., `refactor/database-layer`)
- `docs/{description}` - Documentation (e.g., `docs/api-guide`)

**Commit Message Format:**

```
[$MY_NAME] Brief summary of change (imperative mood, <50 chars)

More detailed explanation if needed:
- Bullet points for multiple changes
- Reference issues: Fixes #123
```

**Commit Header Rules:**

- Always include `Claude: $MY_NAME` in commit body
- Place at beginning of top line
- Enables filtering: `git log --grep="Claude: captionacc-claude2"`
- Makes it clear which Claude instance made the change

**What Claude CANNOT do:**

- Commit to `main` branch
- Merge any PR (including own PRs)
- Push to main branch
- Delete branches
- Force push
- Rebase without discussion

**What Claude CAN do:**

- Create feature branches in worktrees
- Commit to feature branches frequently
- Push feature branches after each commit
- Create PRs (regular PRs, ready for review)
- Comment on PRs
- Check PR status with `gh` CLI
- Push frequently to show progress and enable easier recovery

**Reference:** See [WORKTREE_GUIDE.md](WORKTREE_GUIDE.md) for detailed worktree usage.

**PR Commenting - Claude Identification:**
→ **Claude instances comment on PRs to provide context and track which Claude made changes**

**When to comment on PRs:**

1. **When creating the PR** - Initial comment summarizing changes and approach
2. **After significant pushes** - When completing major milestones or addressing review feedback
3. **Before marking work complete** - Final summary when all todos done and ready for review

**Comment format:**

```markdown
**[captionacc-claude2]** Summary of changes made in this PR:

- Key change 1
- Key change 2
- Rationale for approach taken

Ready for review.
```

**Comment identification rules:**

- Use your name in square brackets: `**[$MY_NAME]**`
- Keep comments concise and focused on "why" not "what"
- Include rationale for non-obvious decisions
- Link to specific commits when relevant

**Example PR comment command:**

```bash
MY_NAME=$(cat .claude-name)

# Comment on PR
gh pr comment <pr-number> --body "**[$MY_NAME]** Summary here..."
```

**PR Check Monitoring and Main Branch Synchronization:**
→ **Proactively monitor PR checks and sync with main before creating PRs**

**Merging main into feature branches:**

DEFAULT: Sync with main BEFORE creating PR, not during development

```bash
# Before opening PR (in worktree, can't checkout main directly):
git fetch origin main
git merge origin/main  # Resolve conflicts if any
git push
gh pr create ...
```

**Proactive PR Monitoring in Worktrees:**

Claude should proactively check ALL PRs from local branches in the worktree:

```bash
# Check all local branches (except main) for open PRs
for branch in $(git branch --format='%(refname:short)' | grep -v '^main$'); do
  pr_info=$(gh pr list --head "$branch" --json number,title,statusCheckRollup 2>/dev/null)
  if [ -n "$pr_info" ]; then
    echo "Branch $branch: $pr_info"
  fi
done
```

**When to check proactively (without asking):**

1. **After creating PR**: Wait 120s, check status, report results
2. **Before declaring work complete**: Verify all PRs have passing checks

**Fixing Failed Checks:**

When checks fail, fix immediately (don't ask):

```bash
# 1. Switch to failing branch
git checkout feature/failing-branch

# 2. Run checks locally to identify issues
ruff check .           # Linting
pyright                # Type checking
pytest                 # Tests

# 3. Fix issues and commit
git add .
git commit -m "Fix CI: <specific issue>"
git push

# 4. Verify fix
sleep 120
gh pr checks

# 5. Report results, move to next PR if needed
```

**Action over Questions:**

- ✓ "Checking PRs..." not "Should I check PRs?"
- ✓ "Fixing lint errors..." not "Want me to fix lint errors?"
- ✓ "PR #123 passing ✓, PR #124 has test failures - fixing now"

**When Creating/Updating Documentation:**
→ **MUST reference [documentation.md](./.claude/documentation.md)** before writing or revising any .md files

- Do NOT include code examples that duplicate actual implementation
- Do NOT include configuration values - reference file location and provide guidance
- Put function details in docstrings, NOT in external docs
- Work product docs describe current reality (no "Next Steps", "TODO", "Phases")
- Do NOT include "Recommended", "Best Practices", or "Alternatives" in work product docs
- Do NOT write manual setup instructions when you can create the actual configuration artifacts:
    - IDE run configurations → Create `.run/*.xml` files (not instructions)
    - File watchers → Create `.idea/watcherTasks.xml` (not instructions)
    - Scripts → Create actual scripts (not manual step-by-step guides)

**Testing Requirements:**
→ **Reference [testing.md](./.claude/testing.md)** when writing tests or test fixtures

- **Never access production database** in tests - use isolated test fixtures
- **Use realistic test data** from production (anonymized) rather than placeholder data
- **All new code requires tests** - testing is not optional

**Development Operations:**
→ **Reference [development.md](./.claude/development.md)** for environment setup, deployment, workflows

- Don't duplicate setup instructions in other docs

**Code Quality:**

- **Type hints required** for function signatures
- **Docstrings required** for public functions/classes
- **Avoid magic numbers** - use named constants
- **120 character line limit**, single quotes, ruff-compliant

**Quality Tools:**
→ **New projects automatically inherit quality tools from workspace**

See [development.md - Quality Tools Setup](./.claude/development.md#quality-tools-setup) for:

- How workspace inheritance works
- How to add new projects
- CI validation that prevents misconfiguration

## Modern Tools & Techniques Philosophy

**Approach:** Favor modern, mature tools over legacy approaches. Not bleeding edge, but proven improvements.

**When relevant, consider these modern alternatives:**

**Command-line tools:**

- `ripgrep` (rg) over `grep`, `fd` over `find`, `bat` over `cat`, `exa/eza` over `ls`
- `gh` for GitHub operations
- Use these in scripts and documentation when appropriate

**When to introduce new tools:**

- Pause to discuss significant new dependencies
- Explain benefits over alternatives
- Consider: maintenance status, community adoption, learning curve
- Prefer well-established tools (2+ years, active maintenance) over brand new

## Project Structure

**Monorepo Organization:**

```
captionacc/
├── apps/                    # Applications (web, mobile, etc.)
│   └── web/                # FastAPI web application
│       ├── app/
│       │   ├── database.py # Web app's engine configuration
│       │   ├── api/        # API endpoints
│       │   ├── services/   # Business logic
│       │   └── templates/  # Chameleon templates
│       └── tests/          # Web app tests
│
├── services/                # Microservices (clip service, etc.)
│   └── clip/               # Audio clip extraction service
│
├── data-pipelines/          # Data processing scripts
│   ├── captions/           # Caption extraction
│   └── clip-content/       # Clip transcription & alignment
│       └── transcribe-clips/
│           └── transcribe_clips.py  # Creates own engine
│
└── packages/                # Shared code (ONLY place for shared dependencies)
    └── data_access/
        └── captionacc_db/
            └── models/      # Shared SQLAlchemy models
```

**Key Principle:** Apps, services, and pipelines NEVER import from each other. They only import from shared `packages/`.

## Key Development Patterns

**Database Access:**

**CRITICAL:** Follow monorepo architecture rules (see Critical Guardrails above):

- ✅ Import models from `captionacc_db` package
- ✅ Each app/service/pipeline creates its own engine
- ❌ NEVER import from `apps/`, `services/`, or `data-pipelines/`

Models are shared via `captionacc_db` package. Each app/service creates its own engine:

```python
from sqlalchemy.orm import Session
from captionacc_db.models import Episode, Show, Content

# In web app (apps/web/app/database.py already configured)
from app.database import get_db
from fastapi import Depends

@app.get("/episodes/{episode_id}")
def get_episode(episode_id: int, db: Session = Depends(get_db)):
    return db.query(Episode).filter(Episode.id == episode_id).first()

# In data pipelines - create your own engine
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

engine = create_engine(
    database_url,
    pool_size=20,      # Configure for your pipeline's needs
    max_overflow=40,   # Parallel processing requires larger pool
    pool_pre_ping=True
)
SessionLocal = sessionmaker(bind=engine)

db = SessionLocal()
try:
    episode = db.query(Episode).filter(Episode.id == episode_id).first()
finally:
    db.close()
```

**Database Organization:**

- **Models** (shared): `packages/data_access/src/captionacc_db/models/`
    - Import: `from captionacc_db.models import ModelName`
    - Contains ONLY model definitions, no engine
    - Organized by domain: media.py, clips.py, captions.py, users.py, etc.
- **Migrations** (shared): `packages/data_access/alembic/`
    - Run from: `cd packages/data_access && uv run alembic upgrade head`
    - Schema evolution centralized with models (not scattered across apps)
- **Engine** (per-app): Each app/service configures its own
    - Web app: `apps/web/app/database.py` (small pool: 5+10)
    - Pipelines: Create in script (large pool: 20+40)
    - Why? Different apps need different pool sizes, timeouts, etc.
- **Architecture**: Apps import models from `captionacc_db`, create their own engines, migrations run separately

**See:**

- [packages/data_access/README.md](./packages/data_access/README.md) - Package usage, installation, migrations
- [SCHEMA.md](./SCHEMA.md) - Complete model specifications

## Documentation Standards

**See [documentation.md](./.claude/documentation.md) for complete documentation standards.**

**Three Types of Documentation:**

1. **Planning Documentation** (temporary) - Design explorations, implementation plans, "Next Steps", "TODO"
2. **Progress Documentation** (temporary) - "What We've Built", implementation status
3. **Work Product Documentation** (permanent) - Current implementation, usage, architecture decisions

**Key Principles:**

- Work is not complete until documentation is production-ready
- Planning/progress docs are valuable during development - archive after completion
- Work product docs describe current reality, not plans or history
- Put function details in docstrings, not external docs
- Reference code locations, don't duplicate values or implementation
- Preserve design rationales when converting planning → work product docs

**Before creating directory structures:** Discuss scope and organization with user

## Common Task Checklists

### Creating New Features

1. Check **PROJECT.md** for architecture alignment
2. **Write tests** (TDD or alongside implementation):
    - Create fixtures with realistic data
    - Unit tests for pure functions
    - Integration tests for database operations
    - Mark with `@pytest.mark.unit`, `@pytest.mark.integration`, etc.
3. Implement in appropriate layer:
    - FastAPI route in `api/`
    - Business logic in `services/`
    - Database models in `models/`
    - Chameleon template for UI
4. **Verify tests pass**: `pytest`
5. Update documentation if adding new patterns

**Testing is not optional** - All features require tests with isolated databases and realistic data.

### Database Schema Changes

1. Update models in (TODO: update location of models)
2. Create migration: `alembic revision --autogenerate -m "description"`
3. Review migration SQL
4. Test on dev database
5. Update API/services using modified models

## Project Context for Claude Code

**Architecture:**

- Solo developer optimized - prioritize maintainability and simplicity
- Database: Currently SQLite, write DB-agnostic SQLAlchemy code for future migration

**Development Philosophy:**

- **Testing Required** - All code needs pytest tests with isolated databases and realistic fixtures
- **Mobile Support** - Design for desktop, tablet, and mobile web from start
- **SaaS Friendly** - Open to third-party services for auth, payments, mail, etc.

## Reference Documentation

**Project Guides:**

- [PROJECT.md](./PROJECT.md) - Architecture vision and design decisions
- [SCHEMA.md](./SCHEMA.md) - Data models and database schema
- [development.md](./.claude/development.md) - Environment setup, deployment, workflow
- [testing.md](./.claude/testing.md) - Comprehensive testing practices
- [documentation.md](./.claude/documentation.md) - Documentation standards and lifecycle
