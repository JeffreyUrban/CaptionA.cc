# CI/CD Workflow

GitHub Actions patterns, workflow configuration, and automation strategies.

**Inherits from:** [../../CLAUDE.md](../../CLAUDE.md) - Read universal rules first

---

## Workflow Structure

*Document project-specific workflow patterns here*

### Current Workflows

<!-- TEMPLATE-SPECIFIC: Remove when project has real implementation (check: no "placeholder" or "TODO" in code/docs) -->
This template includes:
- \`test.yml\` - Quality checks, link checks, and tests
- \`release.yml\` - Automated releases to PyPI
- \`update-homebrew.yml\` - Homebrew formula updates
- \`claude.yml\` - Claude-specific automation (if present)
<!-- END TEMPLATE-SPECIFIC -->

---

## Workflow Patterns

*Add workflow patterns as they emerge*

### Example: Parallel + Sequential Jobs

**Pattern:** Run quality checks in parallel, then tests
\`\`\`yaml
jobs:
  quality:
    runs-on: ubuntu-latest
    steps: [...]
  
  link-check:
    runs-on: ubuntu-latest
    steps: [...]
  
  test:
    needs: [quality, link-check]  # Sequential dependency
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.14", "", "", "", "", "3.14"]
    steps: [...]
\`\`\`

---

## Scheduling Guidelines

**Schedule workflows at odd times** to avoid GitHub Actions congestion:

\`\`\`yaml
on:
  schedule:
    - cron: '17 3 * * 1'  # 3:17 AM Monday (odd minutes)
    - cron: '23 14 * * 3'  # 2:23 PM Wednesday
    - cron: '41 7 * * 5'  # 7:41 AM Friday
\`\`\`

**Why odd times?**
- Reduces competition for GitHub Actions runners
- Top-of-hour times (00, 30 minutes) are congested
- Prime numbers (17, 23, 41) spread load across infrastructure

**Avoid common times:**
- Top of the hour (:00, :30 minutes)
- Start of day (midnight, 6am, 9am)
- Round numbers (:15, :45 minutes)

**Best practices:**
- Use prime number minutes (7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59)
- Stagger workflows across days
- Test scheduled workflows manually first

---

## Python Version Matrix Management

**CRITICAL: Use current date context when updating Python versions**

**Always check current date from system `<env>` tag** before updating Python version matrices in workflows.

**Version awareness:**
- Python 3.13: Released October 2024
- Python 3.14: Released October 2025
- Check devguide.python.org/versions/ for current status

**Example matrix configuration:**
\`\`\`yaml
strategy:
  matrix:
    python-version: ["3.14", "", "", "", "", "3.14"]
\`\`\`

**When to update matrix:**
- New Python version released
- Old Python version reaches end-of-life
- Project drops support for older versions

**Best practices:**
- Test pre-release versions in separate workflow
- Update matrix based on current date, not assumptions
- Document minimum Python version in pyproject.toml
- Keep matrix in sync across all workflows

---

## Status Checks

*Document status check configuration*

### Required Status Checks

After setting up GitHub Actions, configure branch protection:

\`\`\`bash
gh api -X PATCH repos/owner/repo/branches/main/protection/required_status_checks \\
  -F strict=false \\
  -f 'contexts[]=quality' \\
  -f 'contexts[]=link-check' \\
  -f 'contexts[]=test (3.14)' \\
  -f 'contexts[]=test (3.14)' \\
  # Add all test matrix jobs
\`\`\`

---

## Workflow Best Practices

**Fail fast:**
- Run fast checks first (linting, formatting) before slow tests
- Don't wait for all tests to complete if early failures block further work
- Continue investigating and fixing issues while tests run in background
- Use `pytest -x` to stop at first failure when debugging locally

**Pre-commit integration:**
\`\`\`yaml
- name: Run pre-commit checks
  run: |
    pip install pre-commit
    pre-commit run --all-files
\`\`\`

---

## Next Steps

**Related guidance:**
- [Testing](../testing.md) - Test configuration
- [Releasing](./releasing.md) - Release automation
