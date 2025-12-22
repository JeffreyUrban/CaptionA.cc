# Development Guidance

Coding standards, patterns, tools, and modern practices for this project.

**Inherits from:** [../CLAUDE.md](../CLAUDE.md) - Read universal rules first

## Quick Reference

**Language:** Python 3.14+
**Code Quality:** ruff (lint + format) + pyright (type checking)
**Style:** Type hints required, docstrings for public APIs
**Philosophy:** Modern, mature tools over legacy approaches

---

## Technical Standards

### Python Version

- Use Python 3.14+ syntax
- Target backwards compatibility when practical for CLI distribution
- Prefer `pathlib.Path` over `os.path` for path operations

### Dependency Management

- Use `uv` for dependency management: `uv pip install` (not `pip install`)
- Always check for virtual environment (`.venv` or `venv`) when running Python
- Run scripts via `uv run` or `.venv/bin/python`, not system Python
<!-- TEMPLATE-SPECIFIC: Remove when project has real implementation (check: no "placeholder" or "TODO" in code/docs) -->
- **Never use shebangs** (`#!/usr/bin/env python3`) - template projects use uv/venv, not system Python
<!-- END TEMPLATE-SPECIFIC -->

### Code Quality Tools

Run these before committing:
```bash
ruff format .       # Format code
ruff check --fix .  # Lint and auto-fix
pyright            # Type checking
```

**Pre-commit hooks** automate this - install once:
```bash
pre-commit install
pre-commit run --all-files  # Manual run
```

---

## Code Standards

### Type Hints

**Required** for all function signatures:

```python
from typing import Optional

def process_data(input: str, count: int = 10) -> list[str]:
    """Process input data and return results."""
    ...

def find_user(user_id: str) -> Optional[dict[str, str]]:
    """Find user by ID, returns None if not found."""
    ...
```

**Use `Optional[Type]` for nullable values** (backwards compatible to Python 3.7+):
```python
# ✅ Good - works Python 3.7+
from typing import Optional
def get_value() -> Optional[str]:
    ...

# ❌ Avoid - only works Python 3.10+
def get_value() -> str | None:
    ...
```

**Never use `Any` type** - be specific:
```python
# ❌ Wrong
from typing import Any
def handle(obj: Any) -> None:
    ...

# ✅ Right
def handle(obj: dict[str, str]) -> None:
    ...
```

**Not required for:**
- Private helper functions (internal use only)
- Simple lambdas where types are obvious from context

### Advanced Type Patterns

**TYPE_CHECKING for forward references:**
```python
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from myapp.models import User  # Import only for type checking

def get_user(user_id: str) -> Optional["User"]:
    """Get user by ID."""
    ...
```

**TypedDict for complex return dictionaries:**
```python
from typing import TypedDict

class UserData(TypedDict):
    name: str
    email: str
    age: int

def get_user_data(user_id: str) -> UserData:
    """Returns user data as a typed dictionary."""
    return {"name": "Alice", "email": "alice@example.com", "age": 30}
```

Use TypedDict when:
- Returning dictionaries with known structure
- Need IDE autocomplete for dictionary keys
- Want type safety without full class overhead

### Docstrings

**Required** for:
- Public functions and classes
- Modules (top-level docstring)
- Complex internal functions

**Format:** Google style

```python
def example(param1: str, param2: int) -> bool:
    """Short one-line summary.

    Longer description if needed, explaining purpose and usage.

    Args:
        param1: Description of param1
        param2: Description of param2

    Returns:
        Description of return value

    Raises:
        ValueError: When input is invalid
    """
```

### Code Style

**Follow PEP8 and Ruff's formatting:**
- Let `ruff format` handle formatting - don't fight the formatter
- Line length: **100 characters for code**, **80 characters for documentation examples**
- Use implicit line continuation in parentheses for long lines

**Guard clauses with early returns** (not nested code):
```python
# ✅ Good - guard clauses
def process(data: str) -> str:
    if not data:
        return ""
    if len(data) < 3:
        return data

    # Main logic here
    return data.upper()

# ❌ Avoid - nested logic
def process(data: str) -> str:
    if data:
        if len(data) >= 3:
            return data.upper()
        else:
            return data
    return ""
```

