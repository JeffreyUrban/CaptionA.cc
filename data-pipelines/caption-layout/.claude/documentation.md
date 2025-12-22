# Documentation Guidance

Documentation standards, MkDocs, Sybil, and tested code examples.

**Inherits from:** [../CLAUDE.md](../CLAUDE.md) - Read universal rules first

## Quick Reference

**System:** MkDocs Material
**Doc Testing:** Sybil (tests code examples in docs)
**Location:** `docs/` for user docs, `dev-docs/` for design docs
**Philosophy:** Documentation is code - test it, review it, maintain it
**Critical:** Work is not complete until documentation is production-ready

---

## Documentation Philosophy

### Core Principle

**Work is not complete until documentation is production-ready.**

Documentation is not an afterthought - it's part of the implementation. All features require documentation before they're considered complete.

### Three Types of Documentation

**1. Planning Documentation (temporary)**
- Design explorations
- Implementation plans
- "Next Steps", "TODO" sections
- **Lifecycle:** Create during planning, archive after completion
- **Action:** Extract insights, delete or move to archive

**2. Progress Documentation (temporary)**
- "What We've Built"
- Implementation status
- Development milestones
- **Lifecycle:** Useful during development, archive when feature complete
- **Action:** Convert valuable insights to work product docs, archive the rest

**3. Work Product Documentation (permanent)**
- Current implementation
- Usage guides
- Architecture decisions
- **Lifecycle:** Keep updated as project evolves
- **Action:** Maintain accuracy, remove outdated sections

### Key Principles

**Applies to all documentation types:**

- **Put function details in docstrings** - not external docs
- **Reference code locations** - don't duplicate values or implementation

---

## Documentation Organization

### By Audience and Purpose

**1. User Documentation (`docs/`)**

**Purpose:** Help users understand and use the project

**Structure:**
```
docs/
├── index.md              # Landing page
├── getting-started/      # Installation, quick start
├── features/             # Feature descriptions
├── use-cases/            # Real-world examples
├── guides/               # How-to guides
├── reference/            # API reference, CLI reference
└── examples/             # Extended examples with fixtures
    └── fixtures/         # Test data for examples
```

**Audience:** End users of caption-layout

**Update when:**
- Adding features
- Changing CLI interface
- Adding examples
- Updating API

**2. Design Documentation (`dev-docs/`)**

**Purpose:** Document technical decisions, architecture, implementation

**Structure:**
```
dev-docs/
├── design/               # Architecture and design
│   ├── IMPLEMENTATION.md
│   ├── ALGORITHM_DESIGN.md
│   └── DESIGN_RATIONALE.md
├── planning/             # Roadmap and planning
│   └── PLANNING.md
└── testing/              # Test strategy
    ├── TESTING_STRATEGY.md
    ├── TEST_COVERAGE.md
    └── ORACLE_TESTING.md
```

**Audience:** Developers, contributors, technical reviewers

**Update when:**
- Changing architecture
- Making design decisions
- Modifying algorithms
- Updating test strategy

**3. Process Documentation (`.claude/`)**

**Purpose:** Guide Claude Code on standards and workflows

**Audience:** Claude instances working on the project

**Update when:** Standards or workflows change

### Maintenance Rules

**When working on different scopes, maintain corresponding documentation:**

| Work Scope | Documentation to Update |
|------------|------------------------|
| **Adding/changing features** | `dev-docs/design/IMPLEMENTATION.md`, `docs/` user guides |
| **Modifying algorithm** | `dev-docs/design/ALGORITHM_DESIGN.md`, `dev-docs/design/IMPLEMENTATION.md` |
| **Adding tests** | `dev-docs/testing/TESTING_STRATEGY.md` |
| **CLI changes** | `README.md`, `docs/reference/cli.md` |
| **Completing milestones** | `dev-docs/planning/PLANNING.md` |
| **Design decisions** | `dev-docs/design/DESIGN_RATIONALE.md` |

---

## Documentation-Driven Engineering

**CRITICAL: Before implementing, understand and document requirements first!**

### Workflow

