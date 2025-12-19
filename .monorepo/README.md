# .monorepo Directory

This directory contains configuration and tooling for managing projects within the monorepo.

## Files

### `project-templates.yaml`

Maps project types to external cookiecutter templates. Used by `scripts/add-project.py` to pull and integrate external templates.

**Configuration format:**
```yaml
templates:
  <template-type>:
    repo: "<git-repository-url>"
    version: "<git-branch>"
    target_dir: "<apps|services|packages|data-pipelines>"
    description: "<optional-description>"
```

**Example:**
```yaml
templates:
  cli:
    repo: "https://github.com/JeffreyUrban/cli-template"
    version: "main"
    target_dir: "apps"
    description: "CLI application template"
```

## Future Extensions

As your monorepo grows, you might add:

- **`integration-hooks/`** - Python modules for post-processing generated projects
  - `cli.py` - Integration logic for CLI projects
  - `api.py` - Integration logic for API services
  - etc.

- **`templates/`** - Inline templates for common files (e.g., README templates)

- **`scripts/`** - Monorepo-specific scripts beyond `add-project.py`

## Usage

See the main README.md and `scripts/add-project.py` for usage instructions.