**Keep components small and focused:**
- Functions should do one thing well
- Modules should have clear, single responsibility
- Prefer functions over OOP when appropriate (classes when state needed)

### Constants and Magic Numbers

**Avoid magic numbers** - use named constants:

```python
# ❌ Bad
if value > 0.85:
    ...

# ✅ Good
CONFIDENCE_THRESHOLD = 0.85
if value > CONFIDENCE_THRESHOLD:
    ...
```

### Import Organization

**Standard order** (ruff enforces this):
1. Standard library imports
2. Third-party imports
3. Local imports

```python
# ✅ Right
import sys
from pathlib import Path

import typer
from rich.console import Console

from .module import function
```

**Import pattern guideline** (namespace for clarity):

For internal project imports:
- **Functions:** Namespace imports for clarity
- **Classes/Exceptions:** Direct imports

```python
# ✅ Functions - namespace imports
from myapp.services import user_service
result = user_service.get_user(user_id)

# ✅ Classes/Exceptions - direct imports
from myapp.services.models import User, UserNotFoundError
user = User(name="Alice")
raise UserNotFoundError("User not found")

# ❌ Less clear - function direct import
from myapp.services.user_service import get_user
result = get_user(user_id)  # Where is this from?
```

**Benefits of namespace imports for functions:**
- Clearer origin of function calls
- Reduces naming conflicts
- Easier to track dependencies

**When to use direct imports:**
- Very frequently used utilities (case-by-case decision)
- Classes and exceptions (clearer in usage)
- User explicitly prefers direct imports

This is a **guideline, not a strict rule** - use judgment based on readability.

---

## Modern Tools & Techniques

**Philosophy:** Favor modern, mature tools over legacy approaches. Not bleeding edge, but proven improvements.

### Python Libraries

**Project standards:**
- **CLI tools:** `typer` (type-based, modern) over `argparse`/`click`
- **Terminal output:** `rich` for beautiful CLI output, progress bars, tables
- **Paths:** `pathlib.Path` over `os.path`
- **Date/time:** `datetime` standard library (avoid `arrow`/`pendulum` unless needed)

**Consider when relevant:**
- **Validation:** `pydantic` for data validation
- **Async:** `asyncio` for concurrent operations
- **Serialization:** `pydantic` or `dataclasses` with type hints

### Code Quality Tools

**ruff** - Linter and formatter (replaces black, flake8, isort):
```bash
ruff check .        # Lint
ruff format .       # Format
```

Use rules in `ruff.toml` if present - project-specific configuration.

**pyright** - Type checker (better than mypy for modern Python):
```bash
pyright            # Type check entire project
```

Configure in `pyproject.toml`:
```toml
[tool.pyright]
typeCheckingMode = "basic"  # or "strict" for maximum safety
```

**Pre-commit** - Runs checks before commit:
```bash
pre-commit install  # One-time setup
pre-commit run --all-files  # Manual run
```

Pre-commit hooks catch issues immediately (faster feedback than CI):
- Trailing whitespace removal
- End-of-file newlines
- YAML syntax validation
- Ruff format and check
- Pyright type checking

---

## Architecture Patterns

### Project Structure

```
src/caption-layout/
├── __init__.py           # Package initialization, version
├── cli.py                # CLI interface (typer + rich)
├── caption-layout.py  # Core logic
└── utils.py              # Shared utilities (if needed)
```

**Principles:**
- Keep `cli.py` focused on CLI interface only
- Put business logic in separate modules
- Use clear module names that describe their purpose
- Keep components small and focused
- Prefer functions in modules over OOP (use classes when state is needed)

### Error Handling

**User-facing errors** (CLI):
```python
import typer

if invalid_input:
    raise typer.BadParameter("Clear message about what's wrong")
```

**Internal errors** (library code):
```python
if error_condition:
    raise ValueError("Descriptive error message")
```

**Never silently fail** - always raise or log errors. Fail loudly, don't hide issues.

**Async/await for asynchronous operations:**
```python
import asyncio

async def fetch_data():
    """Asynchronous data fetching."""
    await asyncio.sleep(1)
    return "data"
```

