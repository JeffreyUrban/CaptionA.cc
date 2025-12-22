# ⚠️ Template doc: Testing disabled ⚠️

# TEMPLATE_PLACEHOLDER

TEMPLATE_PLACEHOLDER.

## Input Data

???+ note "app.log"
    --8<-- "use-cases/TEMPLATE_PLACEHOLDER/fixtures/app.log"
    ```

    TEMPLATE_PLACEHOLDER.

## Output Data

???+ success "output.log"
    --8<-- "use-cases/TEMPLATE_PLACEHOLDER/fixtures/expected-output.log"
    ```

    **Result**: TEMPLATE_PLACEHOLDER

## Solution

=== "CLI"

    <!-- verify-file: output.log expected: expected-output.log -->
    <!-- termynal -->
    ```console
    $ caption-layout app.log \
        --TEMPLATE_PLACEHOLDER \
        --quiet > output.log
    ```

    **Options:**

      show_source: false
      show_root_heading: true
      heading_level: 3

=== "Python"

    <!-- verify-file: output.log expected: expected-output.log -->
    ```python
    from caption_layout import CaptionLayout

    processor = CaptionLayout(
        TEMPLATE_PLACEHOLDER=True,  # (1)!
    )

    with open("app.log") as f:
        with open("output.log", "w") as out:
            processor.process(f, out)
            processor.flush(out)
    ```

    1. TEMPLATE_PLACEHOLDER

## How It Works

TEMPLATE_PLACEHOLDER

## Benefits

**TEMPLATE_PLACEHOLDER**: TEMPLATE_PLACEHOLDER

## Real-World Usage

```bash
TEMPLATE_PLACEHOLDER
```

## See Also
