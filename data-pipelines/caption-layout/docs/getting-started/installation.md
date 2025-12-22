# ⚠️ Template doc: Testing disabled ⚠️

# Installation

`caption-layout` can be installed via Homebrew, pipx, pip, or from source.

## Requirements

- **Python 3.14 or higher** (for pip/pipx installations)
- **Homebrew** (for macOS/Linux Homebrew installation)

`caption-layout` works on Linux, macOS, and Windows.

## Via Homebrew (macOS/Linux)

```bash
brew tap jeffreyurban/caption-layout
brew install caption-layout
```

Homebrew manages the Python dependency and provides easy updates via `brew upgrade`.

## Via pipx (Cross-platform)

```bash
pipx install caption-layout
```

[pipx](https://pipx.pypa.io/) installs in an isolated environment with global CLI access. Works on macOS, Linux, and Windows. Update with `pipx upgrade caption-layout`.

## Via pip

```bash
pip install caption-layout
```

Use `pip` if you want to use caption-layout as a library in your Python projects.

## Via Source

For development or the latest unreleased features:

```bash
git clone https://github.com/yourusername/caption-layout.git
cd caption-layout-workspace/caption-layout
pip install .
```

This installs `caption-layout` and its dependencies:

- **typer** - CLI framework
- **rich** - Terminal formatting and progress display

## Development Installation

For contributing or modifying `caption-layout`, install in editable mode with development dependencies:

```bash
git clone https://github.com/yourusername/caption-layout.git
cd caption-layout-workspace/caption-layout
pip install -e ".[dev]"
```

Development dependencies include:

- **pytest** - Test framework
- **pytest-cov** - Code coverage
- **ruff** - Linting and formatting
- **pyright** - Type checking
- **pre-commit** - Git hooks for code quality

## Platform-Specific Notes

### Linux

Recommended installation methods:

- **Homebrew**: `brew tap jeffreyurban/caption-layout && brew install caption-layout`
- **pipx**: `pipx install caption-layout`
- **pip**: `pip install caption-layout`

!!! tip "Virtual Environments"
    If using pip directly, consider using a virtual environment:
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    pip install caption-layout
    ```

### macOS

Recommended installation methods:

- **Homebrew**: `brew tap jeffreyurban/caption-layout && brew install caption-layout` (recommended)
- **pipx**: `pipx install caption-layout`
- **pip**: `pip install caption-layout`

### Windows

Recommended installation methods:

- **pipx**: `pipx install caption-layout` (recommended)
- **pip**: `pip install caption-layout`

The `caption-layout` command will be available in your terminal after installation.

## Verify Installation

After installation, verify `caption-layout` is working:

```bash
caption-layout --version
caption-layout --help
```

Try a quick test:

```bash
echo -e "TEMPLATE_PLACEHOLDER" | caption-layout --TEMPLATE_PLACEHOLDER
```

Expected output:
```
TEMPLATE_PLACEHOLDER
```

## Upgrading

### Homebrew

```bash
brew upgrade caption-layout
```

### pipx

```bash
pipx upgrade caption-layout
```

### pip

```bash
pip install --upgrade caption-layout
```

### Source Installation

```bash
cd caption-layout-workspace/caption-layout
git pull
pip install --upgrade .
```

For development installations:

```bash
cd caption-layout-workspace/caption-layout
git pull
pip install --upgrade -e ".[dev]"
```

## Uninstalling

### Homebrew

```bash
brew uninstall caption-layout
```

### pipx

```bash
pipx uninstall caption-layout
```

### pip

```bash
pip uninstall caption-layout
```

## Troubleshooting

### Command Not Found

If `caption-layout` command is not found after installation:

1. **Check pip installed in the right location:**
   ```bash
   pip show caption-layout
   ```

2. **Verify Python scripts directory is in PATH:**
   ```bash
   python -m site --user-base
   ```
   Add `<user-base>/bin` to your PATH if needed.

3. **Use Python module syntax:**
   ```bash
   python -m caption-layout --help
   ```

### Import Errors

If you see import errors, ensure dependencies are installed:

```bash
pip install typer rich
```

Or reinstall with dependencies:

```bash
pip install --force-reinstall .
```

### Permission Errors

If you encounter permission errors, install for your user only:

```bash
pip install --user .
```

Or use a virtual environment (recommended):

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install .
```

## Next Steps

- [Quick Start Guide](quick-start.md) - Learn basic usage
- [Basic Concepts](basic-concepts.md) - Understand how `caption-layout` works
- [CLI Reference](../reference/cli.md) - Complete command-line options
