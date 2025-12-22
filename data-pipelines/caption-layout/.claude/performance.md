# Performance Guidance

Performance optimization strategies and profiling techniques.

**Inherits from:** [../CLAUDE.md](../CLAUDE.md) - Read universal rules first

---

## Performance Documentation

**Document complexity** - Time/space complexity for critical algorithms should be documented in dev-docs.

### Time/Space Complexity

**Document in dev-docs/design/ALGORITHM_DESIGN.md:**
```markdown
## Algorithm Complexity

### parse_input()
- **Time:** O(n) where n is input length
- **Space:** O(n) for parsed output
- **Trade-off:** Could reduce space to O(1) but would require streaming
```

---

## Next Steps

**Related guidance:**
- [Development](./development.md) - Code patterns
- [Testing](./testing.md) - Performance tests
- [Troubleshooting](./troubleshooting.md) - Profiling techniques
