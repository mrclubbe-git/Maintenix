from __future__ import annotations

from collections import Counter
import re


def _tokens(value: str) -> list[str]:
    """Normalize rendered text into Unicode word tokens for robust PDF checks."""
    return re.findall(r"\w+", str(value or "").casefold(), flags=re.UNICODE)


def _contains_token_multiset(haystack: str, needle: str) -> bool:
    required = Counter(_tokens(needle))
    if not required:
        return False
    observed = Counter(_tokens(haystack))
    return all(observed[token] >= count for token, count in required.items())


def compiled_section_has_content(pdf_text: str, compiled_name: str, compiled_designation: str) -> bool:
    """
    Verify Compiled By content without requiring each cell's wrapped text to remain
    contiguous in pdftotext output. pdftotext -layout can interleave wrapped text
    from adjacent table cells line-by-line, especially for long accepted values.
    """
    text = str(pdf_text or "")
    heading = re.search(r"5\.\s*Compiled\s+By", text, flags=re.IGNORECASE)
    if not heading:
        return False

    compiled_section = text[heading.start():]
    return (
        _contains_token_multiset(compiled_section, compiled_name)
        and _contains_token_multiset(compiled_section, compiled_designation)
    )
