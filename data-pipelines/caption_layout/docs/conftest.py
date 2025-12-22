"""Sybil configuration for testing code examples in documentation."""

import re
import shutil
import subprocess
from pathlib import Path

from sybil import Sybil
from sybil.parsers.markdown import CodeBlockParser, SkipParser


def evaluate_console_block(example):
    """
    Evaluate console code blocks with $ prompts.

    Format:
        $ command
        expected output line 1
        expected output line 2
        $ another command
        more expected output

    Or with file verification:
        <!-- verify-file: output.log expected: expected-output.log -->
        $ command > output.log

    The expected file is compared against the generated output file.

    Commands are run from docs/examples/fixtures/ directory.
    """
    # Get the fixtures directory - search upward from the file location
    current_path = Path(example.path).parent
    fixtures_dir = None

    # Try local fixtures first
    if (current_path / "fixtures").exists():
        fixtures_dir = current_path / "fixtures"
    else:
        # Search upward for docs directory, then look for examples/fixtures
        while current_path.name != "docs" and current_path.parent != current_path:
            current_path = current_path.parent

        # Now we should be at docs directory
        if current_path.name == "docs":
            shared_fixtures = current_path / "examples" / "fixtures"
            if shared_fixtures.exists():
                fixtures_dir = shared_fixtures

    if fixtures_dir is None:
        raise FileNotFoundError(
            f"Fixtures directory not found starting from {Path(example.path).parent}"
        )

    lines = example.parsed.strip().split("\n")
    i = 0
    verify_file = None
    expected_file = None

    while i < len(lines):
        line = lines[i]

        # Check for file verification marker
        if line.strip().startswith("<!-- verify-file:"):
            # Extract filenames from <!-- verify-file: output.log expected: expected.log -->
            match = re.match(r"<!--\s*verify-file:\s*(\S+)\s+expected:\s*(\S+)\s*-->", line.strip())
            if match:
                verify_file = match.group(1)
                expected_file = match.group(2)
            i += 1
            continue

        # Skip empty lines
        if not line.strip():
            i += 1
            continue

        # Process command lines (starting with $)
        if line.startswith("$ "):
            command = line[2:].strip()

            # Handle multi-line commands with backslash continuation
            while command.endswith("\\") and i + 1 < len(lines):
                i += 1
                next_line = lines[i].strip()
                # Remove the trailing backslash and append next line
                command = command[:-1].strip() + " " + next_line

            # Strip annotation comments (e.g., # (1)!)
            if " #" in command:
                # Only strip if it looks like an annotation comment
                comment_part = command.split(" #", 1)[1].strip()
                if comment_part.startswith("(") and comment_part.endswith(")!"):
                    command = command.split(" #", 1)[0].strip()

            # Collect expected output (lines until next $ or end)
            expected_lines = []
            i += 1
            while i < len(lines) and not lines[i].startswith("$ "):
                if lines[i].strip():  # Skip empty lines in expected output
                    expected_lines.append(lines[i])
                i += 1

            expected_output = "\n".join(expected_lines)

            # Run the command from fixtures directory
            try:
                result = subprocess.run(
                    command,
                    shell=True,
                    cwd=fixtures_dir,
                    capture_output=True,
                    text=True,
                    timeout=10,
                )

                # Check exit code
                if result.returncode != 0:
                    raise AssertionError(
                        f"Command failed: {command}\n"
                        f"Exit code: {result.returncode}\n"
                        f"Stderr: {result.stderr}"
                    )

                # Verify file content if verify_file marker was present
                if verify_file and expected_file:
                    output_file = fixtures_dir / verify_file
                    expected_file_path = fixtures_dir / expected_file

                    if not output_file.exists():
                        raise AssertionError(
                            f"Expected output file not created: {verify_file}\nCommand: {command}"
                        )

                    if not expected_file_path.exists():
                        raise AssertionError(
                            f"Expected fixture file not found: {expected_file}\nCommand: {command}"
                        )

                    actual_output = output_file.read_text().strip()
                    expected_output_content = expected_file_path.read_text().strip()

                    assert actual_output == expected_output_content, (
                        f"\nCommand: {command}\n"
                        f"Output file: {verify_file}\n"
                        f"Expected file: {expected_file}\n"
                        f"Expected:\n{expected_output_content}\n"
                        f"Actual:\n{actual_output}"
                    )
                    # Clean up the output file
                    output_file.unlink()
                    verify_file = None  # Reset for next command
                    expected_file = None
                # Verify file content with inline expected output (legacy)
                elif verify_file and expected_output:
                    output_file = fixtures_dir / verify_file
                    if not output_file.exists():
                        raise AssertionError(
                            f"Expected output file not created: {verify_file}\nCommand: {command}"
                        )
                    actual_output = output_file.read_text().strip()
                    assert actual_output == expected_output, (
                        f"\nCommand: {command}\n"
                        f"File: {verify_file}\n"
                        f"Expected:\n{expected_output}\n"
                        f"Actual:\n{actual_output}"
                    )
                    # Clean up the output file
                    output_file.unlink()
                    verify_file = None  # Reset for next command
                # Compare stdout if expected output provided and not file verification
                elif expected_output:
                    actual_output = result.stdout.strip()
                    assert actual_output == expected_output, (
                        f"\nCommand: {command}\n"
                        f"Expected:\n{expected_output}\n"
                        f"Actual:\n{actual_output}"
                    )
            except subprocess.TimeoutExpired as e:
                raise AssertionError(f"Command timed out: {command}") from e
        else:
            # Unexpected format
            raise ValueError(f"Expected line to start with '$ ', got: {line}")


