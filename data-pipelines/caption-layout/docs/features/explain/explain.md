# ⚠️ Template doc: Testing disabled ⚠️

# Explain Mode

The `--explain` flag outputs explanations to stderr showing why TEMPLATE_PLACEHOLDER. 
This helps you understand the TEMPLATE_PLACEHOLDER decisions being made in real-time.

## What It Does

Explain mode adds diagnostic messages to stderr:

- **Normal mode**: Deduplication happens silently
- **With explain**: Messages show why TEMPLATE_PLACEHOLDER
- **Use case**: Debugging TEMPLATE_PLACEHOLDER, understanding TEMPLATE_PLACEHOLDER, troubleshooting unexpected behavior

**Key insight**: Explanations go to stderr, so stdout remains clean for TEMPLATE_PLACEHOLDER.

## Example: TEMPLATE_PLACEHOLDER

TEMPLATE_PLACEHOLDER

### Without Explain: TEMPLATE_PLACEHOLDER

Without `--explain`, TEMPLATE_PLACEHOLDER happens without feedback.

=== "CLI"

    <!-- verify-file: output.txt expected: expected-output.txt -->
    <!-- termynal -->
    ```console
    $ caption-layout input.txt --TEMPLATE_PLACEHOLDER > output.txt
    ```

=== "Python"

    <!-- verify-file: output.txt expected: expected-output.txt -->
    ```python
    from caption_layout import CaptionLayout

    processor = CaptionLayout(
        TEMPLATE_PLACEHOLDER=False  # (1)!
    )

    with open("input.txt") as f:
        with open("output.txt", "w") as out:
            processor.process(f, out)
            processor.flush(out)
    ```

    1. Default: no explanations

???+ success "Output: TEMPLATE_PLACEHOLDER"
    ```text
    --8<-- "features/explain/fixtures/expected-output.txt"
    ```

    **Result**: TEMPLATE_PLACEHOLDER.

### With Explain: Documented Decisions

With `--explain`, stderr shows why TEMPLATE_PLACEHOLDER.

=== "CLI"

    <!-- verify-file: output.txt expected: expected-output.txt -->
    <!-- termynal -->
    ```console
    $ caption-layout input.txt --TEMPLATE_PLACEHOLDER \
        > output.txt 2> explain.txt
    ```

=== "Python"

    <!-- verify-file: output.txt expected: expected-output.txt -->
    ```python
    from caption_layout import CaptionLayout
    import sys

    processor = CaptionLayout(
        TEMPLATE_PLACEHOLDER=False,
        explain=True  # (1)!
    )

    with open("input.txt") as f:
        with open("output.txt", "w") as out:
            processor.process(f, out)
            processor.flush(out)
    ```

    1. Enable explain mode

???+ warning "Stdout: Deduplicated output"
    ```text
    --8<-- "features/explain/fixtures/expected-output.txt"
    ```

???+ info "Stderr: Explanation messages"
    ```text
    --8<-- "features/explain/fixtures/expected-explain.txt"
    ```

    **Result**: Stdout has TEMPLATE_PLACEHOLDER, stderr shows TEMPLATE_PLACEHOLDER.

## How It Works

### Explanation Format

Explain messages provide actionable information:

**TEMPLATE_PLACEHOLDER**:

## Common Use Cases

### Debugging Why TEMPLATE_PLACEHOLDER

### Validating TEMPLATE_PLACEHOLDER

### Understanding TEMPLATE_PLACEHOLDER

### Troubleshooting Unexpected Behavior

## Combining with Other Features

### With Progress

```bash
# Real-time explanations with progress indicator
caption-layout large.log --explain --progress 2>&1 | tee diagnostics.txt
```

## Filtering Explain Output

### Extract Specific Information

```bash
# Only show TEMPLATE_PLACEHOLDER
caption-layout log.txt --explain 2>&1 | grep "TEMPLATE_PLACEHOLDER"
```

### Separate Stdout and Stderr

```bash
# TEMPLATE_PLACEHOLDER to file, explanations to terminal
caption-layout log.txt --explain > clean.log

# Both to separate files
caption-layout log.txt --explain > clean.log 2> explain.log

# Merge for analysis
caption-layout log.txt --explain 2>&1 | grep "Line 42"
```

## Performance Note

Explain mode has minimal overhead:
- Simple conditional check before printing
- Messages only written when explain is enabled
- No impact on TEMPLATE_PLACEHOLDER performance
- Stderr output is buffered (efficient)

## Rule of Thumb

**Use explain mode when you need to understand** the TEMPLATE_PLACEHOLDER.

- **Initial setup**: Validate TEMPLATE_PLACEHOLDER are working correctly
- **Debugging**: Understand why TEMPLATE_PLACEHOLDER
- **Pattern development**: Test and refine TEMPLATE_PLACEHOLDER
- **Troubleshooting**: Diagnose unexpected behavior
- **Learning**: Understand how the algorithm works on your data

**Don't use in production** unless actively debugging—the extra output
can clutter logs.

## See Also

- [CLI Reference](../../reference/cli.md) - Complete explain documentation
- [Troubleshooting](../../guides/troubleshooting.md) - Common issues and solutions
