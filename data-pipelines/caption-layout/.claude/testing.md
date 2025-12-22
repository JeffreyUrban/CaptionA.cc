# Testing Guidance

Test strategy, pytest patterns, coverage requirements, and quality standards.

**Inherits from:** [../CLAUDE.md](../CLAUDE.md) - Read universal rules first

## Quick Reference

**Framework:** pytest (exclusively - not unittest)
**Markers:** `@pytest.mark.unit`, `@pytest.mark.integration`, `@pytest.mark.slow`, `@pytest.mark.e2e`
**Coverage:** Measured with pytest-cov, target 0% initially (increase as project matures)
**Philosophy:** Testing is not optional - all features require tests

---

## Core Principles

**1. Testing is required** - All features must have tests before completion

**2. Use pytest exclusively** - Not unittest, only pytest

**3. Organize with markers** - Tag tests by type for selective running

**4. Tests are specifications** - Tests document intended behavior, not just verify current behavior

**5. Test isolation** - Each test runs independently with fresh state

**6. Test failure analysis** - When tests fail, determine if it's a fix (regenerate tests) or regression (fix the code)

---

## Test Organization

### Directory Structure

```
tests/
├── conftest.py           # Shared fixtures
├── fixtures/             # Test data
│   ├── input/           # Input files for tests
│   └── expected/        # Expected output files
├── unit/                 # Unit tests (if many tests)
├── integration/          # Integration tests (if many tests)
└── test_*.py            # Test modules
```

**Principles:**
- Mirror `src/` structure in test file names
- `test_module.py` tests `module.py`
- Keep related tests together
- Use class grouping for related tests

### Configuration

**pytest.ini** (or pyproject.toml):
```ini
[pytest]
testpaths = tests
python_files = test_*.py *_test.py
python_classes = Test*
python_functions = test_*
markers =
    unit: Fast unit tests with no external dependencies
    integration: Tests involving multiple components or external services
    slow: Tests taking more than 1 second
    e2e: End-to-end tests
```

### Test File Template

```python
"""Tests for module_name.

Description of what's being tested and why.
"""

import pytest
from caption-layout import ModuleName


# Fixtures specific to this test module
@pytest.fixture
def sample_data():
    """Provide sample data for tests."""
    return {...}


class TestBasicFunctionality:
    """Group related tests for basic functionality."""

    @pytest.mark.unit
    def test_valid_input(self, sample_data):
        """Test basic functionality with valid input."""
        result = ModuleName.process(sample_data)
        assert result == expected

    @pytest.mark.unit
    def test_edge_case(self):
        """Test edge case: empty input."""
        result = ModuleName.process("")
        assert result is None


# Integration tests
@pytest.mark.integration
def test_full_workflow(tmp_path):
    """Test complete workflow from input to output.

    Arrange: Set up input file
    Act: Process the file
    Assert: Verify output matches expected
    """
    # Arrange
    input_file = tmp_path / "input.txt"
    input_file.write_text("test data")

    # Act
    result = ModuleName.process_file(input_file)

    # Assert
    assert result.success
    assert result.output == expected_output
```

---

## Pytest Markers

**Standard markers for this project:**

### @pytest.mark.unit

**Fast, isolated tests with no external dependencies**

```python
@pytest.mark.unit
def test_pure_function():
    """Test pure function with no side effects."""
    result = calculate(10, 20)
    assert result == 30
```

**Characteristics:**
- No database, no network, no file I/O
- Fast execution (< 100ms typically)
- Deterministic results
- Run in CI on every commit

### @pytest.mark.integration

**Tests involving multiple components or external services**

```python
@pytest.mark.integration
def test_database_operation(db_session):
    """Test database insertion and retrieval."""
    user = User(name="Alice")
    db_session.add(user)
    db_session.commit()

    retrieved = db_session.query(User).filter_by(name="Alice").first()
    assert retrieved.name == "Alice"
```

**Characteristics:**
- May use database, file system, external APIs
- Slower execution (100ms - 1s typically)
- May require setup/teardown
- Run in CI before merge

### @pytest.mark.slow

**Long-running tests (> 1 second)**

