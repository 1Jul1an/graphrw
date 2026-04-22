from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, pstdev
from typing import Any

from .java_ast import AstParseError, analyze_java_ast, ast_summary_to_payload, ast_summary_to_struct_features
from .normalization import (
    JAVA_KEYWORDS,
    ast_like_normalized,
    iter_identifiers,
    mask_identifiers,
    mask_literals,
    normalize_whitespace,
    strip_comments,
    tokenize,
)

_METHOD_RE = re.compile(
    r"\b(?:public|protected|private|static|final|synchronized|native|abstract|default|strictfp\s+)*"
    r"(?:[A-Za-z_][A-Za-z0-9_<>\[\]]+\s+)+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;{}]*\)\s*(?:throws\s+[^ {]+)?\{"
)
_CONSTRUCTOR_RE = re.compile(
    r"\b([A-Z][A-Za-z0-9_]*)\s*\([^;{}]*\)\s*(?:throws\s+[^ {]+)?\{"
)
_IMPORT_RE = re.compile(r"^\s*import\s+([A-Za-z0-9_.*]+)\s*;", re.MULTILINE)
_CALL_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(")
_WORDLIKE_TOKEN_RE = re.compile(r"^(?:ID|NUM|STR|[A-Za-z_][A-Za-z0-9_]*)$")
_OPERATOR_PATTERNS: dict[str, str] = {
    "assignment": r"(?:=|\+=|-=|\*=|/=|%=)",
    "comparison": r"(?:==|!=|<=|>=|<|>)",
    "logic": r"(?:&&|\|\||!)",
    "arithmetic": r"(?:\+|-|\*|/|%)",
    "bitwise": r"(?:&|\||\^|~|<<|>>|>>>)",
}
_IDENTIFIER_SHAPE_PATTERNS: dict[str, re.Pattern[str]] = {
    "single_char": re.compile(r"^[A-Za-z]$"),
    "camel_case": re.compile(r"^[a-z]+(?:[A-Z][a-z0-9]+)+$"),
    "snake_case": re.compile(r"^[a-z]+(?:_[a-z0-9]+)+$"),
    "upper_case": re.compile(r"^[A-Z][A-Z0-9_]*$"),
}
_EXPR_KEYWORDS = ("if", "for", "while", "switch", "return", "try", "catch", "throw", "new")
_SEM_CALL_FAMILIES: dict[str, tuple[str, ...]] = {
    "add": ("add", "append", "offer", "push"),
    "access": ("get", "set", "put", "peek", "poll"),
    "remove": ("remove", "pop", "clear"),
    "contains": ("contains", "containsKey", "containsValue", "equals", "matches"),
    "sort": ("sort", "sorted", "compareTo"),
    "parse": ("parseInt", "parseLong", "parseDouble", "valueOf"),
    "io": ("print", "println", "read", "write", "open", "close", "flush"),
}
_TYPE_FAMILIES: dict[str, tuple[str, ...]] = {
    "collections": ("List", "Map", "Set", "Queue", "Deque", "ArrayList", "HashMap", "HashSet", "LinkedList"),
    "streams": ("stream", "Collectors", "Optional", "map", "filter", "reduce"),
    "io": ("File", "Path", "Files", "BufferedReader", "BufferedWriter", "Scanner", "PrintWriter"),
    "strings": ("StringBuilder", "StringBuffer", "substring", "split", "trim", "replace"),
    "numbers": ("Math", "Integer", "Long", "Double", "BigDecimal"),
    "concurrency": ("Thread", "Runnable", "Executor", "Future", "CompletableFuture", "synchronized"),
    "tests": ("assert", "Assertions", "Assert", "Test"),
}

PRIMARY_SPACE_KEYS = ("expr", "struct", "sem")
FUSION_SPACE_KEY = "fusion"
DISPLAY_SPACE_KEYS = PRIMARY_SPACE_KEYS + (FUSION_SPACE_KEY,)
SPACE_KEYS = PRIMARY_SPACE_KEYS


def _safe_ratio(numerator: float, denominator: float) -> float:
    if denominator == 0:
        return 0.0
    return numerator / denominator


def _entropy(values: list[int]) -> float:
    if not values:
        return 0.0
    counts = Counter(values)
    total = sum(counts.values())
    ent = 0.0
    for count in counts.values():
        p = count / total
        ent -= p * math.log2(p)
    return ent


def feature_kind(space: str, key: str) -> str:
    if key.startswith(("import_family:", "ast_provider:", "ast_parse_status:")):
        return "binary"
    if key.startswith(("line_bucket:", "identifier_shape:", "token_category:", "ast_node_ratio:", "ast_type_ratio:", "ast_edge_ratio:", "ast_path_ratio:")):
        return "ratio"
    if key.endswith(("_ratio", "_mean", "_std", "_entropy", "_density")):
        return "ratio"
    if key.endswith(("_branching",)):
        return "ratio"
    if "_per_" in key:
        return "ratio"
    return "count"


def file_normalizations(source: str) -> dict[str, str]:
    no_comments, _, _ = strip_comments(source)
    masked_identifiers_only = normalize_whitespace(mask_identifiers(no_comments))
    masked_literals_only = normalize_whitespace(mask_literals(no_comments))
    return {
        "raw": source,
        "whitespace": normalize_whitespace(source),
        "no_comments": normalize_whitespace(no_comments),
        "masked_identifiers": masked_identifiers_only,
        "masked_literals": masked_literals_only,
        "ast_normalized": ast_like_normalized(source),
    }


def extract_file_space_features(source: str) -> dict[str, Any]:
    no_comments, comment_lines, comment_chars = strip_comments(source)
    tokens = tokenize(no_comments)
    masked_expr_source = mask_identifiers(mask_literals(no_comments))
    masked_tokens = tokenize(masked_expr_source)
    wordlike_masked_tokens = [token for token in masked_tokens if _WORDLIKE_TOKEN_RE.match(token)]
    identifiers = list(iter_identifiers(no_comments))
    non_empty_lines = [line.rstrip() for line in source.splitlines() if line.strip()]
    line_lengths = [len(line) for line in non_empty_lines]
    token_count = len(tokens)

    expr = {
        "token_count": float(token_count),
        "unique_token_ratio": _safe_ratio(len(set(tokens)), token_count),
        "masked_unique_token_ratio": _safe_ratio(len(set(wordlike_masked_tokens)), max(1, len(wordlike_masked_tokens))),
        "identifier_count": float(len(identifiers)),
        "identifier_length_mean": mean([len(i) for i in identifiers]) if identifiers else 0.0,
        "line_length_mean": mean(line_lengths) if line_lengths else 0.0,
        "line_length_std": pstdev(line_lengths) if len(line_lengths) > 1 else 0.0,
        "line_length_entropy": _entropy(line_lengths),
        "comment_line_ratio": _safe_ratio(comment_lines, max(1, len(source.splitlines()))),
        "comment_char_ratio": _safe_ratio(comment_chars, max(1, len(source))),
        "masked_token_entropy": _token_entropy(wordlike_masked_tokens),
        "method_signature_count": float(len(_METHOD_RE.findall(no_comments))),
        "constructor_signature_count": float(len(_CONSTRUCTOR_RE.findall(no_comments))),
        "import_stmt_count": float(len(_IMPORT_RE.findall(no_comments))),
    }
    expr.update(_line_bucket_features(line_lengths))
    expr.update(_identifier_shape_features(identifiers))
    expr.update(_token_category_features(tokens))
    expr.update({f"keyword:{keyword}": float(len(re.findall(rf"\b{keyword}\b", no_comments))) for keyword in _EXPR_KEYWORDS})
    expr.update({f"operator:{name}": float(len(re.findall(pattern, no_comments))) for name, pattern in _OPERATOR_PATTERNS.items()})
    expr.update(_ngram_features(wordlike_masked_tokens, prefix="expr_ngram", ns=(2, 3), top_k={2: 36, 3: 24}))
    expr.update(_masked_line_skeleton_features(no_comments, top_k=28))
    expr.update(_keyword_operator_pair_features(tokens, top_k=20))
    expr.update(_top_call_features(no_comments, top_k=16))

    ast_summary = analyze_java_ast(source)

    struct = ast_summary_to_struct_features(ast_summary)
    struct[f"ast_provider:{ast_summary.provider}"] = 1.0
    struct[f"ast_parse_status:{ast_summary.parse_status}"] = 1.0

    imports = _IMPORT_RE.findall(no_comments)
    sem = {
        "try_count": float(len(re.findall(r"\btry\b", no_comments))),
        "catch_count": float(len(re.findall(r"\bcatch\b", no_comments))),
        "throw_count": float(len(re.findall(r"\bthrow\b", no_comments))),
        "collection_usage": float(len(re.findall(r"\b(List|Map|Set|Queue|Deque|ArrayList|HashMap|HashSet|LinkedList)\b", no_comments))),
        "stream_usage": float(len(re.findall(r"\b(stream|Collectors|Optional|map|filter|reduce)\b", no_comments))),
        "io_usage": float(len(re.findall(r"\b(File|Path|Files|BufferedReader|BufferedWriter|Scanner|PrintWriter)\b", no_comments))),
    }
    for family, tokens_for_family in _TYPE_FAMILIES.items():
        sem[f"type_family:{family}"] = float(sum(no_comments.count(token) for token in tokens_for_family))
    for family, names in _SEM_CALL_FAMILIES.items():
        sem[f"call_family:{family}"] = float(sum(len(re.findall(rf"\b{name}\s*\(", no_comments)) for name in names))
    for imp in imports:
        pkg = ".".join(imp.split(".")[:2])
        if pkg:
            sem[f"import_family:{pkg}"] = 1.0
    sem["import_count_total"] = float(len(imports))
    sem["semantic_signal_density"] = _safe_ratio(sum(value for key, value in sem.items() if not key.startswith("import_family:")), max(1, token_count))

    return {
        "expr": expr,
        "struct": struct,
        "sem": sem,
        "_meta": {"ast": ast_summary_to_payload(ast_summary)},
    }


def aggregate_submission_features(file_features: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    sums: dict[str, defaultdict[str, float]] = {space: defaultdict(float) for space in SPACE_KEYS}
    ratio_sums: dict[str, defaultdict[str, float]] = {space: defaultdict(float) for space in SPACE_KEYS}
    ratio_counts: dict[str, defaultdict[str, float]] = {space: defaultdict(float) for space in SPACE_KEYS}
    binary_max: dict[str, defaultdict[str, float]] = {space: defaultdict(float) for space in SPACE_KEYS}

    for file_feature in file_features:
        for space in SPACE_KEYS:
            for key, value in file_feature[space].items():
                kind = feature_kind(space, key)
                if kind == "ratio":
                    ratio_sums[space][key] += float(value)
                    ratio_counts[space][key] += 1.0
                elif kind == "binary":
                    binary_max[space][key] = max(binary_max[space][key], 1.0 if value > 0 else 0.0)
                else:
                    sums[space][key] += float(value)

    aggregated: dict[str, dict[str, float]] = {space: {} for space in SPACE_KEYS}
    for space in SPACE_KEYS:
        for key, value in sums[space].items():
            aggregated[space][key] = value
        for key, total in ratio_sums[space].items():
            aggregated[space][key] = _safe_ratio(total, ratio_counts[space][key])
        for key, value in binary_max[space].items():
            aggregated[space][key] = value
        aggregated[space]["file_count"] = float(len(file_features))
    return aggregated


def rank_feature_dimensions(features: dict[str, float], limit: int = 10) -> list[dict[str, float | str]]:
    positive_total = sum(abs(value) for value in features.values() if value)
    ranked = []
    for key, value in sorted(features.items(), key=lambda item: (abs(item[1]), item[0]), reverse=True):
        ranked.append(
            {
                "feature": key,
                "value": round(float(value), 6),
                "share": round(abs(float(value)) / positive_total, 6) if positive_total else 0.0,
            }
        )
    return ranked[:limit]


def _line_bucket_features(line_lengths: list[int]) -> dict[str, float]:
    total = max(1, len(line_lengths))
    short = sum(1 for value in line_lengths if value <= 40)
    medium = sum(1 for value in line_lengths if 40 < value <= 100)
    long = sum(1 for value in line_lengths if value > 100)
    return {
        "line_bucket:short_ratio": short / total,
        "line_bucket:medium_ratio": medium / total,
        "line_bucket:long_ratio": long / total,
    }


def _identifier_shape_features(identifiers: list[str]) -> dict[str, float]:
    total = max(1, len(identifiers))
    features = {}
    for name, pattern in _IDENTIFIER_SHAPE_PATTERNS.items():
        features[f"identifier_shape:{name}_ratio"] = sum(1 for value in identifiers if pattern.match(value)) / total
    return features


def _token_category_features(tokens: list[str]) -> dict[str, float]:
    total = max(1, len(tokens))
    keyword_count = sum(1 for token in tokens if token in JAVA_KEYWORDS)
    identifier_count = sum(1 for token in tokens if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", token or "") and token not in JAVA_KEYWORDS)
    literal_count = sum(1 for token in tokens if token in {"NUM", "STR"} or re.fullmatch(r"\d+(?:\.\d+)?", token or ""))
    operator_count = sum(1 for token in tokens if re.fullmatch(r"==|!=|<=|>=|&&|\|\||[<>+\-*/%=&|!:?]", token or ""))
    punctuation_count = max(0, total - keyword_count - identifier_count - literal_count - operator_count)
    return {
        "token_category:keyword_ratio": keyword_count / total,
        "token_category:identifier_ratio": identifier_count / total,
        "token_category:literal_ratio": literal_count / total,
        "token_category:operator_ratio": operator_count / total,
        "token_category:punctuation_ratio": punctuation_count / total,
    }


def _masked_line_skeleton_features(text: str, *, top_k: int) -> dict[str, float]:
    masked = normalize_whitespace(mask_identifiers(mask_literals(text)))
    counts = Counter()
    for raw_line in masked.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        line = re.sub(r"\s+", " ", line)
        line = re.sub(r"\bID\b", "ID", line)
        line = re.sub(r"\bNUM\b", "NUM", line)
        line = re.sub(r"\bSTR\b", "STR", line)
        if len(line) > 96:
            line = line[:96]
        counts[f"line_skeleton:{line}"] += 1
    return {key: float(value) for key, value in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:top_k]}


def _keyword_operator_pair_features(tokens: list[str], *, top_k: int) -> dict[str, float]:
    counts = Counter()
    filtered = [token for token in tokens if token in JAVA_KEYWORDS or re.fullmatch(r"==|!=|<=|>=|&&|\|\||[<>+\-*/%=&|!:?]", token or "")]
    for left, right in zip(filtered, filtered[1:]):
        counts[f"keyword_operator_pair:{left}->{right}"] += 1
    return {key: float(value) for key, value in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:top_k]}


def _token_entropy(tokens: list[str]) -> float:
    if not tokens:
        return 0.0
    counts = Counter(tokens)
    total = sum(counts.values())
    entropy = 0.0
    for count in counts.values():
        p = count / total
        entropy -= p * math.log2(p)
    return entropy


def _ngram_features(tokens: list[str], *, prefix: str, ns: tuple[int, ...], top_k: dict[int, int]) -> dict[str, float]:
    features: dict[str, float] = {}
    for n in ns:
        if len(tokens) < n:
            continue
        counts = Counter(" ".join(tokens[index : index + n]) for index in range(len(tokens) - n + 1))
        for gram, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[: top_k.get(n, 24)]:
            features[f"{prefix}:{n}:{gram}"] = float(count)
    return features


def _top_call_features(text: str, *, top_k: int) -> dict[str, float]:
    counts = Counter()
    for name in _CALL_RE.findall(text):
        if name in JAVA_KEYWORDS or name in _EXPR_KEYWORDS:
            continue
        counts[f"call_name:{name.lower()}"] += 1
    return {key: float(value) for key, value in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:top_k]}