1. **Clarify requirements** through discussion with the user
2. **Document the design** in appropriate work product documentation
3. **Reference the documentation** during implementation
4. **Update documentation** as design evolves
5. **Verify** implementation matches documentation

### What NOT to Do

**DO NOT:**
- Implement based on assumptions without documented requirements
- Add implementation details to `.claude/*.md` (they belong in `dev-docs/`)
- Skip documentation updates when design changes
- Document violations of requirements as "limitations" or "TODO" items
- Make unsubstantiated causal claims (distinguish observed facts from inferred causes)

**Before creating directory structures:** Discuss scope and organization with user

---

## Evidence-Based Documentation

**Distinguish between observed facts and inferred causes.**

### Language Precision

**Use for observed facts:**
- "observed"
- "measured"
- "specified by user"
- "the system returns"
- "the test shows"

**Use cautiously for inferences:**
- "causes"
- "due to"
- "because"
- "results from"

**When stating a cause, cite evidence or mark as hypothesis.**

### Examples

❌ **Bad (unsubstantiated):**
```markdown
The system is slow because of database queries.
```

✅ **Good (evidence-based):**
```markdown
The system takes 2.5 seconds to complete the operation (measured with `time`).
Profiling shows 2.3s spent in `fetch_data()` (see profile output).
```

❌ **Bad (assumed cause):**
```markdown
The feature doesn't work due to a configuration error.
```

✅ **Good (observed fact):**
```markdown
The feature returns error "config not found" when invoked.
The configuration file exists at the expected path.
Investigation needed to determine cause.
```

### When Asked to Justify Decisions

- Search documentation and code comments for supporting evidence
- Present evidence with specific references (file paths and line numbers)
- If no supporting evidence found, acknowledge the assumption and ask for clarification
- Example: "I assumed X based on the comment at validator.py:117 which states '...'"

---

## Executable Documentation with Sybil

**All code examples in documentation are automatically tested!**

This ensures examples actually work and documentation stays synchronized with code.

### Why Test Documentation?

- Ensures examples actually work
- Catches breaking changes immediately
- Documentation stays in sync with code
- Examples serve as integration tests
- Users can trust the documentation

### Configuration (docs/conftest.py)

See `docs/conftest.py` for complete configuration. Key features:

- Tests Python and console code blocks
- Supports file verification with `verify-file` marker
- Runs from fixtures directory
- Skips template docs with warning marker

### Writing Testable Python Examples

````markdown
```python
from caption-layout import process

result = process("input data")
assert result == "expected output"
```
````

**Sybil will:**
1. Extract this code block
2. Execute it
3. Fail the test if assertion fails

### Writing Testable Console Examples

````markdown
```console
$ echo "test"
test
```
````

**Sybil will:**
1. Run `echo "test"` command
2. Compare output to `test`
3. Fail if output doesn't match

### File Verification Pattern

**For examples that create files:**

````markdown
<!-- verify-file: output.txt expected: expected-output.txt -->

```console
$ caption-layout input.txt > output.txt
```

Output is in `output.txt`:
```text
--8<-- "output.txt"
```
````

**Sybil will:**
1. Run the command
2. Create `output.txt`
3. Compare with `fixtures/expected-output.txt`
4. Fail if files don't match
5. Delete `output.txt` after test

**Important:** Output must be in separate block that loads the file. Don't use `cat`.

### Fixture Files Organization

**Organize test data:**
```
docs/examples/fixtures/
├── input/
│   ├── sample.txt
│   ├── complex-data.json
│   └── edge-case.txt
└── expected/
    ├── expected-output.txt
    ├── expected-result.json
    └── edge-case-output.txt
```

**Fixture files must exist** - Sybil will fail if referenced files are missing.

**Reference in examples:**
````markdown
```console
$ caption-layout fixtures/input/sample.txt
Expected output here
```
````

### Template Testing Disabled Pattern

**Mark work-in-progress docs:**

````markdown
# ⚠️ Template doc: Testing disabled ⚠️

This document is under development. Examples are not tested yet.

```python
# This code won't be tested
incomplete_example()
```
````

**Remove the warning when ready to enable testing.**