```python
@pytest.mark.slow
def test_large_dataset_processing():
    """Test processing with large dataset."""
    data = generate_large_dataset(1000000)
    result = process_all(data)
    assert len(result) == 1000000
```

**Characteristics:**
- Performance tests, large data processing
- Can be excluded during development: `pytest -m "not slow"`
- Run in CI full suite

### @pytest.mark.e2e

**End-to-end tests through the full system**

```python
@pytest.mark.e2e
def test_cli_end_to_end(tmp_path):
    """Test complete CLI workflow."""
    input_file = tmp_path / "input.txt"
    output_file = tmp_path / "output.txt"
    input_file.write_text("test data")

    result = runner.invoke(app, [str(input_file), str(output_file)])
    assert result.exit_code == 0
    assert output_file.exists()
```

**Running specific markers:**
```bash
pytest -m unit                      # Only unit tests
pytest -m "not slow"                # Skip slow tests
pytest -m "unit or integration"     # Multiple markers
pytest -m "integration and not slow" # Combined filters
```

**Multiple markers on one test:**
```python
@pytest.mark.integration
@pytest.mark.slow
def test_expensive_integration():
    """Integration test that also happens to be slow."""
    ...
```

---

## Fixtures

### Hierarchical Fixture Organization

**Root conftest.py** - Project-wide fixtures:
```python
"""Shared pytest fixtures for all tests."""

import pytest
from pathlib import Path


@pytest.fixture
def project_root():
    """Path to project root directory."""
    return Path(__file__).parent.parent


@pytest.fixture
def fixtures_dir():
    """Path to test fixtures directory."""
    return Path(__file__).parent / "fixtures"


@pytest.fixture
def data_dir(fixtures_dir):
    """Path to test data directory."""
    return fixtures_dir / "input"


@pytest.fixture
def expected_dir(fixtures_dir):
    """Path to expected output directory."""
    return fixtures_dir / "expected"
```

### Component-Specific Fixtures

**tests/integration/conftest.py** - Integration test fixtures:
```python
"""Fixtures specific to integration tests."""

import pytest


@pytest.fixture
def temp_database():
    """Create temporary in-memory database for testing."""
    from sqlalchemy import create_engine
    engine = create_engine("sqlite:///:memory:")

    # Setup
    Base.metadata.create_all(engine)

    yield engine

    # Teardown
    engine.dispose()


@pytest.fixture
def db_session(temp_database):
    """Provide database session for tests."""
    from sqlalchemy.orm import sessionmaker
    Session = sessionmaker(bind=temp_database)
    session = Session()

    yield session

    session.close()
```

### Test Data Fixtures

```python
@pytest.fixture
def sample_user_data():
    """Provide sample user data for tests."""
    return {
        "name": "Alice",
        "email": "alice@example.com",
        "age": 30
    }


@pytest.fixture
def load_fixture_file(fixtures_dir):
    """Factory fixture to load any fixture file."""
    def _load(filename):
        return (fixtures_dir / "input" / filename).read_text()
    return _load


# Usage:
def test_with_file(load_fixture_file):
    data = load_fixture_file("sample.txt")
    result = process(data)
    assert result is not None
```

---

## Test Isolation Best Practices

**DO:**

✅ **Use fixtures for test data** - Don't share mutable state
```python
@pytest.fixture
def user():
    return User(name="Alice")  # Fresh instance each time

def test_one(user):
    user.name = "Bob"  # Doesn't affect other tests
    assert user.name == "Bob"
```

✅ **Use tmp_path for file operations** - Built-in fixture for temp directories
```python
def test_file_creation(tmp_path):
    file = tmp_path / "test.txt"
    file.write_text("data")
    assert file.exists()
```

✅ **Fresh state for each test** - Use setup/teardown or fixtures
```python
@pytest.fixture
def clean_database(db_session):
    yield db_session
    db_session.rollback()  # Clean up after test
```

**DON'T:**

❌ **Never use production database** - Always use test database or in-memory
```python
# BAD - uses production data
def test_user_query():
    user = ProductionDB.query(User).first()  # DANGER!
```

❌ **Don't share mutable state between tests**
```python
# BAD - shared state
cache = {}

def test_one():
    cache['key'] = 'value'  # Affects test_two!

def test_two():
    assert 'key' not in cache  # FAILS if test_one ran first
```

