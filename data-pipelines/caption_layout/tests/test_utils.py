"""Test utilities and helper functions."""


def assert_lines_equal(actual: str, expected: list[str]):
    """Assert output matches expected lines."""
    actual_lines = [line for line in actual.split("\n") if line.strip()]
    assert actual_lines == expected