def write_normalization_files(normalizations: dict[str, str], target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    for name, value in normalizations.items():
        (target_dir / f"{name}.json").write_text(
            json.dumps({"name": name, "content": value}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def build_representation_payload(
    run_id: str,
    submission_id: str,
    space: str,
    features: dict[str, float] | dict[str, Any],
    *,
    comparison_dimensions: list[dict[str, float | str]] | None = None,
    standardized_dimensions: list[dict[str, float | str]] | None = None,
    metadata: dict[str, Any] | None = None,
    version: str | None = None,
) -> dict[str, Any]:
    top_dimensions = rank_feature_dimensions(features) if isinstance(features, dict) and all(isinstance(v, (int, float)) for v in features.values()) else (comparison_dimensions or [])
    return {
        "run_id": run_id,
        "submission_id": submission_id,
        "space": space,
        "granularity": "submission",
        "representation_version": version or f"{space}-v4",
        "feature_stats": features,
        "top_dimensions": top_dimensions,
        "comparison_dimensions": comparison_dimensions or [],
        "standardized_dimensions": standardized_dimensions or [],
        "metadata": metadata or {},
        "normalization_profile": {
            "raw": True,
            "whitespace": True,
            "no_comments": True,
            "masked_identifiers": True,
            "masked_literals": True,
            "ast_normalized": True,
        },
    }
