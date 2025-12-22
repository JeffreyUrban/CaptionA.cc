# Feature Development Workflow

Step-by-step workflow for developing new features.

**Inherits from:** [../../CLAUDE.md](../../CLAUDE.md) - Read universal rules first

---

## Before You Start

<!-- TEMPLATE-SPECIFIC: Remove when project has real implementation (check: no "placeholder" or "TODO" in code/docs) -->
**Understand the template-based project approach:**
- This project uses a template designed to be release-ready from day one
- **Fill in** template content, don't delete and recreate
- **Keep** all infrastructure (badges, CI, docs) even if not yet functional
- **Adapt** existing examples rather than starting from scratch
- See CLAUDE.md for full template philosophy
<!-- END TEMPLATE-SPECIFIC -->

**Read relevant guidance:**
- [Development](../development.md) - Code standards
- [Testing](../testing.md) - Test requirements
- [Documentation](../documentation.md) - Doc requirements

**Understand the requirement:**
1. Clarify scope with user
2. Review related design docs
3. Check for existing patterns

**CRITICAL: Implement requirements correctly**
- When given a requirement, implement it as specified
- Do NOT implement opposite behavior with a TODO to fix later
- If requirement needs clarification, ASK before implementing
- If requirement conflicts with architecture, DISCUSS before implementing

---

## Workflow

### 1. Plan (if complex)

For complex features requiring multiple approaches or significant changes, use EnterPlanMode:
- Explore codebase
- Design implementation approach
- Get user approval before implementing

For simple features, proceed directly to implementation.

### 2. Document Design (if needed)

**Update design docs:**
- `dev-docs/design/IMPLEMENTATION.md` - Implementation approach
- `dev-docs/design/DESIGN_RATIONALE.md` - Why this approach

**Create todo list:**
Use TodoWrite to track implementation steps.

### 3. Write Tests (TDD approach)

**Create test file:**
```bash
tests/test_new_feature.py
```

**Write failing tests:**
```python
import pytest
from caption-layout import new_feature

@pytest.mark.unit
def test_new_feature_basic():
    """Test basic functionality."""
    result = new_feature.process("input")
    assert result == "expected"

@pytest.mark.unit
def test_new_feature_edge_case():
    """Test edge case."""
    result = new_feature.process("")
    assert result is None
```

**Run tests (should fail):**
```bash
pytest tests/test_new_feature.py
```

### 4. Implement Feature

**Create module:**
```python
# src/caption-layout/new_feature.py

def process(input: str) -> str | None:
    """Process input and return result.

    Args:
        input: Input string to process

    Returns:
        Processed result or None if empty
    """
    if not input:
        return None
    return f"processed: {input}"
```

**Run tests (should pass):**
```bash
pytest tests/test_new_feature.py
```

### 5. Update CLI (if needed)

**Add command to cli.py:**
```python
@app.command()
def new_feature(
    input: str = typer.Argument(..., help="Input value"),
):
    """Description of new feature."""
    result = process(input)
    if result:
        console.print(f"[green]{result}[/green]")
```

**Test CLI:**
```bash
caption-layout new-feature "test"
```

### 6. Update Documentation

**User documentation:**
- Add feature description to `docs/features/`
- Add example to `docs/examples/`
- Update `docs/reference/cli.md` if CLI changed

**CRITICAL: Documentation examples must be executable:**
- All code examples are tested via Sybil
- Create fixture files for examples that reference files
- Use `<!-- verify-file: output.txt expected: expected.txt -->` for testable output
- Examples run from fixtures directory (conftest.py handles this)

**Example with verification:**
````markdown
<!-- verify-file: output.txt expected: expected-output.txt -->
\```python
from caption-layout import process
from pathlib import Path

with open("input.txt") as f:  # Must exist in fixtures/
    with open("output.txt", "w") as out:
        process(f, out)
\```
````

**Documentation is code:** Treat examples with same rigor as production code.

**Example:**
````markdown
## New Feature

Description of what it does.

### Usage

\```console
$ caption-layout new-feature "input"
processed: input
\```

### Examples

Basic usage:
\```console
$ caption-layout new-feature "hello"
processed: hello
\```
````

**Design documentation:**
- Update `dev-docs/design/IMPLEMENTATION.md` if architecture changed

### 7. Run Quality Checks

```bash
pre-commit run --all-files  # Runs all quality checks, tests, docs
```

### 8. Verify Everything

**Checklist:**
- [ ] Tests pass
- [ ] Coverage maintained or improved
- [ ] Linter passes
- [ ] Type checker passes
- [ ] Documentation updated
- [ ] Doc examples tested
- [ ] Feature works end-to-end

### 8.5. Update CHANGELOG (if maintained)

**If project has CHANGELOG.md:**
- Add concise summary of the change
- List files involved (summarize if many files changed)
- Follow existing format in CHANGELOG.md
- Document **major** features and changes

**Example entry:**
```markdown
### Added
- New feature X providing Y capability (src/module.py, tests/test_module.py)
```

### 9. Commit (if user requests)

Only create commits when user asks. See main CLAUDE.md for commit workflow.

---

## Common Patterns

### Adding CLI Option

```python
@app.command()
def existing_command(
    new_option: bool = typer.Option(False, "--new-option", help="Description"),
):
    """Command description."""
    if new_option:
        # Handle new option
        pass
```

### Adding Configuration

```python
from dataclasses import dataclass

@dataclass
class Config:
    """Configuration for caption-layout."""
    new_setting: bool = False

def process(input: str, config: Config) -> str:
    """Process with configuration."""
    if config.new_setting:
        # Use new setting
        pass
```

---

## Anti-Patterns to Avoid

**Don't:**
- Implement before understanding requirements
- Skip tests ("I'll add them later")
- Over-engineer the solution
- Add features not requested
- Break existing functionality
- Skip documentation
- **Make unsubstantiated causal claims** - distinguish observed facts from inferred causes
- **Document assumptions as facts** - cite evidence or mark as hypothesis

**Do:**
- Clarify requirements first
- Write tests alongside code
- Keep solutions simple
- Implement only what's requested
- Run regression tests
- Document as you go
- **Use precise language** - "observed", "measured" vs "causes", "due to"
- **Cite evidence** when explaining decisions (file paths, line numbers)

**Critical: Use proper solutions, not workarounds:**

**Workarounds to AVOID:**
- Weakening test assertions to make tests pass
- Adding `# type: ignore` instead of fixing type issues
- Disabling linters/checkers instead of fixing issues
- Quick fixes that hide problems

**Proper solutions to USE:**
- Setting environment variables for consistent behavior
- Using appropriate imports for compatibility
- Configuring tools correctly in config files
- Investigating and fixing root causes

**If unsure:** Ask whether a solution is a workaround or proper fix

---

## Next Steps

**After feature is complete:**
- Mark todos as completed
- Clean up any debug code
- Remove temporary comments
- Update CHANGELOG if project has one

**Related workflows:**
- [Bug Fixing](./bug-fixing.md) - Fixing bugs
- [Releasing](./releasing.md) - Release process