---

## Critical Development Principles

### NEVER Make Assumptions About Applicability

**CRITICAL: Do not assume content is irrelevant based on your judgment!**

- **NEVER** decide that guidance is "not applicable" because you think the project is "too simple"
- **NEVER** skip implementing patterns because you think they're "too advanced"
- **NEVER** mark content as "low priority" without explicit user direction
- The user decides what's applicable to their template, not you
- If you think something might not be needed, **ASK the user** - do NOT decide on your own

**Examples of WRONG assumptions:**
- ❌ "Git worktree workflow is too advanced for this project"
- ❌ "This project doesn't need X because it's not a web service"
- ❌ "This is project-specific and not applicable"

**The RIGHT approach:**
- ✅ Ask the user: "Should I include the worktree workflow guidance?"
- ✅ Trust the user's judgment about what belongs in their project
- ✅ Implement ALL guidance unless explicitly told to skip it

### Proper Solutions, Not Workarounds

**When encountering issues (especially in CI/testing), investigate the root cause** and find the standard/best-practice solution.

**Examples of workarounds to AVOID:**
- Weakening test assertions to pass (e.g., changing "window-size" to "window")
- Adding `# type: ignore` comments instead of fixing type issues
- Disabling linters/checkers instead of fixing the underlying issue

**Examples of proper solutions:**
- Setting environment variables for consistent behavior (e.g., `COLUMNS` for terminal width)
- Using appropriate imports for Python version compatibility (e.g., `Optional` vs `|`)
- Configuring tools correctly in config files

**If unsure whether a solution is a workaround or proper fix, ASK the user.**

### Implement Requirements Correctly

**When given a requirement (e.g., "keep the most recent value"), implement it correctly.**

**Do NOT:**
- Implement the opposite behavior and add a TODO noting it should be fixed later
- Document violations as limitations instead of fixing them

**If the requirement needs clarification or would require significant changes, ASK first.**

This prevents technical debt accumulation.

### Project Rigor Applies Universally

**Never assume a project doesn't need best practices because it seems "simple":**

- **CLI applications can be as complex as any other software** - command-line tools often handle critical workflows
- **Small projects need the same rigor as large ones** - technical debt accumulates faster in projects assumed to be "simple"
- **Template projects establish patterns** - if guidance exists in this project, it's required regardless of project size
- **Scope is not an excuse to cut corners** - all projects deserve quality engineering

**"Simple" is not justification to skip:**
- Testing requirements
- Documentation standards
- Type checking
- Code quality tools
- Architectural patterns
- Security practices

**If a practice is documented in this project, it's required** - regardless of perceived project size, complexity, or application type.

The assumption that "simple" projects don't need rigor leads to:
- Skipped tests that would catch bugs
- Missing documentation that wastes future time
- Type errors that could be prevented
- Security issues that go unnoticed
- Technical debt that compounds

**Treat every project with professional engineering standards.**

---

## Complexity Guidelines

### Avoid Over-Engineering

**Key principle:** Only make changes that are directly requested or clearly necessary. Keep solutions simple and focused.

**Don't:**
- Add features, refactor, or make "improvements" beyond what was asked
- Add error handling for scenarios that can't happen
- Create abstractions for one-time operations
- Design for hypothetical future requirements
- Add docstrings/comments/type annotations to unchanged code

**Do:**
- Trust internal code and framework guarantees
- Only validate at system boundaries (user input, external APIs)
- Three similar lines is better than premature abstraction
- If something is unused, delete it completely (no backwards-compatibility hacks)

**Examples of over-engineering to avoid:**
- Using feature flags or compatibility shims when you can just change the code
- Adding helpers/utilities for operations that happen once
- Creating configuration for values that never change
- Renaming unused `_vars`, re-exporting removed types, adding `# removed` comments

---

## Security Best Practices

**Always check for:**
- Command injection vulnerabilities
- SQL injection (use parameterized queries)
- XSS vulnerabilities
- Path traversal issues
- OWASP Top 10 vulnerabilities

