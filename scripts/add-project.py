#!/usr/bin/env python3
"""
Add Project Tool - Integrate external cookiecutter templates into this monorepo

This script:
1. Reads .monorepo/project-templates.yaml to find template configuration
2. Runs cookiecutter with the external template
3. Places the generated project in the appropriate directory
4. Integrates it with monorepo conventions (removes duplicate configs, adds to workspace)

Usage:
    ./scripts/add-project.py <template-type> <project-name>

    Example:
        ./scripts/add-project.py cli my-awesome-cli
        ./scripts/add-project.py api user-service
        ./scripts/add-project.py lib shared-utils

Configuration:
    Add your template URLs to .monorepo/project-templates.yaml

Integration:
    This script includes inline integration logic. You can:
    - Customize the integrate() function below for your needs
    - Create separate integration hooks in .monorepo/integration-hooks/
    - Extend the script to support more complex workflows
"""

import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml


def load_template_config(monorepo_root: Path) -> dict[str, Any]:
    """Load project template configuration from .monorepo/project-templates.yaml"""
    config_path = monorepo_root / ".monorepo" / "project-templates.yaml"

    if not config_path.exists():
        print(f"Error: Configuration file not found: {config_path}")
        print("Please create .monorepo/project-templates.yaml with your template URLs")
        sys.exit(1)

    with open(config_path) as f:
        config = yaml.safe_load(f)

    if not config or "templates" not in config:
        print(f"Error: No templates defined in {config_path}")
        print("Add template configurations to the 'templates' section")
        sys.exit(1)

    return config["templates"]


def run_cookiecutter(template_config: dict[str, Any], project_name: str, target_dir: Path) -> Path:
    """Run cookiecutter with the external template"""
    repo = template_config["repo"]
    version = template_config.get("version", "main")

    print(f"Generating project from template: {repo} @ {version}")
    print(f"Target directory: {target_dir}")

    # Build cookiecutter command
    cmd = [
        "cookiecutter",
        repo,
        f"--checkout={version}",
        f"--output-dir={target_dir}",
    ]

    # Always use --no-input mode with explicit variables
    cmd.append("--no-input")

    # Add project name and slug (auto-derived from project_name argument)
    project_slug = project_name.lower().replace(" ", "_").replace("-", "_")
    cmd.append(f"project_name={project_name}")
    cmd.append(f"project_slug={project_slug}")
    # Add a default short description (can be overridden in defaults)
    cmd.append(f"project_short_description={template_config.get('description', 'A Python project')}")

    # Add defaults from template config if provided
    if "defaults" in template_config:
        # Pass defaults as extra context
        for key, value in template_config["defaults"].items():
            # Skip project_name and project_slug since we set them above
            if key not in ["project_name", "project_slug"]:
                cmd.append(f"{key}={value}")

    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error running cookiecutter: {e}")
        sys.exit(1)

    # Find the generated project directory
    # If integrate_path is specified, use it to locate the specific subdirectory
    if "integrate_path" in template_config:
        integrate_path_template = template_config["integrate_path"]
        # Replace {project_slug} placeholder with actual project slug
        # Use same slug format as we passed to cookiecutter (line 77)
        project_slug = project_name.lower().replace(" ", "_").replace("-", "_")
        integrate_path = integrate_path_template.replace("{project_slug}", project_slug)

        # The integrate_path is relative to target_dir, not the generated directory
        # For example: "test-cli-workspace/test-cli"
        full_path = target_dir / integrate_path
        if full_path.exists():
            print(f"  Using integrate_path: {integrate_path}")
            return full_path
        else:
            print(f"Warning: integrate_path '{integrate_path}' not found at {full_path}")
            # Fall back to finding the generated directory
            generated_dirs = [d for d in target_dir.iterdir() if d.is_dir() and project_slug in d.name.lower()]
            if generated_dirs:
                return generated_dirs[0]
            else:
                print(f"Warning: Could not find generated project in {target_dir}")
                return target_dir

    # Default behavior: find directory matching project name
    generated_dirs = [d for d in target_dir.iterdir() if d.is_dir() and project_name.lower() in d.name.lower()]

    # If not found by project_name, look for any new directory (most recently created)
    if not generated_dirs:
        # Find most recently created directory
        all_dirs = [d for d in target_dir.iterdir() if d.is_dir() and not d.name.startswith(".")]
        if all_dirs:
            # Sort by modification time, get most recent
            generated_dirs = sorted(all_dirs, key=lambda x: x.stat().st_mtime, reverse=True)[:1]

    if not generated_dirs:
        print(f"Warning: Could not automatically find generated project in {target_dir}")
        print("You may need to manually integrate the project")
        return target_dir

    project_dir = generated_dirs[0]

    # Rename directory to match project_slug if needed
    expected_name = project_name.lower().replace(" ", "-")
    if project_dir.name != expected_name:
        new_path = project_dir.parent / expected_name
        project_dir.rename(new_path)
        print(f"  Renamed {project_dir.name} → {expected_name}")
        project_dir = new_path

    return project_dir


