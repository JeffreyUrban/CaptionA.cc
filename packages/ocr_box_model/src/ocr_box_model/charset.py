"""Character set detection using Unicode ranges.

Detects the presence of different character sets in text for use
as features in the box classification model.
"""

from ocr_box_model.types import CharacterSets


def is_in_ranges(code: int, ranges: list[tuple[int, int]]) -> bool:
    """Check if Unicode code point is in any of the given ranges.

    Args:
        code: Unicode code point
        ranges: List of (start, end) tuples (inclusive)

    Returns:
        True if code is in any range
    """
    return any(start <= code <= end for start, end in ranges)


def is_roman_char(code: int) -> bool:
    """Check if character is Roman (Latin alphabet).

    Includes: Basic Latin, Latin-1 Supplement, Latin Extended-A, Latin Extended-B
    """
    ranges = [
        (0x0041, 0x005A),  # A-Z
        (0x0061, 0x007A),  # a-z
        (0x00C0, 0x00FF),  # Latin-1 Supplement (accented chars)
        (0x0100, 0x017F),  # Latin Extended-A
        (0x0180, 0x024F),  # Latin Extended-B
    ]
    return is_in_ranges(code, ranges)


def is_hanzi_char(code: int) -> bool:
    """Check if character is Hanzi (Chinese).

    Includes: CJK Unified Ideographs, CJK Extension A
    """
    ranges = [
        (0x4E00, 0x9FFF),  # CJK Unified Ideographs
        (0x3400, 0x4DBF),  # CJK Extension A
    ]
    return is_in_ranges(code, ranges)


def is_arabic_char(code: int) -> bool:
    """Check if character is Arabic.

    Includes: Arabic, Arabic Supplement
    """
    ranges = [
        (0x0600, 0x06FF),  # Arabic
        (0x0750, 0x077F),  # Arabic Supplement
    ]
    return is_in_ranges(code, ranges)


def is_korean_char(code: int) -> bool:
    """Check if character is Korean (Hangul).

    Includes: Hangul Syllables, Hangul Jamo
    """
    ranges = [
        (0xAC00, 0xD7AF),  # Hangul Syllables
        (0x1100, 0x11FF),  # Hangul Jamo
    ]
    return is_in_ranges(code, ranges)


def is_hiragana_char(code: int) -> bool:
    """Check if character is Hiragana."""
    return 0x3040 <= code <= 0x309F


def is_katakana_char(code: int) -> bool:
    """Check if character is Katakana."""
    return 0x30A0 <= code <= 0x30FF


def is_cyrillic_char(code: int) -> bool:
    """Check if character is Cyrillic."""
    return 0x0400 <= code <= 0x04FF


def is_devanagari_char(code: int) -> bool:
    """Check if character is Devanagari."""
    return 0x0900 <= code <= 0x097F


def is_thai_char(code: int) -> bool:
    """Check if character is Thai."""
    return 0x0E00 <= code <= 0x0E7F


def is_digit_char(code: int) -> bool:
    """Check if character is an ASCII digit."""
    return 0x0030 <= code <= 0x0039


def is_punctuation_char(code: int) -> bool:
    """Check if character is ASCII punctuation.

    Includes: ! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \\ ] ^ _ ` { | } ~
    """
    ranges = [
        (0x0021, 0x002F),  # ! " # $ % & ' ( ) * + , - . /
        (0x003A, 0x0040),  # : ; < = > ? @
        (0x005B, 0x0060),  # [ \ ] ^ _ `
        (0x007B, 0x007E),  # { | } ~
    ]
    return is_in_ranges(code, ranges)


def detect_character_sets(text: str) -> CharacterSets:
    """Detect character sets in text using Unicode character code ranges.

    Returns binary indicators (1.0 or 0.0) for each character set.
    Non-exclusive: "Season 2 第二季" returns {is_roman: 1.0, is_hanzi: 1.0, is_digits: 1.0, ...}

    Args:
        text: Text to analyze

    Returns:
        CharacterSets with binary indicators for each character set
    """
    result = CharacterSets()

    for char in text:
        code = ord(char)

        if is_roman_char(code):
            result.is_roman = 1.0
        if is_hanzi_char(code):
            result.is_hanzi = 1.0
        if is_arabic_char(code):
            result.is_arabic = 1.0
        if is_korean_char(code):
            result.is_korean = 1.0
        if is_hiragana_char(code):
            result.is_hiragana = 1.0
        if is_katakana_char(code):
            result.is_katakana = 1.0
        if is_cyrillic_char(code):
            result.is_cyrillic = 1.0
        if is_devanagari_char(code):
            result.is_devanagari = 1.0
        if is_thai_char(code):
            result.is_thai = 1.0
        if is_digit_char(code):
            result.is_digits = 1.0
        if is_punctuation_char(code):
            result.is_punctuation = 1.0

    return result
