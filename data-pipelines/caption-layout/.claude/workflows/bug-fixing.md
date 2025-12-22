# Bug Fixing Workflow

Step-by-step workflow for identifying and fixing bugs.

**Inherits from:** [../../CLAUDE.md](../../CLAUDE.md) - Read universal rules first

---

## Workflow

### 1. Reproduce the Bug

**Understand the issue:**
- What is the expected behavior?
- What is the actual behavior?
- How to reproduce?

**Create minimal reproduction:**
```python
# Minimal code that demonstrates the bug
from caption-layout import problematic_function

result = problematic_function("input that causes bug")
# Expected: X
# Actual: Y
```

### 2. Write a Failing Test

**Create test that demonstrates the bug:**
```python
@pytest.mark.unit
def test_bug_description():
    """Test for bug: brief description."""
    result = problematic_function("input")
    assert result == expected  # This should fail
```

**Verify test fails:**
```bash
pytest tests/test_module.py::test_bug_description -v
```

### 3. Investigate Root Cause

**Common investigation steps:**
1. Check input validation
2. Verify algorithm logic
3. Look for edge cases
4. Check state/side effects
5. Review recent changes

**Use evidence-based debugging:**
- Distinguish **observed facts** from **inferred causes**
- Document what was tried and what was observed
- Use precise language: "observed", "measured" vs "causes", "due to"
- If stating a cause, cite the evidence or mark as hypothesis

### 4. Fix the Bug

**Implement fix:**
- Make minimal changes
- Fix root cause, not symptoms
- Maintain existing behavior for other cases
- **Use proper solutions, not workarounds**

**Avoid workarounds:**
- Weakening test assertions
- Adding `# type: ignore` comments
- Disabling quality checks
- Quick fixes that hide root cause

**Use proper solutions:**
- Fix underlying issue
- Configure tools correctly
- Set appropriate environment variables
- Refactor if needed for correctness

**If fix requires significant changes:** Discuss with user before implementing.

**Example:**
```python
def fixed_function(input: str) -> str:
    """Fixed version."""
    # Previous code had bug here
    if not input:  # Add missing edge case handling
        return ""

    return process(input)
```

### 5. Verify Fix

**Test passes:**
```bash
pytest tests/test_module.py::test_bug_description
```

**Run related tests:**
```bash
pytest tests/test_module.py
```

**Run all tests (regression check):**
```bash
pytest
```

**Run pre-commit checks:**
```bash
pre-commit run --all-files
```

This catches formatting, linting, and other issues before committing.

### 6. Clean Up

**Remove debug code:**
- Delete print statements
- Remove breakpoints
- Clean up temporary changes

**Update tests if needed:**
- Keep the bug test
- Add more edge case tests if discovered

### 7. Document (if significant)

**Update documentation if:**
- Behavior changed
- Edge case handling changed
- Fix affects public API

**Add to CHANGELOG (if maintained):**
```markdown
### Fixed
- Fixed bug where X caused Y (#issue-number)
- List affected files if significant (src/module.py, tests/test_module.py)
```

**Use CHANGELOG.md as template** for format and detail level.

---

## Debugging Techniques

### Test-Driven Debugging

1. Write test that fails
2. Run test to see failure
3. Fix code
4. Run test to verify
5. Repeat until passing

### Evidence-Based Debugging

**Distinguish facts from assumptions:**

**DON'T:**
- "X causes Y" (without evidence)
- "Performance issues due to algorithm" (assumed cause)
- "Bug happens because of Z" (unverified)

**DO:**
- "Observed: X happens, Y occurs" (facts)
- "Measured: Performance degrades when..." (measured)
- "Hypothesis: May be caused by Z" (marked as theory)

**When documenting bugs:**
- State what was observed
- State what was tried
- State what was measured
- Separate observations from conclusions
- Cite evidence when claiming causes

**Example:**
```markdown
Observed: Function returns None when input contains newlines
Tried: Tested with various inputs
Measured: Fails on 100% of inputs with \n
Evidence: Line 45 strips all whitespace including newlines (see strip_input())
Conclusion: Bug is in strip_input() function
```

---

## Prevention

**After fixing a bug:**

1. **Add test** - Prevent regression
2. **Look for similar bugs** - Same pattern elsewhere?
3. **Update validation** - Can we catch this earlier?
4. **Document edge cases** - Update design docs if needed

---

---

## Next Steps

**After fix is verified:**
- Remove debug code
- Update documentation if needed
- Consider if similar bugs exist
- Mark todos as completed

**Related workflows:**
- [Feature Development](./feature-development.md) - Adding features
- [Releasing](./releasing.md) - Release process
