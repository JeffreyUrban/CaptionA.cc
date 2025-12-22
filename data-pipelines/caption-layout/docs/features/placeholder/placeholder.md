# ⚠️ Template doc: Testing disabled ⚠️

# Annotations

The `--TEMPLATE_PLACEHOLDER` flag TEMPLATE_PLACEHOLDER.

## What It Does

TEMPLATE_PLACEHOLDER

**Key insight**: TEMPLATE_PLACEHOLDER.

## Example: TEMPLATE_PLACEHOLDER

This example shows TEMPLATE_PLACEHOLDER.

???+ note "Input: TEMPLATE_PLACEHOLDER"
    ```text hl_lines="1-2"
    --8<-- "features/TEMPLATE_PLACEHOLDER/fixtures/input.txt"
    ```

    **First occurrence** (lines 1-2): Line TEMPLATE_PLACEHOLDER
    **TEMPLATE_PLACEHOLDER** (line 3): TEMPLATE_PLACEHOLDER

### With TEMPLATE_PLACEHOLDER: TEMPLATE_PLACEHOLDER

With `--TEMPLATE_PLACEHOLDER`, TEMPLATE_PLACEHOLDER.

=== "CLI"

    <!-- verify-file: output-TEMPLATE_PLACEHOLDER.txt expected: expected-TEMPLATE_PLACEHOLDER.txt -->
    <!-- termynal -->
    ```console
    $ caption-layout input.txt --TEMPLATE_PLACEHOLDER \
        > output-TEMPLATE_PLACEHOLDER.txt
    ```

=== "Python"

    <!-- verify-file: output-TEMPLATE_PLACEHOLDER.txt expected: expected-TEMPLATE_PLACEHOLDER.txt -->
    ```python
    from caption_layout import CaptionLayout

    processor = CaptionLayout(
        TEMPLATE_PLACEHOLDER=True  # (1)!
    )

    with open("input.txt") as f:
        with open("output-TEMPLATE_PLACEHOLDER.txt", "w") as out:
            processor.process(f, out)
            processor.flush(out)
    ```

## How It Works

### TEMPLATE_PLACEHOLDER


### Available Variables

TEMPLATE_PLACEHOLDER

## Common Use Cases

### TEMPLATE_PLACEHOLDER

## Combining with Other Features

### TEMPLATE_PLACEHOLDER

## Performance Note

TEMPLATE_PLACEHOLDER

## Rule of Thumb

**TEMPLATE_PLACEHOLDER**

## See Also

- [CLI Reference](../../reference/cli.md) - Complete annotation documentation
- [Common Patterns](../../guides/common-patterns.md) - Annotation examples
