from __future__ import annotations

import keyword
import re
from collections.abc import Iterator

JAVA_KEYWORDS = {
    "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class",
    "const", "continue", "default", "do", "double", "else", "enum", "extends", "final",
    "finally", "float", "for", "goto", "if", "implements", "import", "instanceof", "int",
    "interface", "long", "native", "new", "package", "private", "protected", "public",
    "return", "short", "static", "strictfp", "super", "switch", "synchronized", "this",
    "throw", "throws", "transient", "try", "void", "volatile", "while", "var", "record",
}

_IDENTIFIER_RE = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]*\b")
_NUMERIC_RE = re.compile(r"\b\d+(?:\.\d+)?\b")
_STRING_RE = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'')
_TOKEN_RE = re.compile(
    r"[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|==|!=|<=|>=|&&|\|\||[{}()\[\];,.<>+\-*/%=&|!:?]"
)


def strip_comments(text: str) -> tuple[str, int, int]:
    result: list[str] = []
    in_line_comment = False
    in_block_comment = False
    in_string = False
    string_delimiter = ""
    comment_lines = 0
    comment_chars = 0
    i = 0
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if in_line_comment:
            comment_chars += 1
            if ch == "\n":
                in_line_comment = False
                comment_lines += 1
                result.append(ch)
            i += 1
            continue
        if in_block_comment:
            comment_chars += 1
            if ch == "\n":
                comment_lines += 1
                result.append(ch)
            elif ch == "*" and nxt == "/":
                comment_chars += 1
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if in_string:
            result.append(ch)
            if ch == "\\" and nxt:
                result.append(nxt)
                i += 2
                continue
            if ch == string_delimiter:
                in_string = False
                string_delimiter = ""
            i += 1
            continue
        if ch in {'"', "'"}:
            in_string = True
            string_delimiter = ch
            result.append(ch)
            i += 1
            continue
        if ch == "/" and nxt == "/":
            in_line_comment = True
            i += 2
            continue
        if ch == "/" and nxt == "*":
            in_block_comment = True
            i += 2
            continue
        result.append(ch)
        i += 1
    return "".join(result), comment_lines, comment_chars


def normalize_whitespace(text: str) -> str:
    lines = [" ".join(line.strip().split()) for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return "\n".join(lines).strip()


def mask_identifiers(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        token = match.group(0)
        if token in JAVA_KEYWORDS or keyword.iskeyword(token):
            return token
        return "ID"

    return _IDENTIFIER_RE.sub(repl, text)


def mask_literals(text: str) -> str:
    text = _STRING_RE.sub("STR", text)
    return _NUMERIC_RE.sub("NUM", text)


def ast_like_normalized(text: str) -> str:
    no_comments, _, _ = strip_comments(text)
    masked = mask_literals(mask_identifiers(no_comments))
    return normalize_whitespace(masked)


def tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text)


def iter_identifiers(text: str) -> Iterator[str]:
    for token in _IDENTIFIER_RE.findall(text):
        if token not in JAVA_KEYWORDS:
            yield token
