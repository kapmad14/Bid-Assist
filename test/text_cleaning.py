# text_cleaning.py
import re


def clean_line(line: str) -> str:
    # remove control characters
    line = re.sub(r"[\x00-\x1F]", "", line)

    # remove non-ASCII characters (English-only)
    line = re.sub(r"[^\x20-\x7E]", "", line)

    # collapse duplicated words
    line = re.sub(r"\b(\w+)(\s+\1\b)+", r"\1", line, flags=re.IGNORECASE)

    # normalize whitespace
    line = re.sub(r"\s+", " ", line)

    return line.strip()


def strip_leading_junk(text: str) -> str:
    """
    Removes any leading non-alphabetic garbage before the first A–Z character.
    """
    match = re.search(r"[A-Za-z].*", text)
    return match.group(0).strip() if match else ""
