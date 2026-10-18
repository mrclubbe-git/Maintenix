from __future__ import annotations

from collections import Counter
import re


LONG_TOKEN_MIN = 24
FRAGMENT_MIN = 8


def _tokens(value: str) -> list[str]:
    """Normalize rendered text into Unicode word tokens for robust PDF checks."""
    return re.findall(r"\w+", str(value or "").casefold(), flags=re.UNICODE)


def _contains_fragmented_token(observed_tokens: list[str], expected_token: str) -> bool:
    """
    Reconstruct one long expected token from ordered pdftotext fragments.

    LibreOffice may wrap a long unbroken value inside a table cell. pdftotext
    then emits each wrapped line as a separate token. Adjacent table columns
    can be interleaved between those fragments, so unrelated tokens are
    deliberately skipped while the expected token is reconstructed in order.
    """
    token = str(expected_token or "")
    if len(token) < LONG_TOKEN_MIN:
        return False

    offset = 0
    started = False

    for observed in observed_tokens:
        part = str(observed or "")
        if not part:
            continue

        remaining = token[offset:]

        if not started:
            if token == part:
                return True
            if len(part) < FRAGMENT_MIN or not token.startswith(part):
                continue
            started = True
            offset = len(part)
            if offset == len(token):
                return True
            continue

        # Ignore tokens from adjacent table columns or surrounding content.
        if not remaining.startswith(part):
            continue

        # Require substantial middle fragments. The final fragment may be
        # shorter because a wrapped line can end with only a few characters.
        if len(part) < FRAGMENT_MIN and len(part) != len(remaining):
            continue

        offset += len(part)
        if offset == len(token):
            return True

    return False


def _contains_token_multiset(haystack: str, needle: str) -> bool:
    required = Counter(_tokens(needle))
    if not required:
        return False

    observed_tokens = _tokens(haystack)
    observed = Counter(observed_tokens)

    for token, count in required.items():
        exact = observed[token]
        if exact >= count:
            continue

        missing = count - exact
        if missing != 1:
            return False

        # Only long tokens get the fragment-reconstruction fallback. Normal
        # words still require exact token presence, preserving strict checks.
        if not _contains_fragmented_token(observed_tokens, token):
            return False

    return True


def compiled_section_has_content(pdf_text: str, compiled_name: str, compiled_designation: str) -> bool:
    """
    Verify Compiled By content without requiring each cell's wrapped text to remain
    contiguous in pdftotext output. This tolerates both adjacent-cell interleaving
    and long unbroken values that LibreOffice wraps across physical lines.
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