def evaluate_python_block(example):
    """
    Evaluate Python code blocks, with optional file verification.

    If preceded by <!-- verify-file: output.log expected: expected.log -->,
    the code runs in fixtures dir and output is verified against expected file.
    """
    # Check if there's a verify-file marker before this code block
    # We need to look at the raw document content before this example
    raw_content = Path(example.path).read_text()

    verify_file = None
    expected_file = None

    # Search backwards from the code block position for verify-file marker
    lines_before = raw_content[: example.region.start].split("\n")
    for line in reversed(lines_before[-10:]):  # Check last 10 lines before block
        if "verify-file:" in line:
            match = re.match(r"<!--\s*verify-file:\s*(\S+)\s+expected:\s*(\S+)\s*-->", line.strip())
            if match:
                verify_file = match.group(1)
                expected_file = match.group(2)
                break

    # Get fixtures directory
    current_path = Path(example.path).parent
    fixtures_dir = None

    if (current_path / "fixtures").exists():
        fixtures_dir = current_path / "fixtures"
    else:
        while current_path.name != "docs" and current_path.parent != current_path:
            current_path = current_path.parent
        if current_path.name == "docs":
            shared_fixtures = current_path / "examples" / "fixtures"
            if shared_fixtures.exists():
                fixtures_dir = shared_fixtures

    if fixtures_dir is None:
        fixtures_dir = Path.cwd()  # Fallback to current directory

    # Execute the code
    if verify_file and expected_file:
        # Change to fixtures directory, execute, verify, and clean up
        import os

        original_dir = os.getcwd()
        try:
            os.chdir(fixtures_dir)
            exec(example.parsed, {})

            # Verify output file
            output_file = Path(verify_file)
            expected_file_path = Path(expected_file)

            if not output_file.exists():
                raise AssertionError(f"Expected output file not created: {verify_file}")

            if not expected_file_path.exists():
                raise AssertionError(f"Expected fixture file not found: {expected_file}")

            # Check if binary file based on extension
            is_binary = verify_file.endswith(".bin")

            if is_binary:
                actual_output = output_file.read_bytes()
                expected_output_content = expected_file_path.read_bytes()

                assert actual_output == expected_output_content, (
                    f"\nPython code binary output mismatch\n"
                    f"Output file: {verify_file}\n"
                    f"Expected file: {expected_file}\n"
                    f"File sizes: {len(actual_output)} vs {len(expected_output_content)} bytes"
                )
            else:
                # Normalize output by stripping trailing whitespace from each line
                # This allows expected files to pass pre-commit hooks while matching
                # actual output that may have trailing spaces (e.g., from Rich tables)
                def normalize_text(text: str) -> str:
                    lines = [line.rstrip() for line in text.splitlines()]
                    return "\n".join(lines).strip()

                actual_output = normalize_text(output_file.read_text())
                expected_output_content = normalize_text(expected_file_path.read_text())

                assert actual_output == expected_output_content, (
                    f"\nPython code output mismatch\n"
                    f"Output file: {verify_file}\n"
                    f"Expected file: {expected_file}\n"
                    f"Expected:\n{expected_output_content}\n"
                    f"Actual:\n{actual_output}"
                )

            # Clean up
            output_file.unlink()
        finally:
            os.chdir(original_dir)
    else:
        # Normal execution
        exec(example.parsed, {})


