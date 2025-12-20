# CaptionA.cc

Capture of hard-coded captions from video with accurate timing and content by establishing and leveraging priors and context

This is a Python + TypeScript monorepo generated from [monorepo-template](https://github.com/JeffreyUrban/monorepo-template).

## Quick Start

```bash
# Install dependencies
uv sync

# Install Node dependencies (for TypeScript projects)
npm install

# Run tests
pytest
npm test  # For TypeScript projects
```

## Monorepo Structure

```
captionacc/
├── apps/                # Applications
│   └── captionacc-web/ # React web application
├── services/            # Backend services (APIs, workers, etc.)
├── packages/            # Shared libraries
├── data-pipelines/      # Data processing pipelines
├── .monorepo/           # Monorepo configuration
│   └── project-templates.yaml   # Template registry
├── scripts/             # Monorepo management scripts
├── pyproject.toml       # Python workspace configuration
└── package.json         # TypeScript workspace configuration
```

## Projects

### Web Application (apps/captionacc-web)

React + React Router 7 + Tailwind CSS 4 web application for caption capture interface.

**Development:**
```bash
cd apps/captionacc-web
npm run dev
```

**Testing:**
```bash
cd apps/captionacc-web
npm test              # Run tests once
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run with coverage
```

**Building:**
```bash
cd apps/captionacc-web
npm run build
```

**JetBrains IDE Run Configurations:**

Run configurations are automatically generated when adding TypeScript/JavaScript projects. Check the `.run/` directory for available configurations, which will appear in your IDE's run configuration dropdown.

Current configurations for `captionacc-web`:
- captionacc-web: Dev Server
- captionacc-web: Build
- captionacc-web: Tests
- captionacc-web: Tests (Watch)
- captionacc-web: Typecheck
- captionacc-web: Lint
- captionacc-web: Test Coverage

*Note: Run configurations use the project directory name as the prefix, making it easy to identify which project each configuration belongs to when you have multiple projects.*

## Adding New Projects

Use the `add-project.py` script to add projects from templates:

```bash
# Add a Python CLI app
./scripts/add-project.py cli caption-cli

# Add a Python API service
./scripts/add-project.py api caption-api

# Add another React web app
./scripts/add-project.py web-react caption-admin

# Add a shared Python library
./scripts/add-project.py lib-python caption-utils
```

### Available Templates

Configure your templates in `.monorepo/project-templates.yaml`:

**Cookiecutter Templates** (Python):
- Python CLIs, APIs, web apps, libraries
- Interactive prompts for customization
- Automatically integrated into `uv` workspace

**GitHub Templates** (TypeScript/React):
- React apps, TypeScript libraries
- Direct repository clones
- Automatically integrated into `npm` workspace

Currently configured:
- `web-react`: React + React Router + Tailwind CSS web application

## Development Workflow

### Python Projects

```bash
# Activate virtual environment (optional, uv handles this automatically)
source .venv/bin/activate

# Run a specific project
cd apps/my-cli
python -m my_cli

# Run tests for all Python projects
pytest

# Type checking
pyright

# Linting
ruff check .
ruff format .
```

### TypeScript Projects

```bash
# Run development server
cd apps/captionacc-web
npm run dev

# Run tests
npm test

# Type checking
npm run typecheck

# Linting
npm run lint

# Build for production
npm run build
```

## Working in Your IDE

### PyCharm / IntelliJ IDEA
- **Open**: Open the monorepo root directory (`/Users/jurban/PycharmProjects/captionacc`)
- **Python Interpreter**: PyCharm will auto-detect the `.venv` from uv
- **Run Configurations**: Create run configurations with working directory set to specific projects

### WebStorm
- **Open**: Open the monorepo root directory (`/Users/jurban/PycharmProjects/captionacc`)
- **Node.js**: WebStorm will auto-detect workspace configuration
- **Run Configurations**: Use the provided `.run/*.run.xml` configurations for the web app

## Shared Code (Packages)

Place shared code in `packages/`:

```bash
# Add a shared Python library
./scripts/add-project.py lib-python caption-core

# Use it in other Python projects
# In pyproject.toml:
# dependencies = ["caption-core"]

# Add a shared TypeScript library
./scripts/add-project.py lib-typescript caption-ui-components

# Use it in other TypeScript projects
# In package.json:
# "dependencies": {"caption-ui-components": "workspace:*"}
```

## Testing

### Python
```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=html
```

### TypeScript
```bash
# Run all tests in web app
cd apps/captionacc-web
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

## Continuous Integration

GitHub Actions workflows are configured at the monorepo level (`.github/workflows/`).

### Active Workflows

- `ci.yml`: Main CI pipeline for Python projects
- `caption-web-ci.yml`: CI for web application (runs on changes to `apps/captionacc-web/**`)
- `caption-web-*.yml`: Additional web app workflows (deployment, link checking, etc.)

Workflows use path filters to run only when relevant files change.

## Common Tasks

### Install Dependencies
```bash
# Python
uv sync

# TypeScript
npm install
```

### Update Dependencies
```bash
# Python - update all
uv lock --upgrade

# Python - update specific package
uv add package@latest

# TypeScript
npm update
```

### Clean Build Artifacts
```bash
# Python
find . -type d -name "__pycache__" -exec rm -rf {} +
find . -type d -name "*.egg-info" -exec rm -rf {} +
find . -type d -name ".pytest_cache" -exec rm -rf {} +

# TypeScript
cd apps/captionacc-web && rm -rf node_modules dist build .vite
```

## Architecture Principles

- **Separation**: Apps/services never import from each other, only from `packages/`
- **Shared configs**: Linting, formatting, and type checking use monorepo-level configs
- **Single git repo**: All projects share git history and version control
- **Independent deployment**: Each app/service can be deployed independently

## Contributing

Issues and discussions welcome, but pull requests are not accepted.

### Code Style

- **Python**: Follow PEP 8, enforced by ruff
- **TypeScript**: Follow ESLint rules in `apps/captionacc-web/eslint.config.js`
- **Formatting**: Use ruff (Python) and prettier (TypeScript)
- **Line length**: 120 characters
- **Quotes**: Single quotes preferred

### Commit Messages

Use conventional commits:
```
feat: add caption extraction algorithm
fix: resolve timestamp accuracy issue
docs: update API documentation
test: add tests for caption parser
refactor: extract video processing utilities
```

This project is licensed under the **NonFunctional Source License (NFSL)**, a generalized version of the Functional Source License that allows customizable conversion periods.

**NFSL = FSL with variable duration (this instance: 10 years)**

- **Current**: Use restricted to non-competing purposes
- **After 10 years** Automatically converts to Apache License 2.0

See [LICENSE.md](LICENSE.md) for full terms.

## Maintainers

- Jeffrey Urban