❌ **Don't depend on test execution order**
```python
# BAD - order dependent
def test_create_user():
    global user_id
    user_id = create_user()

def test_delete_user():
    delete_user(user_id)  # Depends on test_create_user
```

---

## Test Patterns

### AAA Pattern (Arrange-Act-Assert)

Structure tests clearly:

```python
def test_user_creation():
    """Test creating a new user."""
    # Arrange - Set up test data
    user_data = {"name": "Alice", "email": "alice@example.com"}

    # Act - Perform the action
    user = create_user(user_data)

    # Assert - Verify the result
    assert user.name == "Alice"
    assert user.email == "alice@example.com"
```

### Testing CLI Commands

```python
from typer.testing import CliRunner
from caption-layout.cli import app

runner = CliRunner()

@pytest.mark.unit
def test_cli_basic():
    """Test basic CLI invocation."""
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "Usage:" in result.stdout


@pytest.mark.integration
def test_cli_with_file(tmp_path):
    """Test CLI with file input."""
    input_file = tmp_path / "input.txt"
    input_file.write_text("test data")

    result = runner.invoke(app, [str(input_file)])
    assert result.exit_code == 0
    assert "Success" in result.stdout
```

### Testing File Operations

```python
@pytest.mark.integration
def test_file_processing(tmp_path, expected_dir):
    """Test file processing end-to-end."""
    # Arrange
    input_file = tmp_path / "input.txt"
    input_file.write_text("test\ndata\n")
    expected = (expected_dir / "output.txt").read_text()

    # Act
    output_file = tmp_path / "output.txt"
    process_file(input_file, output_file)

    # Assert
    assert output_file.exists()
    assert output_file.read_text() == expected
```

### Testing Exceptions

```python
@pytest.mark.unit
def test_invalid_input_raises():
    """Test that invalid input raises appropriate error."""
    with pytest.raises(ValueError, match="invalid input"):
        process(invalid_data)


@pytest.mark.unit
def test_missing_file_raises():
    """Test that missing file raises FileNotFoundError."""
    with pytest.raises(FileNotFoundError):
        load_file("nonexistent.txt")
```

### Parametrized Tests

```python
@pytest.mark.unit
@pytest.mark.parametrize("input,expected", [
    ("", ""),
    ("single", "single"),
    ("multiple\nlines", "multiple\nlines"),
    pytest.param("slow_case", "result", marks=pytest.mark.slow),
])
def test_multiple_cases(input, expected):
    """Test various input cases."""
    assert process(input) == expected


@pytest.mark.unit
@pytest.mark.parametrize("value,valid", [
    (0, False),
    (1, True),
    (100, True),
    (101, False),
])
def test_validation(value, valid):
    """Test validation with different values."""
    assert is_valid(value) == valid
```

---

## Specification Testing

**This project uses tests as specifications for intended behavior.**

### Tests Document Intent, Not Just Current Behavior

Tests should specify what the system **should** do, even if not fully implemented yet.

**Purpose:**
- Tests serve as both specification and verification
- Executable documentation of requirements
- Clear guide for future implementation

### Intentional Test Failures

**Tests MAY fail when they document intended behavior that isn't yet implemented.**

This is CORRECT and intentional:

```python
@pytest.mark.integration
def test_advanced_feature():
    """Test advanced feature behavior.

    NOTE: This feature is specified but not yet fully implemented.
    This test documents the intended behavior and will pass when
    the feature is complete.

    Expected: System should handle edge case X with result Y
    Current: System returns basic result Z
    """
    result = process_with_advanced_feature(edge_case_data)
    assert result == intended_behavior  # Will fail until implemented
```

### When You See Failing Tests

**1. Check if intentional** - Look for specification notes in test docstrings or related documentation

**2. Intentional failures are CORRECT** - They document requirements

**3. Unintentional failures need fixing** - Missing files, wrong paths, broken logic

### DO NOT:

❌ Remove or skip specification tests because they fail
❌ Change expected output to match current (incorrect) behavior
❌ Add workarounds to make specification tests pass when feature isn't implemented
❌ "Fix" tests to match bugs in the code

### DO:

