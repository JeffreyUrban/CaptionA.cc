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

    # Add defaults if provided
    if "defaults" in template_config:
        cmd.append("--no-input")
        # Pass defaults as extra context
        for key, value in template_config["defaults"].items():
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
        # Cookiecutter converts project_name to slug (lowercase, hyphens)
        project_slug = project_name.lower().replace(" ", "-").replace("_", "-")
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

    if not generated_dirs:
        print(f"Warning: Could not automatically find generated project in {target_dir}")
        print("You may need to manually integrate the project")
        return target_dir

    return generated_dirs[0]


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


def integrate_project(project_path: Path, monorepo_root: Path) -> None:
    """
    Integrate the generated project with monorepo conventions.

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

    # 2. Keep project documentation files
    doc_files = ["README.md", "CONTRIBUTING.md", "CHANGELOG.md", "CODE_OF_CONDUCT.md"]
    kept_docs = []
    for doc_file in doc_files:
        doc_path = project_path / doc_file
        if doc_path.exists():
            kept_docs.append(doc_file)

    docs_dir = project_path / "docs"
    if docs_dir.exists() and docs_dir.is_dir():
        kept_docs.append("docs/")

    if kept_docs:
        print(f"  Kept project documentation: {', '.join(kept_docs)}")

    # 3. Handle LICENSE file
    license_path = project_path / "LICENSE"
    monorepo_license = monorepo_root / "LICENSE"

    if license_path.exists():
        print("  Kept LICENSE file")

        # Warn if license differs from monorepo
        if monorepo_license.exists():
            try:
                project_license_content = license_path.read_text().strip()
                monorepo_license_content = monorepo_license.read_text().strip()

                # Simple comparison - just check if they're different
                # (not perfect but catches most cases)
                if project_license_content != monorepo_license_content:
                    print("  ⚠️  WARNING: Project LICENSE differs from monorepo LICENSE")
                    print(f"      Please review {project_path.relative_to(monorepo_root)}/LICENSE for compatibility")
            except Exception:
                # If we can't read/compare, just warn generically
                print("  ⚠️  WARNING: Please verify LICENSE compatibility")

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

                # Add path filter if not present
                if "paths:" not in content and "on:" in content:
                    # Add path filter after the 'on:' trigger
                    import re

                    # Find the trigger section and add paths
                    content = re.sub(
                        r"(on:\s*\n\s*(?:push|pull_request):)",
                        f"\\1\n    paths:\n      - '{project_rel_path}/**'",
                        content,
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

    # 7. Fix git-based versioning for monorepo
    pyproject_file = project_path / "pyproject.toml"
    if pyproject_file.exists():
        import re

        content = pyproject_file.read_text()

        # Check for git-based versioning tools
        if "hatch-vcs" in content or "hatch_vcs" in content:
            # hatch-vcs: Add configuration to search parent directories
            if "[tool.hatch.version]" in content:
                if "root" not in content:
                    # Find the monorepo root relative to the project
                    import os

                    rel_path = os.path.relpath(monorepo_root, project_path)
                    content = content.replace("[tool.hatch.version]", f'[tool.hatch.version]\nroot = "{rel_path}"')
                    pyproject_file.write_text(content)
                    print("  Configured hatch-vcs to use monorepo's git")
            else:
                # Add the configuration section
                import os

                rel_path = os.path.relpath(monorepo_root, project_path)
                content += f'\n[tool.hatch.version]\nsource = "vcs"\nroot = "{rel_path}"\n'
                pyproject_file.write_text(content)
                print("  Added hatch-vcs configuration for monorepo")

        elif "setuptools-scm" in content or "setuptools_scm" in content:
            # setuptools-scm: Add search_parent_directories = true
            if "[tool.setuptools_scm]" in content:
                if "search_parent_directories" not in content:
                    content = content.replace(
                        "[tool.setuptools_scm]",
                        "[tool.setuptools_scm]\nsearch_parent_directories = true",
                    )
                    pyproject_file.write_text(content)
                    print("  Configured setuptools-scm to search parent directories")
            else:
                content += "\n[tool.setuptools_scm]\nsearch_parent_directories = true\n"
                pyproject_file.write_text(content)
                print("  Added setuptools-scm configuration for monorepo")

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

    # 9. Remove duplicate configuration files for Python projects
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

    # 10. Add to workspace
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

    print("  ✓ Integration complete!")

    # 11. Update workspaces
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

    # Run cookiecutter
    project_path = run_cookiecutter(template_config, project_name, target_dir)

    # Move nested project if needed (extract from workspace wrapper)
    if "integrate_path" in template_config:
        project_path = move_nested_project(project_path, target_dir)

    # Integrate with monorepo
    integrate_project(project_path, monorepo_root)

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