This allows progressive documentation - write docs before fully implementing, then enable testing when ready.

### Specification Tests in Documentation

**Documentation tests can specify intended behavior, not just verify current behavior.**

This is the same principle as specification testing in pytest (see [Testing](./testing.md)).

**Tests MAY fail when they document intended behavior not yet implemented:**

````markdown
???+ success "Expected Output: Feature behavior (specification)"
    ```text
    --8<-- "features/example/fixtures/expected-output.txt"
    ```

    **Expected behavior**: Description of what should happen

    **Note**: This feature is specified but not yet fully implemented.
    Currently [describe actual behavior].
````

**When you see failing documentation tests:**

1. **Check if intentional** - Look for specification notes
2. **Intentional failures are CORRECT** - They document requirements
3. **Unintentional failures need fixing** - Missing files, wrong paths, broken logic

**DO NOT:**
- ❌ Remove or skip specification tests because they fail
- ❌ Change expected output to match current (incorrect) behavior
- ❌ Add workarounds to make tests pass when feature isn't implemented

**DO:**
- ✅ Keep specification tests that document intended behavior
- ✅ Add notes explaining gap between expected and actual
- ✅ Use as implementation guides when building the feature

### Testing Documentation

```bash
# Test all documentation examples
pytest docs/

# Test specific document
pytest docs/getting-started/quick-start.md

# Run with verbose output
pytest docs/ -v

# Skip slow doc tests
pytest docs/ -m "not slow"
```

---

## MkDocs Patterns

### Feature/Use Case Documentation

**Use tabbed examples for CLI and Python API:**

````markdown
=== "CLI"

    ```console
    $ caption-layout --option value input.txt
    Result: Success
    ```

=== "Python"

    ```python
    from caption-layout import process

    result = process(option="value", input="data")
    assert result == "expected"
    ```
````

**Benefits:**
- Shows both interfaces in same context
- Readers can choose their preferred interface
- Keeps documentation compact
- Examples are tested together

**Python API separate ONLY when:**
- Feature available only in Python API
- Feature available only in CLI
- Otherwise, always show both in tabs

### Output to Files, Display Separately

**Don't put output in same block as command:**

❌ **Bad:**
````markdown
```console
$ caption-layout input.txt
Output line 1
Output line 2
...
```
````

✅ **Good:**
````markdown
<!-- verify-file: output.txt expected: expected-output.txt -->

```console
$ caption-layout input.txt > output.txt
```

Output is in `output.txt`:
```text
--8<-- "output.txt"
```
````

**Benefits:**
- Tests verify actual file output
- Separates action from result
- Clearer documentation structure

### Line Length for Doc Examples

**Limit doc example lines to 80 characters:**

- Code blocks in documentation: **80 characters max**
- Source code files: 100 characters max (see [Development](./development.md))

This ensures examples render well in documentation without horizontal scrolling.

### Using Admonitions

**Include files in admonitions:**

````markdown
???+ success "Expected Output"
    ```text
    --8<-- "fixtures/expected/output.txt"
    ```
````

**Common admonitions:**
- `note` - Important information
- `warning` - Critical warning
- `tip` - Helpful tip
- `success` - Expected output/result
- `danger` - Dangerous operation

### Markdown Formatting Rules

**CRITICAL: Blank line before lists**