✅ Keep specification tests that document intended behavior
✅ Add notes explaining the gap between expected and actual behavior
✅ Use these tests as implementation guides when building the feature
✅ Fix tests when they incorrectly specify requirements

**Example from documentation:**
```markdown
???+ success "Expected Output: Feature behavior (specification)"
    ```text
    --8<-- "features/example/fixtures/expected-output.txt"
    ```

    **Expected behavior**: Description of what should happen

    **Note**: This feature is specified but not yet fully implemented.
    Currently [describe actual behavior].
```

This approach ensures tests drive development toward the correct implementation, not just verify current behavior.

---

## Feature Development Workflow

**When creating new features:**

1. **Check design alignment** - Review `dev-docs/design/IMPLEMENTATION.md`

2. **Write tests** (TDD or alongside implementation):
   - Create fixtures for test data
   - Write unit tests for pure functions
   - Write integration tests for component interaction
   - Mark appropriately (`@pytest.mark.unit`, `@pytest.mark.integration`, etc.)

3. **Verify tests pass**: `pytest`

4. **Update documentation**:
   - `dev-docs/design/IMPLEMENTATION.md` - if changing architecture
   - `docs/` - if adding user-facing features
   - `dev-docs/testing/TESTING_STRATEGY.md` - if adding new test categories

**Testing is not optional** - All features require tests.

---

## Running Tests

### Basic Commands

```bash
# Run all tests
pytest

# Run with verbose output
pytest -v
pytest -vv  # Extra verbose

# Run specific file
pytest tests/test_module.py

# Run specific test
pytest tests/test_module.py::test_function

# Run tests matching pattern
pytest -k "user"  # Runs test_user_creation, test_user_deletion, etc.
```

### With Markers

```bash
# Only unit tests (fast)
pytest -m unit

# Exclude slow tests
pytest -m "not slow"

# Only integration tests
pytest -m integration

# Combined markers
pytest -m "unit or integration"
pytest -m "integration and not slow"
```

### Debugging Options

```bash
# Stop at first failure
pytest -x

# Stop after N failures
pytest --maxfail=3

# Show local variables in tracebacks
pytest -l

# Drop into debugger on failure
pytest --pdb

# Run last failed tests only
pytest --lf

# Run failed tests first, then others
pytest --ff
```

### With Coverage

```bash
# Run all tests with coverage
pytest --cov=src/caption-layout --cov-report=term --cov-report=html

# Fail if coverage below threshold
pytest --cov=src/caption-layout --cov-fail-under=80

# View HTML report
open htmlcov/index.html

# Generate XML for CI
pytest --cov=src/caption-layout --cov-report=xml
```

---

## Coverage

### Configuration

In `pyproject.toml`:
```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
markers = [
    "unit: Fast unit tests with no external dependencies",
    "integration: Tests involving multiple components or external services",
    "slow: Tests taking more than 1 second",
    "e2e: End-to-end tests",
]

[tool.coverage.run]
source = ["src"]
omit = [
    "*/tests/*",
    "*/__pycache__/*",
    "*/.venv/*",
]

[tool.coverage.report]
exclude_lines = [
    "pragma: no cover",
    "def __repr__",
    "raise AssertionError",
    "raise NotImplementedError",
    "if __name__ == .__main__.:",
    "if TYPE_CHECKING:",
    "@abstractmethod",
]
```

### Coverage Targets

**Initial:** 0% - don't block on coverage initially
**Growth:** Increase gradually as project matures
**Target:** 80%+ for production code

**Focus on:**
- Critical business logic
- Edge cases and error handling
- Public APIs
- Security-sensitive code

**Don't stress about:**
- Simple getters/setters
- Trivial utility functions
- Type checking blocks (`if TYPE_CHECKING:`)
- `__repr__` and similar methods

### Coverage Reports

```bash
# Terminal report (default)
pytest --cov=src --cov-report=term

# HTML report (browsable)
pytest --cov=src --cov-report=html
open htmlcov/index.html

# XML report (for CI systems)
pytest --cov=src --cov-report=xml

# Missing lines report
pytest --cov=src --cov-report=term-missing
```

---

## Test Debugging

### When Tests Fail

