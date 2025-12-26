"""Validation tests for documentation content."""

import re
from pathlib import Path

import pytest

# Maximum line length for code blocks and examples
MAX_LINE_LENGTH = 80

# Directories to check (mkdocs user-facing documentation)
DOCS_DIRS = [
    Path("docs/getting-started"),
    Path("docs/use-cases"),
    Path("docs/features"),
    Path("docs/guides"),
    Path("docs/reference"),
    Path("docs/about"),
]


def get_markdown_files():
    """Get all markdown files in mkdocs documentation directories."""
    files = []

    # Add index.md from docs root
    index_file = Path("docs/index.md")
    if index_file.exists():
        files.append(index_file)

    # Add all files from documentation subdirectories
    for docs_dir in DOCS_DIRS:
        if docs_dir.exists():
            files.extend(docs_dir.rglob("*.md"))

    return files


def extract_code_blocks(content: str):
    """
    Extract code blocks from markdown content.

    Returns list of (line_number, line_content, block_type) tuples.
    """
    lines = content.split("\n")
    code_blocks = []
    in_code_block = False
    block_type = None

    for i, line in enumerate(lines, 1):
        # Check for code block start
        if line.strip().startswith("```"):
            if not in_code_block:
                in_code_block = True
                # Extract block type (e.g., "console", "python", "text")
                match = re.match(r"```(\w+)?", line.strip())
                block_type = match.group(1) if match and match.group(1) else "unknown"
            else:
                in_code_block = False
                block_type = None
        # Collect lines inside code blocks
        elif in_code_block:
            code_blocks.append((i, line, block_type))

    return code_blocks


@pytest.mark.parametrize("md_file", get_markdown_files(), ids=lambda p: str(p.relative_to("docs")))
def test_code_block_line_length(md_file):
    """Test that code block lines don't exceed maximum length."""
    content = md_file.read_text()
    code_blocks = extract_code_blocks(content)

    long_lines = []
    for line_num, line, block_type in code_blocks:
        # Skip empty lines
        if not line.strip():
            continue

        # Check visible length (excluding ANSI codes, markdown links)
        # For now, just check raw length
        if len(line) > MAX_LINE_LENGTH:
            long_lines.append((line_num, len(line), line[:100], block_type))

    if long_lines:
        message = f"\n\n{md_file} has code block lines exceeding {MAX_LINE_LENGTH} characters:\n"
        for line_num, length, preview, block_type in long_lines:
            message += f"  Line {line_num} ({block_type}): {length} chars - {preview}...\n"
        pytest.fail(message)


@pytest.mark.parametrize("md_file", get_markdown_files(), ids=lambda p: str(p.relative_to("docs")))
def test_tree_structure_line_length(md_file):
    """Test that tree structures (fixtures/) don't have overly long lines."""
    content = md_file.read_text()
    lines = content.split("\n")

    long_lines = []
    for i, line in enumerate(lines, 1):
        # Check for tree structure lines (├──, └──, etc.)
        if re.search(r"[├└]──", line):
            if len(line) > MAX_LINE_LENGTH:
                long_lines.append((i, len(line), line[:100]))

    if long_lines:
        message = (
            f"\n\n{md_file} has tree structure lines exceeding {MAX_LINE_LENGTH} characters:\n"
        )
        for line_num, length, preview in long_lines:
            message += f"  Line {line_num}: {length} chars - {preview}...\n"
        pytest.fail(message)
