# Troubleshooting & Debugging Guidance

Debugging techniques, common issues, and problem-solving strategies.

**Inherits from:** [../CLAUDE.md](../CLAUDE.md) - Read universal rules first

---

## Common Issues & Solutions

### Rich Output Formatting in Tests

**Issue:** Rich output varies with terminal width, causing test failures

**Solution:** Set COLUMNS environment variable
```python
@pytest.mark.unit
def test_cli_output():
    """Test CLI output with consistent formatting."""
    # Set in test
    import os
    os.environ['COLUMNS'] = '120'

    # Or in pytest fixture / conftest.py
    result = cli_command()
    assert "expected" in result
```

**In CI:** Add to test command in `.github/workflows/test.yml`:
```yaml
env:
  COLUMNS: 120
```

---

## Common Error Patterns

*Add project-specific error patterns here as they're discovered*

---

## CI/CD Issues

### Tests Pass Locally, Fail in CI

**Common causes:**
1. Environment differences (COLUMNS, timezone, etc.)
2. Missing dependencies in CI
3. File permissions
4. Timing/ordering issues

**Investigation steps:**
1. Check CI logs carefully
2. Check for environment-specific behavior
3. Add debug output to workflow temporarily

### GitHub Actions Debugging

**Add debug output to workflow:**
```yaml
- name: Debug info
  run: |
    echo "Python: $(python --version)"
    echo "Working dir: $(pwd)"
    ls -la
```

---

## Project-Specific Issues

*Add tool-specific debugging guidance and error patterns as they emerge*

---

## Next Steps

**Related guidance:**
- [Development](./development.md) - Error handling patterns
- [Testing](./testing.md) - Test debugging
- [Workflows](./workflows/) - Bug fixing workflow