pytest_collect_file = Sybil(
    parsers=[
        CodeBlockParser(language="python", evaluator=evaluate_python_block),
        CodeBlockParser(language="console", evaluator=evaluate_console_block),
        SkipParser(),
    ],
    patterns=["*.md"],
    path=".",  # Relative to this conftest.py in docs/
    fixtures=["tmp_path"],
    excludes=[
        # Exclude reference and conceptual docs with non-executable examples
        "about/design-decisions.md",
        "about/contributing.md",
        "about/algorithm.md",
        "reference/cli.md",
        "reference/library.md",
        "reference/caption_layout.md",
    ],
).pytest()


def pytest_collection_modifyitems(items):
    """
    Skip examples in documents marked as templates.

    If a document contains the visible warning heading:
    "# ⚠️ Template doc: Testing disabled ⚠️"
    all examples in that document are skipped during testing.

    This allows incremental documentation development - remove the heading
    when the doc is ready to be tested.
    """
    import pytest

    for item in items:
        # Sybil test items have fspath pointing to the markdown file
        if hasattr(item, "fspath"):
            doc_path = Path(str(item.fspath))
            if doc_path.suffix == ".md" and doc_path.exists():
                content = doc_path.read_text()
                if "# ⚠️ Template doc: Testing disabled ⚠️" in content:
                    item.add_marker(pytest.mark.skip(reason="Template doc - testing disabled"))


def pytest_sessionfinish(session, exitstatus):
    """Clean up test artifacts after test session completes.

    This pytest hook runs after all tests finish and removes:
    - TEMPLATE_PLACEHOLDER
    - Transient output files (output.txt, output.log, test-output*.txt, etc.)
    - Generated TEMPLATE_PLACEHOLDER files (*.output in TEMPLATE_PLACEHOLDER/ directories)
    - Generated stats files (job-stats.json, etc.)
    """
    # Find docs directory (parent of this conftest.py)
    docs_dir = Path(__file__).parent

    # Clean up metadata directories
    for metadata_dir in docs_dir.rglob("metadata-*"):
        if metadata_dir.is_dir() and metadata_dir.parent.name in [
            "library",
            "prod-patterns",
            "production-patterns",
            "baseline-lib",
            "test-lib",
        ]:
            # Verify it matches the timestamp pattern to avoid accidentally deleting non-test dirs
            if re.match(r"metadata-\d{8}-\d{6}-\d{6}$", metadata_dir.name):
                try:
                    shutil.rmtree(metadata_dir)
                except OSError:
                    pass  # Ignore errors during cleanup

    # Clean up directories and their .output files
    for TEMPLATE_PLACEHOLDER_dirs in docs_dir.rglob("TEMPLATE_PLACEHOLDER"):
        if TEMPLATE_PLACEHOLDER_dirs.is_dir() and TEMPLATE_PLACEHOLDER_dirs.parent.name in [
            "library",
            "prod-patterns",
            "production-patterns",
            "baseline-lib",
            "test-lib",
            "known-patterns",
            "patterns",
        ]:
            # Remove all .output files (these are regenerated during tests)
            for seq_file in TEMPLATE_PLACEHOLDER_dirs.glob("*.output"):
                try:
                    seq_file.unlink()
                except OSError:
                    pass  # Ignore errors during cleanup

    # Clean up transient output files in fixtures directories
    transient_patterns = [
        "output.txt",
        "output.log",
        "output.bin",
        "test-output*.txt",
        "job-stats.json",
        "*-stats.json",
    ]
    for pattern in transient_patterns:
        for fixtures_dir in docs_dir.rglob("fixtures"):
            if fixtures_dir.is_dir():
                for output_file in fixtures_dir.glob(pattern):
                    if output_file.is_file():
                        # Only delete if not expected-* or input-* files
                        if not output_file.name.startswith(("expected-", "input-")):
                            try:
                                output_file.unlink()
                            except OSError:
                                pass  # Ignore errors during cleanup