**If you notice insecure code:**
- Immediately fix it
- Document the vulnerability in commit message
- Add tests to prevent regression

---

## Performance Considerations

**Profile before optimizing:**
- Don't optimize without measuring
- Use `cProfile` or `py-spy` for profiling
- Document performance requirements in dev-docs

**Time/Space Complexity:**
- Document in dev-docs for critical algorithms
- Add comments for non-obvious complexity tradeoffs

---

## Tool Usage (Claude-Specific)

### File Operations

**Always use dedicated tools:**
- **Read** - Read files (not `cat`/`head`/`tail`)
- **Edit** - Edit files (not `sed`/`awk`)
- **Write** - Create files (not `echo >/cat <<EOF`)
- **Glob** - Find files (not `find`/`ls`)
- **Grep** - Search content (not `grep`/`rg`)

**Reserve Bash for:**
- Git operations
- Package management (uv, pip)
- Running tests/linters
- Process management

### Parallel Operations

**Run independent operations in parallel:**

```xml
<!-- Good: Parallel reads -->
<Read file="file1.py"/>
<Read file="file2.py"/>
<Grep pattern="TODO"/>

<!-- Bad: Sequential when not needed -->
<Read file="file1.py"/>
<!-- wait -->
<Read file="file2.py"/>
```

**Run dependent operations sequentially:**
- Use `&&` to chain commands that depend on each other
- Use `;` only when you don't care if earlier commands fail

---

## Common Patterns

### CLI Interface (typer)

```python
import typer
from pathlib import Path
from rich.console import Console

app = typer.Typer()
console = Console()

@app.command()
def main(
    input_file: Path = typer.Argument(..., help="Input file path"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Verbose output"),
):
    """Command description."""
    if verbose:
        console.print("[yellow]Processing...[/yellow]")

    # Logic here
```

### Rich Terminal UI

Use `rich` for informative CLI output with styled text, tables, and progress bars.

**Basic styled output:**
```python
from rich.console import Console

console = Console()

# Styled text
console.print("[bold cyan]Processing...[/bold cyan]")
console.print("[bold red]ERROR:[/bold red] Something failed")
console.print("[green]✓[/green] Success!")
```

**Tables for structured data:**
```python
from rich.table import Table

table = Table(title="Results")
table.add_column("Name", style="cyan")
table.add_column("Value", justify="right", style="green")
table.add_row("Item 1", "123")
table.add_row("Item 2", "456")
console.print(table)
```

**Progress tracking:**
```python
from rich.progress import track

for item in track(items, description="Processing..."):
    process(item)

# Or with more control:
from rich.progress import (
    Progress,
    SpinnerColumn,
    TextColumn,
    BarColumn,
    TaskProgressColumn,
)

with Progress(
    SpinnerColumn(),
    TextColumn("[bold blue]{task.description}"),
    BarColumn(),
    TaskProgressColumn(),
) as progress:
    task = progress.add_task("[cyan]Processing...", total=len(items))
    for item in items:
        process(item)
        progress.update(task, advance=1)
```

**Panels for grouped information:**
```python
from rich.panel import Panel

console.print(
    Panel("Processing complete", title="Status", border_style="green")
)
```

**Best practices:**
- Use `console.print()` instead of `print()` for user-facing output
- Use consistent colors (cyan=info, yellow=warnings, red=errors, green=success)
- Use Tables for structured data display
- Use Progress for long-running operations
- Use Panels to group related information

---

## IDE Configuration

**PyCharm:**
- Project settings pre-configured in `.idea/`
- Source roots automatically set
- Run configurations in `.run/`

**VS Code:**
- Settings pre-configured in `.vscode/settings.json`
- Includes pytest, ruff, pyright configuration

---

## Next Steps

**Related guidance:**
- [Testing](./testing.md) - Test standards and patterns
- [Documentation](./documentation.md) - Documentation standards
- [Workflows](./workflows/) - Common task workflows

**Related documentation:**
- [IMPLEMENTATION.md](../dev-docs/design/IMPLEMENTATION.md) - Implementation details
- [DESIGN_RATIONALE.md](../dev-docs/design/DESIGN_RATIONALE.md) - Design decisions
