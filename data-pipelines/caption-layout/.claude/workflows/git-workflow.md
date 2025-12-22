# Git Workflow

Git practices, commit conventions, and version control guidelines.

**Inherits from:** [../../CLAUDE.md](../../CLAUDE.md) - Read universal rules first

---

## Session Start

**Always pull before starting work:**
\`\`\`bash
git pull
\`\`\`

This ensures you're working with the latest code, especially important when multiple people (or Claude instances) work on the project.

---

## Safe File Deletion

**CRITICAL: Safe `rm -rf` usage**

**NEVER:**
- `rm -rf *` - Wildcard expansion is dangerous
- `rm -rf ~/*` - Can delete entire home directory
- `rm -rf /path/outside/project` - Stay within project
- `rm -rf $VAR/*` - Variable expansion can be empty or wrong

**ONLY:**
- `rm -rf /path/to/project/specific-dir` - Explicit project paths
- `rm -rf /tmp/specific-temp-dir` - Explicit temp paths
- Always specify full, explicit paths within project

**Example - DANGEROUS:**
\`\`\`bash
# ❌ NEVER do this
rm -rf *
rm -rf ~/projects/*
rm -rf $BUILD_DIR/*  # What if $BUILD_DIR is empty or wrong?
\`\`\`

**Example - SAFE:**
\`\`\`bash
# ✅ Safe deletion
rm -rf /Users/username/project/build
rm -rf /tmp/myproject-temp-12345
rm -f /Users/username/project/specific-file.txt
\`\`\`

**Best practices:**
- Use absolute paths
- Specify exact directories/files
- Double-check path before running
- Use `rm -i` for interactive confirmation if unsure
- Never rely on globs or variable expansion with `rm -rf`

---

## Remote Configuration

**Use SSH, not HTTPS** for GitHub remotes:

\`\`\`bash
# Check current remote
git remote -v

# If using HTTPS, switch to SSH
git remote set-url origin git@github.com:username/repo.git
\`\`\`

**Benefits:**
- No password prompts
- Better security with SSH keys
- Works with git operations from scripts

---

## Commit Practices

### When to Commit

**Only create commits when explicitly requested by the user.**

If unclear whether to commit, ask first.

### Commit Message Format

**Use conventional commit format with co-authorship:**

\`\`\`bash
git commit -m "$(cat <<'EOF'
feat: add new feature description

Detailed explanation if needed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
\`\`\`

**Commit message style:**
- Use factual, technical language
- Avoid marketing terms ("New!", "Exciting!", "Amazing!", "Improved!")
- State what changed, not why it's great
- Be concise and specific

**Examples:**

\`\`\`bash
# ❌ BAD - marketing language
git commit -m "feat: New! Amazing authentication system with exciting features"

# ✅ GOOD - factual, technical
git commit -m "feat: add JWT-based authentication with refresh tokens"
\`\`\`

**Best practices:**
- Use current date from system `<env>` tag for date-related commits
- Reference current versions, not historical assumptions
- Check project dependencies for version compatibility before version bumps

### Git Hooks

**Pre-commit hooks are configured** - Run checks before commit:

\`\`\`bash
# Install hooks (one-time)
pre-commit install

# Run manually
pre-commit run --all-files
\`\`\`

Hooks run automatically on commit and will prevent commits if checks fail.

---

## Branch Strategy

*Document branch strategy if needed*

### Branch Naming

**Use descriptive branch names:**
- \`feature/description\` - New features
- \`fix/description\` - Bug fixes
- \`docs/description\` - Documentation
- \`refactor/description\` - Refactoring

---

## Pull Requests

### Creating PRs

**Use GitHub CLI:**
\`\`\`bash
# Create PR with details
gh pr create --title "Title" --body "$(cat <<'EOF'
## Summary
- Change 1
- Change 2

## Test Plan
- [ ] Test item 1
- [ ] Test item 2

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
\`\`\`

### PR Review

**Before creating PR:**
- [ ] All tests pass locally
- [ ] Code formatted (ruff)
- [ ] Type checks pass (pyright)
- [ ] Documentation updated
- [ ] Commit messages clear

---

## Next Steps

**Related guidance:**
- [Feature Development](./feature-development.md) - Development workflow
- [Bug Fixing](./bug-fixing.md) - Bug fix workflow
- [Releasing](./releasing.md) - Release workflow