def clone_github_template(template_config: dict[str, Any], project_name: str, target_dir: Path) -> Path:
    """Clone a GitHub template repository directly (non-cookiecutter)"""
    import re
    import shutil
    import tempfile

    repo = template_config["repo"]
    version = template_config.get("version", "main")

    # Extract template repo name from URL for fallback replacement
    # e.g., "https://github.com/user/web-react-router-template" -> "web-react-router-template"
    template_repo_name = None
    repo_match = re.search(r"/([^/]+?)(?:\.git)?$", repo)
    if repo_match:
        template_repo_name = repo_match.group(1)

    print(f"Cloning GitHub template: {repo} @ {version}")
    print(f"Target directory: {target_dir}")

    # Convert project_name to slug (same logic as cookiecutter)
    project_slug = project_name.lower().replace(" ", "-").replace("_", "-")
    project_slug = project_slug.replace(".", "-").replace("/", "-").replace("\\", "-")
    # Remove invalid characters and clean up
    import re

    project_slug = re.sub(r"[^a-z0-9-]", "-", project_slug)
    project_slug = re.sub(r"-+", "-", project_slug)
    project_slug = project_slug.strip("-")

    final_path = target_dir / project_slug

    # Clone to temporary directory first
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir) / "template"

        print("  Cloning repository...")
        try:
            # Clone the specific branch
            subprocess.run(
                ["git", "clone", "--branch", version, "--depth", "1", repo, str(tmp_path)],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as e:
            print(f"Error cloning repository: {e}")
            print(f"stderr: {e.stderr}")
            sys.exit(1)

        # Remove .git directory from cloned template
        git_dir = tmp_path / ".git"
        if git_dir.exists():
            shutil.rmtree(git_dir)

        # Apply customizations (always include project_name and project_slug)
        customizations = template_config.get("customizations", {}).copy()
        customizations["project_name"] = project_name
        customizations["project_slug"] = project_slug

        print("  Applying customizations...")
        apply_customizations(tmp_path, customizations, template_repo_name=template_repo_name)

        # Copy to final location
        if final_path.exists():
            print(f"  Warning: {final_path} already exists, removing...")
            shutil.rmtree(final_path)

        shutil.copytree(tmp_path, final_path)
        print(f"  ✓ Created project at {final_path.relative_to(target_dir.parent)}")

    return final_path


def apply_customizations(
    project_path: Path, customizations: dict[str, str], template_repo_name: str | None = None
) -> None:
    """
    Apply text replacements to customize a GitHub template.

    Strategy:
    1. Primary: Check for .template-config.yml and apply specified customizations
    2. Fallback: Heuristic detection - replace template repo name in common files

    This allows templates to remain deployable while still being customizable.
    """
    import json

    import yaml

    # Check for .template-config.yml (our convention for controlled templates)
    template_config_file = project_path / ".template-config.yml"
    if template_config_file.exists():
        print("    Found .template-config.yml - applying template-defined customizations")
        try:
            with open(template_config_file) as f:
                template_config = yaml.safe_load(f)

            if template_config and "customizations" in template_config:
                for custom in template_config["customizations"]:
                    file_path = project_path / custom["file"]
                    if not file_path.exists():
                        continue

                    content = file_path.read_text()
                    original_content = content

                    # Handle JSON path replacement for structured files
                    if "json_path" in custom and file_path.suffix == ".json":
                        try:
                            data = json.loads(content)
                            # Simple dot notation support (e.g., "name" or "config.app")
                            keys = custom["json_path"].split(".")
                            target = data
                            for key in keys[:-1]:
                                target = target[key]

                            # Replace with appropriate value
                            replace_value = customizations.get(custom["replace_with"], custom["replace_with"])
                            target[keys[-1]] = replace_value
                            content = json.dumps(data, indent=2) + "\n"
                        except (json.JSONDecodeError, KeyError) as e:
                            print(f"      Warning: Could not apply JSON customization to {custom['file']}: {e}")
                    else:
                        # Handle text replacement
                        find_str = custom["find"]
                        replace_with = custom.get("replace_with", "project_slug")

                        # Replace placeholder with actual value
                        if "{project_slug}" in replace_with:
                            replace_value = replace_with.replace(
                                "{project_slug}", customizations.get("project_slug", "")
                            )
                        elif "{project_name}" in replace_with:
                            replace_value = replace_with.replace(
                                "{project_name}", customizations.get("project_name", "")
                            )
                        else:
                            replace_value = customizations.get(replace_with, replace_with)

                        content = content.replace(find_str, replace_value)

                    if content != original_content:
                        file_path.write_text(content)
                        relative_path = file_path.relative_to(project_path)
                        print(f"      Customized {relative_path}")

            # Remove .template-config.yml after applying
            template_config_file.unlink()
            print("    Removed .template-config.yml")
            return  # Done with primary strategy

        except Exception as e:
            print(f"    Warning: Could not process .template-config.yml: {e}")
            print("    Falling back to heuristic detection")

    # Fallback: Heuristic detection for templates without .template-config.yml
    print("    Using heuristic detection for customization")

    # Files to customize (common configuration files)
    customizable_files = [
        "package.json",
        "README.md",
        "vite.config.ts",
        "vite.config.js",
        "tsconfig.json",
        "fly.toml",
        "Dockerfile",
        "docker-compose.yml",
        "pyproject.toml",
    ]

    # Collect all files to customize
    files_to_process = []

    # Add root-level config files
    for file_name in customizable_files:
        file_path = project_path / file_name
        if file_path.exists():
            files_to_process.append(file_path)

    # Add workflow files if .github/workflows exists
    workflows_dir = project_path / ".github" / "workflows"
    if workflows_dir.exists():
        for workflow_file in workflows_dir.glob("*.yml"):
            files_to_process.append(workflow_file)
        for workflow_file in workflows_dir.glob("*.yaml"):
            files_to_process.append(workflow_file)

    # Process all files
    for file_path in files_to_process:
        try:
            content = file_path.read_text()
            original_content = content

            # For package.json, update the name field properly
            if file_path.name == "package.json":
                try:
                    pkg_data = json.loads(content)
                    if "project_name" in customizations:
                        pkg_data["name"] = customizations["project_slug"]
                    content = json.dumps(pkg_data, indent=2) + "\n"
                except json.JSONDecodeError:
                    # Fall back to text replacement if JSON is invalid
                    pass

            # Apply text replacements for {key} placeholders
            for key, value in customizations.items():
                content = content.replace(f"{{{key}}}", value)

            # Fallback: Replace template repo name with project slug
            # This handles templates that use their repo name (e.g., 'web-react-router-template')
            if template_repo_name and "project_slug" in customizations:
                content = content.replace(template_repo_name, customizations["project_slug"])

            if content != original_content:
                relative_path = file_path.relative_to(project_path)
                file_path.write_text(content)
                print(f"    Customized {relative_path}")

        except Exception as e:
            relative_path = file_path.relative_to(project_path)
            print(f"    Warning: Could not customize {relative_path}: {e}")


def move_nested_project(project_path: Path, target_dir: Path) -> Path:
    """
    Move a nested project to the target directory and clean up wrapper.

    For example:
    - Input: apps/test-cli-workspace/test-cli
    - Output: apps/test-cli
    - Cleanup: Remove apps/test-cli-workspace
    """
    import shutil

    # Only move if project_path has a parent directory that isn't the target_dir
    if project_path.parent != target_dir:
        final_path = target_dir / project_path.name

        # If final path already exists, remove it first
        if final_path.exists():
            shutil.rmtree(final_path)

        # Move the project directory
        shutil.move(str(project_path), str(final_path))
        print(f"  Moved {project_path.relative_to(target_dir)} → {final_path.name}")

        # Clean up the wrapper directory (remove entirely, including any siblings like homebrew taps)
        wrapper_dir = project_path.parent
        if wrapper_dir.exists() and wrapper_dir != target_dir:
            try:
                shutil.rmtree(wrapper_dir)
                print(f"  Removed wrapper directory: {wrapper_dir.name}")
            except OSError as e:
                print(f"  Warning: Could not remove wrapper directory {wrapper_dir.name}: {e}")

        return final_path

    return project_path


def update_template_run_configs(project_path: Path, monorepo_root: Path) -> None:
    """
    Update existing .run configurations from templates to use correct project name and paths.

    Keeps configurations in the project's .run directory for better organization.
    Handles both PyCharm/WebStorm run configurations that come with the template.
    """
    import re
    import xml.etree.ElementTree as ET

    project_run_dir = project_path / ".run"
    if not project_run_dir.exists():
        return

    project_name = project_path.name
    project_rel_path = project_path.relative_to(monorepo_root)

    configs_updated = []

    for config_file in project_run_dir.glob("*.run.xml"):
        try:
            # Read the configuration
            tree = ET.parse(config_file)
            root = tree.getroot()

            # Find the configuration element
            config = root.find(".//configuration")
            if config is None:
                continue

            # Update configuration name to use project name
            old_name = config.get("name", "")
            # Replace template placeholders with actual project name
            new_name = re.sub(r"\bcli_template\b", project_name, old_name, flags=re.IGNORECASE)
            config.set("name", new_name)

            # Update working directory if present
            for option in config.findall(".//option[@name='WORKING_DIRECTORY']"):
                option.get("value", "")
                # Update to use monorepo project path
                new_value = f"$PROJECT_DIR$/{project_rel_path}"
                option.set("value", new_value)

            # Update Python module paths for pytest
            for option in config.findall(".//option[@name='_new_targetType']"):
                if option.get("value") == "PATH":
                    # Find the associated path option
                    for path_option in config.findall(".//option[@name='_new_target']"):
                        old_path = path_option.get("value", "")
                        if old_path and not old_path.startswith("$PROJECT_DIR$"):
                            # Make path relative to monorepo root
                            new_path = f"$PROJECT_DIR$/{project_rel_path}/{old_path}"
                            path_option.set("value", new_path)

            # Write back to the same file in project's .run directory
            tree.write(config_file, encoding="UTF-8", xml_declaration=True)

            configs_updated.append(config_file.stem)

        except Exception as e:
            print(f"    Warning: Could not update {config_file.name}: {e}")
            continue

    if configs_updated:
        print(f"  Updated {len(configs_updated)} run configuration(s) in {project_rel_path}/.run/")


def generate_webstorm_run_configs(project_path: Path, monorepo_root: Path) -> None:
    """
    Generate WebStorm run configurations for TypeScript/JavaScript projects.

    Creates .run/<project>/*.run.xml files based on package.json scripts.
    """
    import json

    package_json_path = project_path / "package.json"
    if not package_json_path.exists():
        return

    try:
        with open(package_json_path) as f:
            package_data = json.load(f)
    except json.JSONDecodeError:
        print("  Warning: Could not parse package.json for run configurations")
        return

    scripts = package_data.get("scripts", {})
    if not scripts:
        return

    # Determine which scripts to create run configurations for
    # Map script names to display names and whether they should be created
    script_configs = {
        "dev": ("Dev Server", True),
        "start": ("Start", True),
        "build": ("Build", True),
        "test": ("Tests", True),
        "test:watch": ("Tests (Watch)", True),
        "test:ui": ("Tests (UI)", True),
        "test:coverage": ("Test Coverage", True),
        "lint": ("Lint", True),
        "typecheck": ("Typecheck", True),
        "format": ("Format", True),
    }

    # Create .run directory if it doesn't exist
    run_dir = monorepo_root / ".run"
    run_dir.mkdir(exist_ok=True)

    # Get project name for config naming
    project_name = project_path.name
    project_rel_path = project_path.relative_to(monorepo_root)

    # Create project directory if it doesn't exist
    proj_dir = run_dir / project_name
    proj_dir.mkdir(exist_ok=True)

    configs_created = []

    for script_name, (display_name, should_create) in script_configs.items():
        if script_name not in scripts or not should_create:
            continue

        # Create safe filename (replace special chars)
        safe_name = display_name.replace(" ", "_").replace("(", "").replace(")", "")
        config_filename = f"{project_name}__{safe_name}.run.xml"
        config_path = proj_dir / config_filename

        # WebStorm run configuration XML
        config_content = f"""<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="{project_name}: {display_name}" type="js.build_tools.npm">
    <package-json value="$PROJECT_DIR$/{project_rel_path}/package.json" />
    <command value="run" />
    <scripts>
      <script value="{script_name}" />
    </scripts>
    <node-interpreter value="project" />
    <envs />
    <method v="2" />
  </configuration>
</component>
"""

        config_path.write_text(config_content)
        configs_created.append(display_name)

    if configs_created:
        print(f"  Created {len(configs_created)} WebStorm run configuration(s): {', '.join(configs_created)}")


def transform_cookiecutter_pyproject(project_path: Path, monorepo_root: Path, project_name: str) -> None:
    """
    Transform cookiecutter-generated pyproject.toml to monorepo-compliant format.

    This handles:
    - Converting to hatch-vcs with monorepo root
    - Making version dynamic
    - Removing license field (uses root LICENSE.md)
    - Updating Python version requirement
    - Standardizing dependencies and optional-dependencies
    - Adding comprehensive tool configurations
    - Adding workspace sources template

    Args:
        project_path: Path to the generated project directory
        monorepo_root: Path to the monorepo root
        project_name: The desired project name (from command line)
    """
    import os
    import re

    pyproject_file = project_path / "pyproject.toml"
    if not pyproject_file.exists():
        return

    print("  Transforming pyproject.toml for monorepo integration...")

    # Read current content as text (we'll do selective replacements)
    content = pyproject_file.read_text()

    # Use the provided project_name (from command line), not what's in the template
    # Determine package path (handle src layout)
    package_name = project_name.replace("-", "_")
    src_dir = project_path / "src"
    if src_dir.exists():
        packages_line = f'packages = ["src/{package_name}"]'
        source_path = f"src/{package_name}"
    else:
        packages_line = f'packages = ["{package_name}"]'
        source_path = package_name

    # Calculate relative path to monorepo root
    rel_path = os.path.relpath(monorepo_root, project_path)

    # Build the transformed content section by section
    # We'll use a comprehensive template approach

    # 0. Replace project name if it's still the template default
    if re.search(r'name\s*=\s*["\']python-boilerplate["\']', content):
        content = re.sub(r'(name\s*=\s*["\'])python-boilerplate(["\'])', rf"\1{project_name}\2", content)
        print(f"    Updated project name to '{project_name}'")

    # 1. Add build-system if not present or if it doesn't have hatch-vcs
    build_system = """[build-system]
requires = ["hatchling", "hatch-vcs"]
build-backend = "hatchling.build"

"""

    if "[build-system]" not in content:
        # Prepend build system
        content = build_system + content
        print("    Added hatch-vcs build system")
    elif "hatch-vcs" not in content:
        # Replace existing build-system
        import re

        content = re.sub(r"\[build-system\][^\[]*", build_system, content, count=1)
        print("    Updated build system to use hatch-vcs")

    # 2. Make version dynamic and remove license
    import re

    # Remove explicit version line
    if re.search(r'^version\s*=\s*["\']', content, re.MULTILINE):
        content = re.sub(r'^version\s*=\s*["\'][^"\']*["\']\s*\n', "", content, flags=re.MULTILINE)
        print("    Removed explicit version (using dynamic versioning)")

    # Add dynamic = ["version"] after name if not present
    if 'dynamic = ["version"]' not in content and "dynamic =" not in content:
        content = re.sub(
            r'(name\s*=\s*["\'][^"\']*["\'])\s*\n',
            r'\1\n# Version is automatically determined from git tags via hatch-vcs\ndynamic = ["version"]\n',
            content,
        )
        print("    Added dynamic version configuration")

    # Remove license field
    if re.search(r"^license\s*=", content, re.MULTILINE):
        content = re.sub(r"^license\s*=\s*\{[^}]*\}\s*\n", "", content, flags=re.MULTILINE)
        content = re.sub(r'^license\s*=\s*["\'][^"\']*["\']\s*\n', "", content, flags=re.MULTILINE)
        print("    Removed license field (using root LICENSE.md)")

    # 3. Update requires-python to 3.14+
    content = re.sub(r'requires-python\s*=\s*["\'][^"\']*["\']', 'requires-python = ">=3.14"', content)

    # 4. Update dependencies to include rich
    if "dependencies" in content and '"rich' not in content and "'rich" not in content:
        # Add rich to dependencies array
        content = re.sub(r'(dependencies\s*=\s*\[\s*\n\s*["\']typer[^"\']*["\'])', r'\1,\n    "rich>=13.0.0"', content)
        print("    Added rich to dependencies")

    # 5. Replace [project.optional-dependencies] test group with dev and docs groups
    if "[project.optional-dependencies]" in content:
        # Find and replace the entire optional-dependencies section
        opt_deps_replacement = """[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "pytest-cov>=4.1.0",
    "ruff>=0.1.9",
    "pyright>=1.1.0",
    "pre-commit>=3.6.0",
]
docs = [
    "mkdocs-material>=9.5.0",
    "mkdocstrings[python]>=0.25.0",
    "sybil>=6.0.0",
    "pymdown-extensions>=10.0.0",
    "termynal>=0.12.0",
]"""

        # Match the section header and everything until the next section (starting with [)
        # This matches the entire [project.optional-dependencies] section including all subsections
        content = re.sub(
            r"\[project\.optional-dependencies\].*?(?=\n\[|\Z)", opt_deps_replacement, content, flags=re.DOTALL, count=1
        )
        print("    Updated optional-dependencies (dev, docs groups)")

    # 6. Remove [tool.ty] section if present (not used in our monorepo)
    if "[tool.ty]" in content:
        content = re.sub(r"\[tool\.ty\][^\[]*", "", content, count=1)
        print("    Removed [tool.ty] section")

    # 7. Add/update tool configurations before [tool.uv] if present
    # Find where to insert tool configs
    tool_configs = f"""
[tool.hatch.version]
source = "vcs"

[tool.hatch.version.raw-options]
root = "{rel_path}"

[tool.hatch.build.targets.wheel]
{packages_line}

[tool.pytest.ini_options]
testpaths = ["tests", "docs"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
markers = [
    "unit: Unit tests for individual components",
    "integration: Integration tests for multiple components",
    "property: Property-based tests (invariants)",
    "slow: Slow tests (skipped by default)",
]

[tool.black]
line-length = 100
target-version = ["py39"]

[tool.ruff]
line-length = 100
target-version = "py39"

[tool.ruff.lint]
select = [
    "E",   # pycodestyle errors
    "W",   # pycodestyle warnings
    "F",   # pyflakes
    "I",   # isort
    "B",   # flake8-bugbear
    "C4",  # flake8-comprehensions
    "UP",  # pyupgrade
]
ignore = [
    "B008",  # Function calls in argument defaults (typer idiom)
]

[tool.ruff.lint.per-file-ignores]
"tests/**/*.py" = ["E741", "E501"]  # Allow short var names and long lines in tests
"tests/generate_fixtures.py" = ["E402"]  # Module imports after sys.path modification
"*/_version.py" = ["UP", "I001"]  # Auto-generated file by hatch-vcs

[tool.ruff.format]
quote-style = "double"

[tool.pyright]
pythonVersion = "3.14"
typeCheckingMode = "strict"
reportUnusedImport = true
reportUnusedVariable = true
reportDuplicateImport = true

[tool.coverage.run]
source = ["{source_path}"]
omit = ["*/tests/*"]
branch = true

[tool.coverage.report]
exclude_lines = [
    "pragma: no cover",
    "def __repr__",
    "raise AssertionError",
    "raise NotImplementedError",
    "if __name__ == .__main__.:",
    "if TYPE_CHECKING:",
]

[tool.hatch.build.hooks.vcs]
version-file = "{source_path}/_version.py"
"""

    # Remove existing tool.hatch, tool.pytest, tool.ruff, tool.pyright, tool.coverage sections
    # Keep tool.uv at the end
    if "[tool." in content:
        # Find the position of [tool.uv] or end of file
        if "[tool.uv]" in content:
            # Remove all [tool.*] sections except [tool.uv]
            before_tools = content.split("[tool.")[0]
            # Extract [tool.uv] section and everything after
            tool_uv_match = re.search(r"(\[tool\.uv\].*)", content, re.DOTALL)
            if tool_uv_match:
                tool_uv_section = tool_uv_match.group(1)
                content = before_tools + tool_configs + "\n" + tool_uv_section
            else:
                content = before_tools + tool_configs
        else:
            # No [tool.uv], remove all [tool.*] sections and add ours
            before_tools = content.split("[tool.")[0]
            content = before_tools + tool_configs

        print("    Added comprehensive tool configurations")
    else:
        # No tool sections at all, append
        content += "\n" + tool_configs
        print("    Added comprehensive tool configurations")

    # 8. Add [tool.uv.sources] template at the end if not present
    if "[tool.uv]" in content and "[tool.uv.sources]" not in content:
        uv_sources_template = """
[tool.uv.sources]
# Add workspace dependencies here, for example:
# video_utils = { workspace = true }
# ocr_utils = { workspace = true }
"""
        # Append after [tool.uv]
        content = content.rstrip() + "\n" + uv_sources_template + "\n"
        print("    Added [tool.uv.sources] template")

    # Write transformed content
    pyproject_file.write_text(content)
    print("    ✓ pyproject.toml transformed for monorepo")


def cleanup_cli_template_for_monorepo(project_path: Path) -> None:
    """
    Remove standalone-publishing files from comprehensive cli-template.

    The cli-template is designed for standalone publishable packages with PyPI,
    Homebrew, and ReadTheDocs. Monorepo projects don't need these.
    """
    import shutil

    print("  Cleaning up standalone-publishing files...")

    # Files that don't apply to monorepo data pipelines
    standalone_files = [
        "HOMEBREW_AUTOMATION_SETUP.md",  # Homebrew tap setup
        ".readthedocs.yaml",  # ReadTheDocs config
        "scripts/configure-github.sh",  # Standalone GitHub setup
    ]

    removed = []
    for file_name in standalone_files:
        file_path = project_path / file_name
        if file_path.exists():
            if file_path.is_dir():
                shutil.rmtree(file_path)
            else:
                file_path.unlink()
            removed.append(file_name)

    if removed:
        print(f"    Removed standalone files: {', '.join(removed)}")

    # Remove directories/files not needed in monorepo
    dirs_to_remove = [
        ".claude",
        ".vscode",
        ".idea",
        "docs",
    ]
    files_to_remove = [
        "CLAUDE.md",
        "mkdocs.yml",
        "uv.lock",
    ]

    removed_items = []
    for dir_name in dirs_to_remove:
        dir_path = project_path / dir_name
        if dir_path.exists():
            shutil.rmtree(dir_path)
            removed_items.append(f"{dir_name}/")

    for file_name in files_to_remove:
        file_path = project_path / file_name
        if file_path.exists():
            file_path.unlink()
            removed_items.append(file_name)

    if removed_items:
        print(f"    Removed monorepo-unnecessary: {', '.join(removed_items)}")


def get_author_from_git_config() -> str | None:
    """Get author name from git config, fallback to template default."""
    import subprocess

    try:
        result = subprocess.run(["git", "config", "user.name"], capture_output=True, text=True, check=True)
        author = result.stdout.strip()
        if author:
            return author
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    # Fallback: leave as template default
    return None


def get_workspace_python_version(monorepo_root: Path) -> str | None:
    """
    Read requires-python from workspace root pyproject.toml.

    Returns the max version from requires-python (e.g., "3.14" from ">=3.14")
    or None if not found.
    """
    import re

    workspace_pyproject = monorepo_root / "pyproject.toml"
    if not workspace_pyproject.exists():
        return None

    content = workspace_pyproject.read_text()
    match = re.search(r'requires-python\s*=\s*">=([0-9.]+)"', content)
    if match:
        return match.group(1)

    return None


def validate_pyproject_toml(project_path: Path) -> bool:
    """
    Validate that pyproject.toml is well-formed TOML.

    Returns True if valid, prints error and returns False if invalid.
    This prevents broken projects from entering the workspace.
    """
    import tomllib

    pyproject_file = project_path / "pyproject.toml"
    if not pyproject_file.exists():
        return True  # No pyproject.toml, nothing to validate

    try:
        with open(pyproject_file, "rb") as f:
            tomllib.load(f)
        print("  ✓ pyproject.toml validation passed")
        return True
    except tomllib.TOMLDecodeError as e:
        print(f"\n  ✗ ERROR: Invalid pyproject.toml in {project_path.name}")
        print(f"    {e}")
        print(f"    File: {pyproject_file}")
        print("\n  The project was generated but NOT added to workspace.")
        print("  Fix the TOML syntax error and run validation again:")
        print(f"    python3 -c \"import tomllib; tomllib.load(open('{pyproject_file}', 'rb'))\"")
        return False


def strip_monorepo_irrelevant_fields(project_path: Path, monorepo_root: Path) -> None:
    """
    Strip fields from pyproject.toml that are irrelevant or redundant in monorepo context.

    Removes:
    - requires-python (inherited from workspace root)
    - keywords (PyPI metadata, not needed internally)
    - classifiers (PyPI metadata, not needed internally)
    - authors (not needed for internal projects)
    - [project.urls] section (for standalone publishing only)
    - [project.optional-dependencies] (workspace provides dev/docs deps)

    This keeps nested projects minimal while workspace root provides shared configuration.
    """
    pyproject_file = project_path / "pyproject.toml"
    if not pyproject_file.exists():
        return

    print("  Stripping monorepo-irrelevant fields...")
    content = pyproject_file.read_text()
    import re

    fields_stripped = []

    # 1. Remove requires-python (inherited from workspace)
    if re.search(r"requires-python\s*=", content):
        content = re.sub(r'requires-python\s*=\s*["\'][^"\']*["\']\s*\n', "", content)
        fields_stripped.append("requires-python")

    # 2. Remove keywords array
    if re.search(r"keywords\s*=\s*\[", content):
        content = re.sub(r"keywords\s*=\s*\[.*?\]\s*\n", "", content, flags=re.DOTALL)
        fields_stripped.append("keywords")

    # 3. Remove classifiers array
    if re.search(r"classifiers\s*=\s*\[", content):
        content = re.sub(r"classifiers\s*=\s*\[.*?\]\s*\n", "", content, flags=re.DOTALL)
        fields_stripped.append("classifiers")

    # 4. Remove authors array
    if re.search(r"authors\s*=\s*\[", content):
        content = re.sub(r"authors\s*=\s*\[.*?\]\s*\n", "", content, flags=re.DOTALL)
        fields_stripped.append("authors")

    # 5. Remove [project.urls] section
    if "[project.urls]" in content:
        content = re.sub(r"\[project\.urls\].*?(?=\n\[|\Z)", "", content, flags=re.DOTALL)
        fields_stripped.append("[project.urls]")

    # 6. Remove [project.optional-dependencies] section (workspace provides dev/docs)
    if "[project.optional-dependencies]" in content:
        content = re.sub(r"\[project\.optional-dependencies\].*?(?=\n\[|\Z)", "", content, flags=re.DOTALL)
        fields_stripped.append("[project.optional-dependencies]")

    if fields_stripped:
        pyproject_file.write_text(content)
        print(f"    Stripped: {', '.join(fields_stripped)}")
    else:
        print("    No irrelevant fields found to strip")


def apply_cli_template_transformations(project_path: Path, monorepo_root: Path) -> None:
    """
    Apply transformations specific to our cli-template.

    These are safe conditional transformations that only apply if the
    cli-template's specific patterns are detected. They gracefully skip
    if used with other templates.

    Our cli-template conventions:
    - Uses "PYTHON_VERSION_*_KICKOFF" placeholders for Python versions
    - Uses "Your Name" as author placeholder
    - Uses duplicate detection patterns we know about
    """
    pyproject_file = project_path / "pyproject.toml"
    if not pyproject_file.exists():
        return

    print("  Applying cli-template specific transformations...")
    content = pyproject_file.read_text()
    import re

    transformations_applied = []

    # 1. Remove duplicate keys within [project.optional-dependencies]
    # Our cli-template sometimes generates duplicate docs/dev groups
    def remove_duplicate_keys_in_section(text):
        section_match = re.search(r"\[project\.optional-dependencies\](.*?)(?=\n\[|\Z)", text, re.DOTALL)
        if not section_match:
            return text, False

        section_content = section_match.group(1)
        section_start = section_match.start(1)
        key_pattern = r"^(\w+)\s*=\s*\[(.*?)\]"
        keys_found = {}
        keys_to_remove = []

        for match in re.finditer(key_pattern, section_content, re.MULTILINE | re.DOTALL):
            key_name = match.group(1)
            if key_name in keys_found:
                keys_to_remove.append(match)
            else:
                keys_found[key_name] = match

        if not keys_to_remove:
            return text, False

        for match in reversed(keys_to_remove):
            start = section_start + match.start()
            end = section_start + match.end()
            text = text[:start] + text[end + 1 if end < len(text) and text[end] == "\n" else end :]

        return text, True

    content, removed_dupes = remove_duplicate_keys_in_section(content)
    if removed_dupes:
        transformations_applied.append("removed duplicate keys")

    # 2. Replace Python version placeholders (cli-template specific)
    if "PYTHON_VERSION_MIN_KICKOFF" in content or "PYTHON_VERSION_MAX_KICKOFF" in content:
        import datetime

        current_year = datetime.datetime.now().year

        if current_year >= 2025:
            min_version = "3.9"
            intermediate_versions = ["3.10", "3.11", "3.12", "3.13"]
            max_version = "3.14"
        else:
            min_version = "3.8"
            intermediate_versions = ["3.9", "3.10", "3.11", "3.12"]
            max_version = "3.13"

        content = content.replace("PYTHON_VERSION_MIN_KICKOFF", min_version)
        content = content.replace("PYTHON_VERSION_MAX_KICKOFF", max_version)

        for i, version in enumerate(intermediate_versions, start=1):
            placeholder = f"PYTHON_VERSION_INTERMEDIATE_{i}_KICKOFF"
            content = content.replace(placeholder, version)

        content = re.sub(
            r'    "Programming Language :: Python :: PYTHON_VERSION_INTERMEDIATE_\d+_KICKOFF",\n', "", content
        )
        transformations_applied.append(f"Python versions ({min_version}-{max_version})")

    # 3. Replace author placeholder with git config (cli-template specific)
    if '"Your Name"' in content:
        author = get_author_from_git_config()
        if author:
            content = content.replace('"Your Name"', f'"{author}"')
            transformations_applied.append(f"author → {author}")
        else:
            transformations_applied.append("author (kept template default)")

    if transformations_applied:
        pyproject_file.write_text(content)
        print(f"    Applied: {', '.join(transformations_applied)}")
    else:
        print("    No cli-template patterns detected")


def integrate_project(project_path: Path, monorepo_root: Path, project_name: str) -> None:
    """
    Integrate the generated project with monorepo conventions.

    Args:
        project_path: Path to the generated project directory
        monorepo_root: Path to the monorepo root
        project_name: The desired project name (from command line)

    This function demonstrates the integration pattern. Customize based on your needs.

    Integration tasks:
    1. Remove git repository (monorepo is the only git repo)
    2. Keep project documentation (README.md, docs/, CONTRIBUTING.md, etc.)
    3. Handle LICENSE files (keep and warn if different from monorepo)
    4. Merge .gitattributes to monorepo config (with path prefixes)
    5. Merge pre-commit hooks to monorepo config (with file patterns)
    6. Migrate GitHub workflows to monorepo (with path filters)
    7. Fix git-based versioning (hatch-vcs, setuptools-scm)
    8. Detect project type (Python vs TypeScript)
    9. Remove duplicate configs (use monorepo's shared configs instead)
    10. Add to appropriate workspace (uv for Python, npm/pnpm for TypeScript)
    11. Update workspace configuration
    """
    import shutil

    print(f"\nIntegrating {project_path.name} into monorepo...")

    # 1. Remove git repository (monorepo should be the only git repo)
    git_dir = project_path / ".git"
    if git_dir.exists():
        shutil.rmtree(git_dir)
        print("  Removed .git directory (using monorepo's git)")

    # Keep .gitignore - project-specific ignores are useful!
    gitignore_path = project_path / ".gitignore"
    if gitignore_path.exists():
        print("  Kept .gitignore (project-specific ignores)")

    # 2. Keep project documentation files (only README.md and docs/)
    # Remove monorepo-duplicate docs like CONTRIBUTING.md, CODE_OF_CONDUCT.md
    monorepo_docs = ["CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "CHANGELOG.md", "HISTORY.md"]
    removed_docs = []
    for doc_file in monorepo_docs:
        doc_path = project_path / doc_file
        if doc_path.exists():
            doc_path.unlink()
            removed_docs.append(doc_file)

    if removed_docs:
        print(f"  Removed monorepo-duplicate docs: {', '.join(removed_docs)}")

    # Keep README.md and docs/ directory
    kept_docs = []
    if (project_path / "README.md").exists():
        kept_docs.append("README.md")
    docs_dir = project_path / "docs"
    if docs_dir.exists() and docs_dir.is_dir():
        kept_docs.append("docs/")

    if kept_docs:
        print(f"  Kept project documentation: {', '.join(kept_docs)}")

    # 3. Remove LICENSE file (monorepo uses root LICENSE.md)
    license_path = project_path / "LICENSE"
    if license_path.exists():
        license_path.unlink()
        print("  Removed LICENSE file (using monorepo LICENSE.md)")

    # 3a. Remove other unnecessary template files
    unnecessary_files = ["MANIFEST.in", "justfile", ".editorconfig"]
    removed_files = []
    for file_name in unnecessary_files:
        file_path = project_path / file_name
        if file_path.exists():
            file_path.unlink()
            removed_files.append(file_name)

    if removed_files:
        print(f"  Removed unnecessary files: {', '.join(removed_files)}")

    # 4. Merge .gitattributes to monorepo level
    gitattributes_path = project_path / ".gitattributes"
    if gitattributes_path.exists():
        monorepo_gitattributes = monorepo_root / ".gitattributes"
        project_rel_path = project_path.relative_to(monorepo_root)

        # Read project's .gitattributes
        project_attrs = gitattributes_path.read_text().strip()

        if project_attrs:
            # Prefix all patterns with the project path
            prefixed_attrs = []
            for line in project_attrs.split("\n"):
                line = line.strip()
                if line and not line.startswith("#"):
                    # Split pattern and attributes
                    parts = line.split(None, 1)
                    if len(parts) == 2:
                        pattern, attrs = parts
                        # Prefix the pattern with project path
                        prefixed_pattern = f"{project_rel_path}/{pattern}"
                        prefixed_attrs.append(f"{prefixed_pattern} {attrs}")
                    else:
                        # Line has no attributes, keep as-is
                        prefixed_attrs.append(line)
                elif line.startswith("#"):
                    # Keep comments
                    prefixed_attrs.append(line)

            if prefixed_attrs:
                # Read existing monorepo .gitattributes
                existing_content = ""
                if monorepo_gitattributes.exists():
                    existing_content = monorepo_gitattributes.read_text().strip()

                # Append project attributes with a header
                new_section = f"\n# Attributes from {project_path.name}\n" + "\n".join(prefixed_attrs)

                # Write updated .gitattributes
                with open(monorepo_gitattributes, "a") as f:
                    if existing_content:
                        f.write("\n")
                    f.write(new_section)
                    f.write("\n")

                print(f"  Merged .gitattributes to monorepo (scoped to {project_rel_path}/)")

        # Remove project's .gitattributes after merging
        gitattributes_path.unlink()

    # 5. Migrate pre-commit hooks to monorepo level
    precommit_file = project_path / ".pre-commit-config.yaml"
    if precommit_file.exists():
        monorepo_precommit = monorepo_root / ".pre-commit-config.yaml"
        project_rel_path = project_path.relative_to(monorepo_root)

        # Read project's pre-commit config
        import yaml

        with open(precommit_file) as f:
            project_hooks = yaml.safe_load(f)

        if monorepo_precommit.exists():
            with open(monorepo_precommit) as f:
                monorepo_hooks = yaml.safe_load(f)
        else:
            monorepo_hooks = {"repos": []}

        # Merge hooks with file patterns
        if project_hooks and "repos" in project_hooks:
            for repo in project_hooks["repos"]:
                # Add file pattern to restrict hooks to this project
                if "hooks" in repo:
                    for hook in repo["hooks"]:
                        if "files" not in hook:
                            hook["files"] = f"^{project_rel_path}/"

                # Check if repo already exists in monorepo config
                existing_repo = next((r for r in monorepo_hooks["repos"] if r.get("repo") == repo.get("repo")), None)

                if existing_repo:
                    # Merge hooks from this repo
                    existing_hooks = {h["id"]: h for h in existing_repo.get("hooks", [])}
                    for hook in repo.get("hooks", []):
                        if hook["id"] not in existing_hooks:
                            existing_repo.setdefault("hooks", []).append(hook)
                else:
                    # Add new repo
                    monorepo_hooks["repos"].append(repo)

            # Write updated monorepo pre-commit config
            with open(monorepo_precommit, "w") as f:
                yaml.dump(monorepo_hooks, f, default_flow_style=False, sort_keys=False)

            print(f"  Merged pre-commit hooks to monorepo config (scoped to {project_rel_path}/)")

        # Remove project's pre-commit config after merging
        precommit_file.unlink()

    # 6. Migrate GitHub workflows to monorepo level
    github_dir = project_path / ".github"
    if github_dir.exists():
        workflows_dir = github_dir / "workflows"
        monorepo_workflows = monorepo_root / ".github" / "workflows"

        if workflows_dir.exists() and any(workflows_dir.iterdir()):
            monorepo_workflows.mkdir(parents=True, exist_ok=True)
            project_rel_path = project_path.relative_to(monorepo_root)

            # Move workflows with path filters
            migrated_count = 0
            for workflow_file in workflows_dir.glob("*.y*ml"):
                # Read workflow
                content = workflow_file.read_text()

                # Add path filters if not present (using improved regex patterns)
                if "paths:" not in content and "on:" in content:
                    import re

                    # Pattern 1: Simple trigger (on: push:) - add paths right after
                    # Matches: "on:\n  push:" or "on:\n  pull_request:"
                    content = re.sub(
                        r"(on:\s*\n\s*)(push|pull_request)(:)(\s*)(\n)",
                        f"\\1\\2\\3\\4\\5    paths:\\n      - '{project_rel_path}/**'\\n",
                        content,
                    )

                    # Pattern 2: Trigger with properties (types, branches, etc.)
                    # Matches: "pull_request:\n    types: [...]" and adds paths after types
                    # This handles the review app case where types: is specified
                    content = re.sub(
                        r"(on:\s*\n\s*(?:push|pull_request):\s*\n\s*types:\s*\[.*?\])(\s*\n)",
                        f"\\1\\2    paths:\\n      - '{project_rel_path}/**'\\n",
                        content,
                    )

                    # Pattern 3: Trigger with branches but no types
                    # Matches: "push:\n    branches:" and adds paths after branches list
                    content = re.sub(
                        r"(on:\s*\n\s*(?:push|pull_request):\s*\n\s*branches:\s*\n\s*-\s*.*?)(\n(?:\s{4})?(?:[^\s]|$))",
                        f"\\1\\n    paths:\\n      - '{project_rel_path}/**'\\2",
                        content,
                    )

                # Fix Fly.io deployment actions to include path parameter
                if "superfly/fly-pr-review-apps" in content or "superfly/flyctl-actions" in content:
                    import re

                    # Add path parameter to fly-pr-review-apps if missing
                    if re.search(r"uses:\s+superfly/fly-pr-review-apps", content):
                        # Check if 'with:' section exists but 'path:' doesn't
                        if "with:" in content and f"path: {project_rel_path}" not in content:
                            # Add path parameter after 'with:'
                            content = re.sub(
                                r"(uses:\s+superfly/fly-pr-review-apps@[^\n]+\n\s+with:\n)",
                                f"\\1          path: {project_rel_path}\\n",
                                content,
                            )
                            print(f"    Added 'path: {project_rel_path}' to Fly.io action in {workflow_file.name}")

                    # Add path parameter to flyctl-actions deploy if missing
                    if re.search(r"uses:\s+superfly/flyctl-actions/setup-flyctl", content):
                        # For flyctl deploy, we need to add --config parameter to the flyctl deploy command
                        # Check if the deploy command exists and doesn't have --config
                        if re.search(r"flyctl deploy.*--remote-only", content):
                            if f"--config {project_rel_path}/fly.toml" not in content:
                                content = re.sub(
                                    r"(flyctl deploy)(.*--remote-only)",
                                    f"\\1 --config {project_rel_path}/fly.toml\\2",
                                    content,
                                )
                                print(
                                    f"    Added '--config {project_rel_path}/fly.toml' "
                                    f"to flyctl deploy in {workflow_file.name}"
                                )

                # Write to monorepo workflows with project prefix
                new_name = f"{project_path.name}-{workflow_file.name}"
                new_path = monorepo_workflows / new_name
                new_path.write_text(content)
                migrated_count += 1

            if migrated_count > 0:
                print(f"  Migrated {migrated_count} workflow(s) to monorepo .github/workflows/ (with path filters)")

        # Remove project's .github directory
        shutil.rmtree(github_dir)

    # 7. Transform pyproject.toml for monorepo (universal transformations)
    # Works for any cookiecutter template
    transform_cookiecutter_pyproject(project_path, monorepo_root, project_name)

    # 7a. Apply template-specific transformations (conditional, safe for any template)
    apply_cli_template_transformations(project_path, monorepo_root)

    # 7b. Clean up standalone-publishing files (conditional, safe for any template)
    cleanup_cli_template_for_monorepo(project_path)

    # 7c. Strip monorepo-irrelevant fields (universal, works for any template)
    strip_monorepo_irrelevant_fields(project_path, monorepo_root)

    # 7d. Validate pyproject.toml before adding to workspace
    # This prevents broken TOML from breaking the entire workspace
    if not validate_pyproject_toml(project_path):
        print("\n⚠️  Project generation incomplete - fix TOML errors before proceeding")
        sys.exit(1)

    # 8. Detect project type
    has_pyproject = (project_path / "pyproject.toml").exists()
    has_package_json = (project_path / "package.json").exists()

    if has_pyproject and has_package_json:
        print("  Detected: Hybrid project (Python + TypeScript)")
        project_type = "hybrid"
    elif has_pyproject:
        print("  Detected: Python project")
        project_type = "python"
    elif has_package_json:
        print("  Detected: TypeScript project")
        project_type = "typescript"
    else:
        print("  Warning: Unknown project type (no pyproject.toml or package.json)")
        project_type = "unknown"

    # 9. Update .run configurations from template
    update_template_run_configs(project_path, monorepo_root)

    # 10. Remove duplicate configuration files for Python projects
    if project_type in ["python", "hybrid"]:
        duplicate_configs = [
            "ruff.toml",
            ".ruff.toml",
            "pyrightconfig.json",
            ".pyrightconfig.json",
        ]

        for config_file in duplicate_configs:
            config_path = project_path / config_file
            if config_path.exists():
                print(f"  Removing duplicate config: {config_file}")
                config_path.unlink()

    # 11. Add to workspace
    if project_type in ["python", "hybrid"]:
        print("  Python project will be auto-discovered by uv workspace (glob patterns in pyproject.toml)")

    if project_type in ["typescript", "hybrid"]:
        # Add to npm/pnpm workspace
        import json

        package_json_path = monorepo_root / "package.json"
        if package_json_path.exists():
            with open(package_json_path) as f:
                package_data = json.load(f)

            # Get relative path from monorepo root
            relative_path = project_path.relative_to(monorepo_root)

            # Add to workspaces array if not already present
            if "workspaces" not in package_data:
                package_data["workspaces"] = []

            workspace_path = str(relative_path)
            if workspace_path not in package_data["workspaces"]:
                package_data["workspaces"].append(workspace_path)
                print(f"  Added to npm/pnpm workspace: {workspace_path}")

                # Write updated package.json
                with open(package_json_path, "w") as f:
                    json.dump(package_data, f, indent=2)
                    f.write("\n")  # Add trailing newline

    # 12. Generate WebStorm run configurations for TypeScript projects
    if project_type in ["typescript", "hybrid"]:
        generate_webstorm_run_configs(project_path, monorepo_root)

    print("  ✓ Integration complete!")

    # 13. Update workspaces
    print("\nUpdating workspaces...")

    if project_type in ["python", "hybrid"]:
        try:
            subprocess.run(["uv", "sync"], cwd=monorepo_root, check=True, capture_output=True)
            print("  ✓ Python workspace synced (uv)")
        except subprocess.CalledProcessError:
            print("  Warning: Failed to run 'uv sync' - you may need to run it manually")

    if project_type in ["typescript", "hybrid"]:
        # Try npm install (will use pnpm/yarn if configured)
        try:
            subprocess.run(["npm", "install"], cwd=monorepo_root, check=True, capture_output=True)
            print("  ✓ TypeScript workspace synced (npm)")
        except subprocess.CalledProcessError:
            print("  Warning: Failed to run 'npm install' - you may need to run it manually")


def main() -> None:
    """Main entry point"""
    if len(sys.argv) != 3:
        print("Usage: ./scripts/add-project.py <template-type> <project-name>")
        print("\nExample:")
        print("  ./scripts/add-project.py cli my-awesome-cli")
        print("  ./scripts/add-project.py api user-service")
        print("\nAvailable templates are defined in .monorepo/project-templates.yaml")
        sys.exit(1)

    template_type = sys.argv[1]
    project_name = sys.argv[2]

    # Find monorepo root
    monorepo_root = Path(__file__).parent.parent.absolute()

    # Load template configuration
    templates = load_template_config(monorepo_root)

    if template_type not in templates:
        print(f"Error: Template type '{template_type}' not found in configuration")
        print(f"\nAvailable templates: {', '.join(templates.keys())}")
        sys.exit(1)

    template_config = templates[template_type]

    # Determine target directory
    target_dir_name = template_config.get("target_dir", "packages")
    target_dir = monorepo_root / target_dir_name

    if not target_dir.exists():
        print(f"Creating directory: {target_dir}")
        target_dir.mkdir(parents=True)

    # Determine template type (default to cookiecutter for backward compatibility)
    template_type = template_config.get("template_type", "cookiecutter")

    # Generate/clone the project based on template type
    if template_type == "github-template":
        project_path = clone_github_template(template_config, project_name, target_dir)
    elif template_type == "cookiecutter":
        project_path = run_cookiecutter(template_config, project_name, target_dir)

        # Move nested project if needed (extract from workspace wrapper)
        if "integrate_path" in template_config:
            project_path = move_nested_project(project_path, target_dir)
    else:
        print(f"Error: Unknown template_type '{template_type}'")
        print("Supported types: 'cookiecutter', 'github-template'")
        sys.exit(1)

    # Integrate with monorepo
    integrate_project(project_path, monorepo_root, project_name)

    print(f"\n✓ Project '{project_name}' added successfully!")
    print(f"  Location: {project_path.relative_to(monorepo_root)}")
    print("\nNext steps:")
    print(f"  1. cd {project_path.relative_to(monorepo_root)}")
    print("  2. Review the generated code")
    print("  3. Check for project-specific test configurations:")
    print("     - pytest.ini, tox.ini, .coveragerc")
    print("     - Remove if they duplicate monorepo settings, or keep if project-specific")
    print("  4. Run tests: pytest")
    print(f"  5. Commit: git add . && git commit -m 'Add {project_name}'")


if __name__ == "__main__":
    main()
