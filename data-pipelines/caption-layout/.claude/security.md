# Security Guidance

Security considerations and best practices for CLI applications.

**Inherits from:** [../CLAUDE.md](../CLAUDE.md) - Read universal rules first

---

## Project-Specific Security Patterns

*Document security patterns and vulnerabilities discovered in this project as they emerge*

---

## Safe rm -rf Usage

**Never use wildcards in dangerous commands:**

```bash
# NEVER do this
rm -rf *
rm -rf ~/*

# ALWAYS specify exact targets within project
rm -rf .venv
rm -rf specific-directory-name
rm -rf /tmp/my-temp-dir
```

**Rules:**
- Never use `*` or `~` with `rm -rf`
- Never `rm -rf` outside project directory (except /tmp with specific subdirectory)
- Always specify exact target paths

---

## Next Steps

**Related guidance:**
- [Development](./development.md) - Input validation patterns
- [Testing](./testing.md) - Security testing