❌ **Bad (won't render correctly):**
```markdown
Features:
- Feature 1
- Feature 2
```

✅ **Good:**
```markdown
Features:

- Feature 1
- Feature 2
```

**CRITICAL: Blank line before code blocks**

❌ **Bad:**
```markdown
Example:
\`\`\`python
code here
\`\`\`
```

✅ **Good:**
```markdown
Example:

\`\`\`python
code here
\`\`\`
```

**Check for `:` followed by `-` and add blank line between.**

---

## Documentation Lifecycle

### During Development

**Create documentation freely:**
- Planning docs for design exploration
- Progress docs for tracking work
- Work product docs for permanent reference

**Keep temporary docs during development** - they provide context for reviewers.

### During Review

**Keep temporary docs for user understanding:**
- Shows thought process
- Explains decisions
- Provides context for changes

**Don't clean up yet** - valuable for review discussion.

### After Completion

**Clean up documentation:**

1. **Extract insights** from planning/progress docs
2. **Update work product docs** with key information
3. **Archive or delete** temporary docs
4. **Verify** work product docs reflect current reality

**Example cleanup workflow:**

```markdown
## Before (Planning Doc)

### Option A: Use SQLite
Pros: Simple, no dependencies
Cons: Limited concurrency

### Option B: Use PostgreSQL
Pros: Better performance, more features
Cons: Additional dependency

**Decision: Go with Option A for now**

## After (Work Product Doc)

### Database

Uses SQLite for data storage.

**Rationale:** Chosen for simplicity and zero dependencies.
For high-concurrency needs, consider PostgreSQL migration.

Implementation: `src/caption-layout/storage.py`
```

---

## Code vs Documentation

### Docstrings as Source of Truth

**Function details belong in docstrings, not external docs.**

❌ **Bad (external docs):**
```markdown
## process_data()

Processes data with the following parameters:
- input (str): The input string
- max_length (int): Maximum length, default 100
- trim (bool): Whether to trim whitespace

Returns: Processed string
```

✅ **Good (docstring):**
```python
def process_data(input: str, max_length: int = 100, trim: bool = True) -> str:
    """Process data with trimming and length limits.

    Args:
        input: The input string to process
        max_length: Maximum length of output, default 100
        trim: Whether to trim leading/trailing whitespace

    Returns:
        Processed string, trimmed and limited to max_length
    """
```

✅ **Good (external docs):**
```markdown
## Data Processing

Use `process_data()` to clean and normalize input:

```python
from caption-layout import process_data

result = process_data("  input  ", max_length=50)
```

See API reference for full details.
```

**External docs explain relationships and architecture, not parameter lists.**

### Configuration Documentation

**Reference configuration, provide guidance:**

❌ **Bad (duplicates values):**
```markdown
The timeout is set to 30 seconds.
The retry count is 3.
```

✅ **Good (references + guidance):**
```markdown
## Configuration

Configure in `config.yaml`:

```yaml
timeout: 30  # Seconds to wait for response
retries: 3   # Number of retry attempts
```

**Timeout:** How long to wait for responses. Increase for slow networks.
**Retries:** Number of retry attempts. Set to 0 to fail immediately.

See `config.yaml` for current values and defaults.
```

### Architecture Diagrams

**Diagrams must match current reality:**

- Update diagrams when architecture changes
- Don't keep outdated diagrams "for reference"
- Date diagrams if showing evolution
- Generate diagrams from code when possible

**Preserve design rationale:**
- Document WHY decisions were made
- Keep rationale when converting planning → work product
- Helps future developers understand constraints

---

## Quality Guidelines

### No Unsubstantiated Claims

❌ **Bad:**
```markdown
caption-layout is 10x faster than alternatives.
```

✅ **Good:**
```markdown
caption-layout processes 1M records in 2.5s (measured on test dataset).
Benchmark comparison: see `benchmarks/results.md`
```

### Credit External Tools

**When using/recommending external tools:**

```markdown
Uses [ruff](https://docs.astral.sh/ruff/) for linting and formatting.
```

Not just "uses ruff" - link to the tool.

### Concise Writing

**Index pages: ~200 words**
**Feature pages: as needed for clarity**

**Remove unnecessary words:**

❌ "It should be noted that..."
✅ [Just state it]

❌ "The purpose of this is to..."
✅ "This processes..."

### Eliminate Redundancy

**Don't repeat information across files:**

- Use links to reference other docs
- Single source of truth for each fact
- Cross-reference, don't duplicate

### Replace Placeholders

**Before completion, replace all:**
- "TODO: Add example"
- "Coming soon"
- "Under construction"
- "Example TBD"

**Either complete the section or remove it.**

---

## Writing Guidelines

### Be Concise

- One idea per paragraph
- Short sentences
- Active voice
- Remove unnecessary words

❌ **Bad:** "It should be noted that the program can be used to process files."
✅ **Good:** "The program processes files."

### Show Don't Tell

❌ **Bad:**
```markdown
The tool is very fast and efficient.
```

✅ **Good:**
```markdown
The tool processes 1M lines/second:

\`\`\`console
$ time caption-layout large-file.txt
Processed 10000000 lines in 9.8s
\`\`\`
```

### Use Examples Liberally

**Every feature should have:**
1. Simple example (basic usage)
2. Real-world example (practical application)
3. Edge case example (handling unusual input)

### Code References

**Reference specific locations:**

```markdown
The validation logic is in `src/caption-layout/validator.py:45`
```

**Pattern:** `file_path:line_number`

**Benefits:**
- Users can navigate directly
- Easy to verify references are current
- Clear, unambiguous

---

## MkDocs Configuration

### Standard Configuration (mkdocs.yml)

```yaml
site_name: Caption Layout
theme:
  name: material
  features:
    - navigation.tabs
    - navigation.sections
    - toc.integrate
    - search.suggest
    - content.code.copy

plugins:
  - search
  - autorefs

markdown_extensions:
  - pymdownx.highlight
  - pymdownx.superfences
  - pymdownx.tabbed:
      alternate_style: true
  - admonition
  - pymdownx.details
  - pymdownx.snippets
  - toc:
      permalink: true
```

### File Naming

- Use lowercase with hyphens: `getting-started.md`
- Use descriptive names: `cli-reference.md` not `reference.md`

### Structure

```markdown
# Page Title

Brief introduction (1-2 sentences).

## Section

Content with examples.

## Another Section

More content.
```

---

## Building and Previewing

### Local Preview

```bash
# Install documentation dependencies
pip install -e ".[docs]"

# Serve documentation locally
mkdocs serve

# Opens at http://127.0.0.1:8000
```

### Build Documentation

```bash
# Build static site
mkdocs build

# Output in site/
```

### Documentation Testing

```bash
# Test all doc examples
pytest docs/

# Test and show coverage
pytest docs/ --cov=src/caption-layout
```

---

## Documentation Review Checklist

**Before completing documentation:**

- [ ] All code examples tested (or doc marked with warning)
- [ ] Examples are practical and realistic
- [ ] No placeholder content ("TODO", "Coming soon")
- [ ] Cross-references are valid
- [ ] Spelling and grammar checked
- [ ] Renders correctly (`mkdocs serve`)
- [ ] Navigation makes sense
- [ ] Search finds relevant content
- [ ] Blank lines before lists and code blocks
- [ ] Line length ≤ 80 chars for doc examples
- [ ] Fixture files exist for all referenced files
- [ ] Temporary (planning/progress) docs archived
- [ ] Work product docs reflect current reality
- [ ] Evidence-based claims only
- [ ] External tools credited with links

---

## Common Documentation Patterns

### CLI Command Documentation

```markdown
## Command Name

Brief description.

### Usage

\`\`\`console
$ caption-layout [OPTIONS] FILE
\`\`\`

### Options

- `--option`: Description
- `-v, --verbose`: Enable verbose output

### Examples

Basic usage:
\`\`\`console
$ caption-layout input.txt
Output
\`\`\`

With options:
\`\`\`console
$ caption-layout --verbose input.txt
Detailed output
\`\`\`
```

### API Documentation

```markdown
## Function Name

\`\`\`python
def function_name(param: str) -> bool:
\`\`\`

Description of what it does.

**Parameters:**
- `param` (str): Description

**Returns:**
- bool: Description

**Example:**
\`\`\`python
from caption-layout import function_name

result = function_name("value")
assert result is True
\`\`\`
```

---

## Next Steps

**Related guidance:**
- [Development](./development.md) - Code standards
- [Testing](./testing.md) - Test patterns (includes specification testing)
- [Workflows](./workflows/) - Common workflows

**Related documentation:**
- [IMPLEMENTATION.md](../dev-docs/design/IMPLEMENTATION.md) - Implementation details
- [TESTING_STRATEGY.md](../dev-docs/testing/TESTING_STRATEGY.md) - Test strategy
