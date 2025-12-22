# ⚠️ Template doc: Testing disabled ⚠️

# Statistics Output

After processing, caption-layout automatically displays statistics showing TEMPLATE_PLACEHOLDER.

## What It Does

Statistics provide insight into TEMPLATE_PLACEHOLDER:

- **Default**: Table format displayed after processing
- **JSON format**: Machine-readable with `--stats-format json`
- **Quiet mode**: Suppress with `--quiet`
- **Use case**: Understand TEMPLATE_PLACEHOLDER effectiveness, tune parameters

**Key insight**: Statistics help you verify TEMPLATE_PLACEHOLDER worked and measure
TEMPLATE_PLACEHOLDER.

## Example: Understanding TEMPLATE_PLACEHOLDER Results

This example shows TEMPLATE_PLACEHOLDER. Statistics reveal TEMPLATE_PLACEHOLDER.

### Default: Statistics Table

By default, statistics are displayed to stderr after processing:

<!-- verify-file: stats-table.txt expected: expected-stats-table.txt -->
```console
$ caption-layout input.txt --TEMPLATE_PLACEHOLDER > output.txt 2> stats-table.txt
```

Statistics are written to stderr (`stats-table.txt`):

**Note**: Statistics are written to stderr, so stdout can be redirected
without capturing statistics.

**Statistics explained**:

- **TEMPLATE_PLACEHOLDER**: TEMPLATE_PLACEHOLDER

### JSON Format: Machine-Readable

Use `--stats-format json` for programmatic processing:

<!-- verify-file: stats-json.txt expected: expected-stats-json.txt -->
```console
$ caption-layout input.txt --TEMPLATE_PLACEHOLDER --stats-format json \
    > output.txt 2> stats-json.txt
```

Statistics in JSON format (`stats-json.txt`):

```json
{
  "statistics": {
    "TEMPLATE_PLACEHOLDER": TEMPLATE_PLACEHOLDER
  }
}
```

**Benefits**:
- Parse with `jq`, Python, or other tools
- Integrate into monitoring systems
- Track TEMPLATE_PLACEHOLDER metrics over time
- Compare configurations programmatically

### Quiet Mode: Suppress Statistics

Use `--quiet` to suppress all statistics and progress output:

=== "CLI"

    <!-- verify-file: output.txt expected: expected-TEMPLATE_PLACEHOLDER.txt -->
    <!-- termynal -->
    ```console
    $ caption-layout input.txt --TEMPLATE_PLACEHOLDER --quiet > output.txt
    ```

=== "Python"

    <!-- verify-file: output.txt expected: expected-TEMPLATE_PLACEHOLDER.txt -->
    ```python
    from caption_layout import CaptionLayout

    processor = CaptionLayout(TEMPLATE_PLACEHOLDER=True)

    with open("input.txt") as f:
        with open("output.txt", "w") as out:
            processor.process(f, out)
            processor.flush(out)

    # Get statistics programmatically
    stats = processor.get_stats()  # (1)!
    print(f"TEMPLATE_PLACEHOLDER: {stats['TEMPLATE_PLACEHOLDER']}")
    ```

    1. Access statistics from caption-layout object

???+ success "Output: TEMPLATE_PLACEHOLDER"
    ```text
    --8<-- "features/stats/fixtures/expected-TEMPLATE_PLACEHOLDER.txt"
    ```

    **Result**: TEMPLATE_PLACEHOLDER. No statistics printed to stderr.

## Statistics Fields

### TEMPLATE_PLACEHOLDER

### Configuration Echo

| Field  | Description | Purpose |
|--------|-------------|---------|
| `TEMPLATE_PLACEHOLDER` | TEMPLATE_PLACEHOLDER        | TEMPLATE_PLACEHOLDER    |

## Common Use Cases

### TEMPLATE_PLACEHOLDER

## Statistics with Other Features

### With TEMPLATE_PLACEHOLDER

## Performance Note

Statistics collection has minimal overhead:
- TEMPLATE_PLACEHOLDER
- JSON formatting slightly slower than table (still negligible)

## Rule of Thumb

**Use statistics to:**
- Verify TEMPLATE_PLACEHOLDER is working
- Measure TEMPLATE_PLACEHOLDER
- Tune TEMPLATE_PLACEHOLDER
- Monitor TEMPLATE_PLACEHOLDER effectiveness over time

**Use JSON format when:**
- Integrating with monitoring systems
- Batch processing
- Building automation around TEMPLATE_PLACEHOLDER
- Generating reports programmatically

**Use quiet mode when:**
- You only need the TEMPLATE_PLACEHOLDER output
- Piping to another command
- Running in cron jobs where stderr is logged
- Performance testing (avoid terminal I/O)

## See Also

- [CLI Reference](../../reference/cli.md) - Complete statistics documentation
- [Guides: Performance](../../guides/performance.md) - Optimization tips