**1. Understand the failure:**
```bash
pytest -vv             # Verbose output
pytest --tb=short      # Shorter traceback
pytest --tb=long       # Full traceback
pytest -x              # Stop at first failure
pytest --lf            # Run only last failed
```

**2. Determine if it's a fix or regression:**
- **Fix:** Test was wrong, update it (e.g., expected output changed)
- **Regression:** Code broke, fix the code
- **Specification:** Test documents future behavior (may fail intentionally)

**3. Isolate the issue:**
```bash
pytest tests/test_specific.py::test_function  # Run single test
pytest -k "keyword"                           # Run tests matching keyword
pytest tests/integration/                     # Run specific directory
```

### Debugging Techniques

**Add temporary output:**
```python
def test_debug():
    result = process(data)
    print(f"DEBUG: result = {result}")  # Shows in pytest output with -s
    assert result == expected
```

**Use breakpoint:**
```python
def test_with_breakpoint():
    result = process(data)
    breakpoint()  # Opens Python debugger
    assert result == expected
```

**Run with pytest debugger:**
```bash
pytest --pdb  # Drop into debugger on failure
pytest --pdb --maxfail=1  # Debug first failure only
```

**Check fixtures:**
```python
def test_fixture_values(sample_data, tmp_path):
    print(f"sample_data: {sample_data}")  # Run with -s to see
    print(f"tmp_path: {tmp_path}")
    assert True  # Temporarily pass to see fixture values
```

---

## Troubleshooting

### Tests Not Discovered

**Problem:** pytest doesn't find your tests

**Solutions:**
- Check file naming: `test_*.py` or `*_test.py`
- Check function naming: `test_*()`
- Check class naming: `Test*` (not `*Test`)
- Verify `pytest.ini` or `pyproject.toml` has correct `testpaths`
- Ensure `__init__.py` files don't interfere (not needed in test dirs)

```bash
pytest --collect-only  # Show what pytest would collect
```

### Import Errors

**Problem:** `ModuleNotFoundError` when running tests

**Solutions:**
- Verify virtual environment is activated
- Install package in editable mode: `uv pip install -e .`
- Check `PYTHONPATH` includes `src/`
- Use proper imports: `from caption-layout import module`

### Fixture Not Found

**Problem:** `fixture 'xyz' not found`

**Solutions:**
- Check `conftest.py` location (should be in tests/ or subdirectory)
- Verify fixture name spelling
- Ensure conftest.py is properly formatted Python
- Check fixture scope matches usage

### Tests Pass Locally, Fail in CI

**Common causes:**
- Environment differences (paths, environment variables)
- Order dependency (tests passing by luck locally)
- Platform differences (Windows vs Linux paths)
- Missing dependencies in CI

**Solutions:**
- Set `COLUMNS` env var for consistent terminal width
- Use `tmp_path` instead of hardcoded paths
- Make tests truly independent
- Mirror CI environment locally with docker

---

## CI/CD Integration

Tests run automatically in GitHub Actions on every push and pull request.

**Fast feedback loop** (runs on every push):
```yaml
- name: Run fast tests
  run: pytest -m "not slow" --cov=src --cov-report=xml
```

**Full test suite** (runs before merge):
```yaml
- name: Run all tests with coverage
  run: pytest --cov=src --cov-report=xml --cov-fail-under=0
```

**All tests must pass before merging.**

### Pre-commit Integration

Pre-commit hooks can run tests before each commit:

```yaml
# .pre-commit-config.yaml
- repo: local
  hooks:
    - id: pytest-fast
      name: pytest (fast tests only)
      entry: pytest -m "not slow"
      language: system
      pass_filenames: false
      always_run: true
```

---

## Next Steps

**Related guidance:**
- [Development](./development.md) - Code standards and patterns
- [Documentation](./documentation.md) - Doc testing with Sybil
- [Workflows](./workflows/) - Task-specific workflows

**Related documentation:**
- [TESTING_STRATEGY.md](../dev-docs/testing/TESTING_STRATEGY.md) - Detailed test strategy
- [TEST_COVERAGE.md](../dev-docs/testing/TEST_COVERAGE.md) - Coverage plan
- [ORACLE_TESTING.md](../dev-docs/testing/ORACLE_TESTING.md) - Oracle-based testing approach
