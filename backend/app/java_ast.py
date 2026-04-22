from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import math
from collections import Counter
from typing import Any

from .normalization import strip_comments

try:  # pragma: no cover - import path depends on runtime env
    from tree_sitter import Language, Parser
    import tree_sitter_java
except Exception:  # pragma: no cover - optional dependency path
    Language = None  # type: ignore[assignment]
    Parser = None  # type: ignore[assignment]
    tree_sitter_java = None  # type: ignore[assignment]

try:  # pragma: no cover - optional dependency path
    import javalang  # type: ignore
except Exception:  # pragma: no cover - optional dependency path
    javalang = None


_CONTROL_KINDS = {
    "if",
    "for",
    "enhanced_for",
    "while",
    "do",
    "switch",
    "case",
    "try",
    "catch",
    "finally",
    "throw",
    "return",
    "break",
    "continue",
    "lambda",
}
_DECLARATION_KINDS = {"class", "interface", "enum", "record", "annotation_type", "method", "constructor", "field", "parameter", "local_var"}
_STATEMENT_KINDS = _CONTROL_KINDS | {"block", "assert", "local_var", "statement_expr", "yield"}
_EXPRESSION_KINDS = {
    "binary_expr",
    "unary_expr",
    "assign_expr",
    "ternary_expr",
    "call",
    "new",
    "cast_expr",
    "array_access",
    "field_access",
    "literal",
}
_EXACT_STRUCTURAL_TYPES = {
    "program",
    "class_body",
    "formal_parameters",
    "argument_list",
    "annotation",
    "switch_block_statement_group",
    "switch_label",
    "modifiers",
    "type_identifier",
    "scoped_type_identifier",
    "type_arguments",
    "type_parameter",
    "dimensions",
    "block",
}
_COARSE_KIND_MAP = {
    "program": "compilation_unit",
    "class_declaration": "class",
    "interface_declaration": "interface",
    "enum_declaration": "enum",
    "record_declaration": "record",
    "annotation_type_declaration": "annotation_type",
    "method_declaration": "method",
    "constructor_declaration": "constructor",
    "field_declaration": "field",
    "constant_declaration": "field",
    "variable_declarator": "variable",
    "local_variable_declaration": "local_var",
    "formal_parameter": "parameter",
    "spread_parameter": "parameter",
    "catch_formal_parameter": "parameter",
    "receiver_parameter": "parameter",
    "if_statement": "if",
    "for_statement": "for",
    "enhanced_for_statement": "enhanced_for",
    "while_statement": "while",
    "do_statement": "do",
    "switch_expression": "switch",
    "switch_statement": "switch",
    "switch_block_statement_group": "case_group",
    "switch_label": "case",
    "try_statement": "try",
    "catch_clause": "catch",
    "finally_clause": "finally",
    "throw_statement": "throw",
    "return_statement": "return",
    "break_statement": "break",
    "continue_statement": "continue",
    "yield_statement": "yield",
    "assert_statement": "assert",
    "lambda_expression": "lambda",
    "method_invocation": "call",
    "super_method_invocation": "call",
    "object_creation_expression": "new",
    "array_creation_expression": "new",
    "assignment_expression": "assign_expr",
    "binary_expression": "binary_expr",
    "ternary_expression": "ternary_expr",
    "unary_expression": "unary_expr",
    "cast_expression": "cast_expr",
    "instanceof_expression": "binary_expr",
    "array_access": "array_access",
    "field_access": "field_access",
    "annotation": "annotation",
    "block": "block",
    "class_body": "class_body",
    "statement_expression": "statement_expr",
    "decimal_integer_literal": "literal",
    "decimal_floating_point_literal": "literal",
    "hex_integer_literal": "literal",
    "hex_floating_point_literal": "literal",
    "string_literal": "literal",
    "character_literal": "literal",
    "true": "literal",
    "false": "literal",
    "null_literal": "literal",
}


class AstParseError(RuntimeError):
    pass


@dataclass(slots=True)
class AstSummary:
    provider: str
    parse_status: str
    has_errors: bool
    error_count: int
    node_count: int
    named_node_count: int
    max_depth: int
    average_branching: float
    leaf_ratio: float
    max_control_depth: int
    node_counts: dict[str, int]
    exact_node_counts: dict[str, int]
    edge_counts: dict[str, int]
    path_counts: dict[str, int]
    method_arity_histogram: dict[str, int]
    method_statement_histogram: dict[str, int]
    method_arity_mean: float
    method_arity_max: int
    method_statement_mean: float
    method_statement_max: int
    method_control_mean: float
    method_control_max: int
    tree_preview: dict[str, Any]


@dataclass(slots=True)
class _SummaryBuilder:
    provider: str
    parse_status: str
    has_errors: bool
    error_count: int
    node_counts: Counter[str]
    exact_node_counts: Counter[str]
    edge_counts: Counter[str]
    path_counts: Counter[str]
    branching_values: list[int]
    leaf_count: int
    named_node_count: int
    max_depth: int
    max_control_depth: int
    method_arity_values: list[int]
    method_statement_values: list[int]
    method_control_values: list[int]
    tree_preview: dict[str, Any]

    def to_summary(self) -> AstSummary:
        named_total = max(1, self.named_node_count)
        average_branching = sum(self.branching_values) / len(self.branching_values) if self.branching_values else 0.0
        leaf_ratio = self.leaf_count / named_total
        return AstSummary(
            provider=self.provider,
            parse_status=self.parse_status,
            has_errors=self.has_errors,
            error_count=self.error_count,
            node_count=self.named_node_count,
            named_node_count=self.named_node_count,
            max_depth=self.max_depth,
            average_branching=average_branching,
            leaf_ratio=leaf_ratio,
            max_control_depth=self.max_control_depth,
            node_counts=dict(self.node_counts),
            exact_node_counts=dict(self.exact_node_counts),
            edge_counts=dict(self.edge_counts),
            path_counts=dict(self.path_counts),
            method_arity_histogram=dict(Counter(_arity_bucket(value) for value in self.method_arity_values)),
            method_statement_histogram=dict(Counter(_statement_bucket(value) for value in self.method_statement_values)),
            method_arity_mean=(sum(self.method_arity_values) / len(self.method_arity_values) if self.method_arity_values else 0.0),
            method_arity_max=max(self.method_arity_values) if self.method_arity_values else 0,
            method_statement_mean=(sum(self.method_statement_values) / len(self.method_statement_values) if self.method_statement_values else 0.0),
            method_statement_max=max(self.method_statement_values) if self.method_statement_values else 0,
            method_control_mean=(sum(self.method_control_values) / len(self.method_control_values) if self.method_control_values else 0.0),
            method_control_max=max(self.method_control_values) if self.method_control_values else 0,
            tree_preview=self.tree_preview,
        )


def analyze_java_ast(source: str) -> AstSummary:
    no_comments, _, _ = strip_comments(source)
    if tree_sitter_java is not None and Language is not None and Parser is not None:
        return _analyze_with_tree_sitter(no_comments)
    if javalang is not None:
        return _analyze_with_javalang(no_comments)
    raise AstParseError(
        "Kein echter Java-AST-Parser verfügbar. Installiere 'tree-sitter' + 'tree-sitter-java' oder 'javalang'."
    )


def ast_summary_to_struct_features(summary: AstSummary) -> dict[str, float]:
    total_nodes = max(1, summary.named_node_count)
    total_edges = max(1, sum(summary.edge_counts.values()))
    total_paths = max(1, sum(summary.path_counts.values()))
    method_count = max(1, summary.node_counts.get("method", 0) + summary.node_counts.get("constructor", 0))
    control_mass = 0
    decl_mass = 0
    stmt_mass = 0
    expr_mass = 0

    features: dict[str, float] = {
        "ast_node_count": float(summary.named_node_count),
        "ast_max_depth": float(summary.max_depth),
        "ast_avg_branching": float(summary.average_branching),
        "ast_leaf_ratio": float(summary.leaf_ratio),
        "ast_unique_node_types": float(len(summary.node_counts)),
        "ast_unique_exact_node_types": float(len(summary.exact_node_counts)),
        "ast_profile_entropy": _entropy(summary.node_counts.values()),
        "ast_error_ratio": float(summary.error_count) / total_nodes,
        "ast_max_control_depth": float(summary.max_control_depth),
        "ast_method_arity_mean": float(summary.method_arity_mean),
        "ast_method_arity_max": float(summary.method_arity_max),
        "ast_method_statement_mean": float(summary.method_statement_mean),
        "ast_method_statement_max": float(summary.method_statement_max),
        "ast_method_control_mean": float(summary.method_control_mean),
        "ast_method_control_max": float(summary.method_control_max),
        "ast_control_per_method": float(summary.node_counts.get("if", 0) + summary.node_counts.get("for", 0) + summary.node_counts.get("while", 0) + summary.node_counts.get("switch", 0)) / method_count,
        "ast_path_entropy": _entropy(summary.path_counts.values()),
        "ast_edge_entropy": _entropy(summary.edge_counts.values()),
    }

    for kind, count in summary.node_counts.items():
        features[f"ast_node:{kind}"] = float(count)
        features[f"ast_node_ratio:{kind}"] = float(count) / total_nodes
        if kind in _CONTROL_KINDS:
            control_mass += count
        if kind in _DECLARATION_KINDS:
            decl_mass += count
        if kind in _STATEMENT_KINDS:
            stmt_mass += count
        if kind in _EXPRESSION_KINDS:
            expr_mass += count

    for exact_type, count in summary.exact_node_counts.items():
        features[f"ast_type:{exact_type}"] = float(count)
        features[f"ast_type_ratio:{exact_type}"] = float(count) / total_nodes
    for edge, count in summary.edge_counts.items():
        features[f"ast_edge:{edge}"] = float(count)
        features[f"ast_edge_ratio:{edge}"] = float(count) / total_edges
    for path, count in summary.path_counts.items():
        features[f"ast_path:{path}"] = float(count)
        features[f"ast_path_ratio:{path}"] = float(count) / total_paths
    for bucket, count in summary.method_arity_histogram.items():
        features[f"ast_method_arity:{bucket}"] = float(count)
    for bucket, count in summary.method_statement_histogram.items():
        features[f"ast_method_statement:{bucket}"] = float(count)

    features["ast_control_ratio"] = control_mass / total_nodes
    features["ast_decl_ratio"] = decl_mass / total_nodes
    features["ast_stmt_ratio"] = stmt_mass / total_nodes
    features["ast_expr_ratio"] = expr_mass / total_nodes
    features["ast_stmt_per_method"] = stmt_mass / method_count
    return features


def ast_summary_to_payload(summary: AstSummary, *, top_limit: int = 12) -> dict[str, Any]:
    top_nodes = sorted(summary.node_counts.items(), key=lambda item: (-item[1], item[0]))[:top_limit]
    top_exact = sorted(summary.exact_node_counts.items(), key=lambda item: (-item[1], item[0]))[:top_limit]
    top_paths = sorted(summary.path_counts.items(), key=lambda item: (-item[1], item[0]))[:top_limit]
    top_edges = sorted(summary.edge_counts.items(), key=lambda item: (-item[1], item[0]))[:top_limit]
    return {
        "provider": summary.provider,
        "parse_status": summary.parse_status,
        "has_errors": summary.has_errors,
        "error_count": summary.error_count,
        "node_count": summary.node_count,
        "named_node_count": summary.named_node_count,
        "max_depth": summary.max_depth,
        "max_control_depth": summary.max_control_depth,
        "average_branching": round(summary.average_branching, 6),
        "leaf_ratio": round(summary.leaf_ratio, 6),
        "method_arity_mean": round(summary.method_arity_mean, 6),
        "method_arity_max": summary.method_arity_max,
        "method_statement_mean": round(summary.method_statement_mean, 6),
        "method_statement_max": summary.method_statement_max,
        "method_control_mean": round(summary.method_control_mean, 6),
        "method_control_max": summary.method_control_max,
        "method_arity_histogram": summary.method_arity_histogram,
        "method_statement_histogram": summary.method_statement_histogram,
        "top_node_types": [{"kind": key, "count": value} for key, value in top_nodes],
        "top_exact_node_types": [{"kind": key, "count": value} for key, value in top_exact],
        "top_edges": [{"edge": key, "count": value} for key, value in top_edges],
        "top_paths": [{"path": key, "count": value} for key, value in top_paths],
        "tree_preview": summary.tree_preview,
    }


@lru_cache(maxsize=1)
def _tree_sitter_parser() -> Parser:
    if tree_sitter_java is None or Language is None or Parser is None:  # pragma: no cover - guarded by caller
        raise AstParseError("tree-sitter-java ist nicht installiert.")
    language = Language(tree_sitter_java.language())
    return Parser(language)


def _analyze_with_tree_sitter(source: str) -> AstSummary:
    parser = _tree_sitter_parser()
    source_bytes = source.encode("utf-8")
    tree = parser.parse(source_bytes)
    root = tree.root_node

    builder = _SummaryBuilder(
        provider="tree_sitter_java",
        parse_status="recovered" if root.has_error else "ok",
        has_errors=root.has_error,
        error_count=0,
        node_counts=Counter(),
        exact_node_counts=Counter(),
        edge_counts=Counter(),
        path_counts=Counter(),
        branching_values=[],
        leaf_count=0,
        named_node_count=0,
        max_depth=0,
        max_control_depth=0,
        method_arity_values=[],
        method_statement_values=[],
        method_control_values=[],
        tree_preview=_tree_sitter_preview(root, source_bytes),
    )

    def visit(node: Any, depth: int, path: list[str], control_depth: int) -> None:
        if not node.is_named:
            return

        exact_type = node.type
        kind = _coarse_kind(exact_type)
        named_children = [child for child in node.named_children if child.is_named]
        builder.named_node_count += 1
        builder.max_depth = max(builder.max_depth, depth)
        builder.branching_values.append(len(named_children))
        builder.node_counts[kind] += 1
        exact_key = _exact_structural_type(exact_type)
        if exact_key:
            builder.exact_node_counts[exact_key] += 1
        if exact_type == "ERROR":
            builder.error_count += 1
        if not named_children:
            builder.leaf_count += 1
            _record_paths(builder.path_counts, path + [kind])

        current_control_depth = control_depth + (1 if kind in _CONTROL_KINDS else 0)
        builder.max_control_depth = max(builder.max_control_depth, current_control_depth)

        if exact_type in {"method_declaration", "constructor_declaration"}:
            _record_tree_sitter_method_metrics(builder, node)

        for child in named_children:
            child_kind = _coarse_kind(child.type)
            builder.edge_counts[f"{kind}->{child_kind}"] += 1
            visit(child, depth + 1, path + [kind], current_control_depth)

    visit(root, depth=1, path=[], control_depth=0)
    return builder.to_summary()


def _record_tree_sitter_method_metrics(builder: _SummaryBuilder, node: Any) -> None:
    parameters = node.child_by_field_name("parameters")
    arity = 0
    if parameters is not None:
        arity = sum(1 for child in parameters.named_children if child.type in {"formal_parameter", "spread_parameter", "receiver_parameter"})
    builder.method_arity_values.append(arity)

    body = node.child_by_field_name("body")
    if body is None:
        builder.method_statement_values.append(0)
        builder.method_control_values.append(0)
        return

    statement_total = 0
    control_total = 0
    stack = list(body.named_children)
    while stack:
        current = stack.pop()
        if not current.is_named:
            continue
        current_kind = _coarse_kind(current.type)
        if _is_statement_like(current.type):
            statement_total += 1
        if current_kind in _CONTROL_KINDS:
            control_total += 1
        stack.extend(current.named_children)
    builder.method_statement_values.append(statement_total)
    builder.method_control_values.append(control_total)


def _tree_sitter_preview(root: Any, source_bytes: bytes) -> dict[str, Any]:
    top_level = []
    for child in root.named_children[:8]:
        name_node = child.child_by_field_name("name")
        name = _node_text(name_node, source_bytes) if name_node is not None else None
        top_level.append({"type": child.type, "name": name})
    return {
        "root_type": root.type,
        "top_level": top_level,
    }


def _node_text(node: Any | None, source_bytes: bytes) -> str | None:
    if node is None:
        return None
    return source_bytes[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _is_statement_like(exact_type: str) -> bool:
    return exact_type.endswith("_statement") or exact_type in {
        "local_variable_declaration",
        "statement_expression",
        "catch_clause",
        "finally_clause",
        "switch_block_statement_group",
    }


def _exact_structural_type(exact_type: str) -> str | None:
    if exact_type == "ERROR":
        return "ERROR"
    if exact_type in _EXACT_STRUCTURAL_TYPES:
        return exact_type
    if exact_type.endswith(("_declaration", "_statement", "_expression", "_clause", "_type", "_parameters")):
        return exact_type
    return None


def _coarse_kind(exact_type: str) -> str:
    if exact_type in _COARSE_KIND_MAP:
        return _COARSE_KIND_MAP[exact_type]
    if exact_type.endswith("_declaration"):
        return exact_type[: -len("_declaration")]
    if exact_type.endswith("_statement"):
        return exact_type[: -len("_statement")]
    if exact_type.endswith("_expression"):
        return f"{exact_type[: -len('_expression')]}_expr"
    if exact_type.endswith("_clause"):
        return exact_type[: -len("_clause")]
    return exact_type.replace("__", "_")


def _record_paths(counter: Counter[str], full_path: list[str], max_len: int = 5) -> None:
    if not full_path:
        return
    if len(full_path) <= max_len:
        counter[">".join(full_path)] += 1
        return
    counter[">".join(full_path[:max_len])] += 1
    counter[">".join(full_path[-max_len:])] += 1


def _arity_bucket(value: int) -> str:
    if value == 0:
        return "0"
    if value == 1:
        return "1"
    if value <= 3:
        return "2_3"
    return "4_plus"


def _statement_bucket(value: int) -> str:
    if value <= 2:
        return "0_2"
    if value <= 5:
        return "3_5"
    if value <= 10:
        return "6_10"
    return "11_plus"


def _entropy(values: Any) -> float:
    values = [int(value) for value in values if value]
    total = sum(values)
    if total == 0:
        return 0.0
    entropy = 0.0
    for count in values:
        probability = count / total
        entropy -= probability * math.log2(probability)
    return entropy


def _analyze_with_javalang(source: str) -> AstSummary:  # pragma: no cover - fallback path
    if javalang is None:
        raise AstParseError("javalang ist nicht installiert.")
    try:
        tree = javalang.parse.parse(source)
    except Exception as exc:  # pragma: no cover - fallback path
        raise AstParseError(f"Java-Parsing fehlgeschlagen: {exc}") from exc

    builder = _SummaryBuilder(
        provider="javalang",
        parse_status="ok",
        has_errors=False,
        error_count=0,
        node_counts=Counter(),
        exact_node_counts=Counter(),
        edge_counts=Counter(),
        path_counts=Counter(),
        branching_values=[],
        leaf_count=0,
        named_node_count=0,
        max_depth=0,
        max_control_depth=0,
        method_arity_values=[],
        method_statement_values=[],
        method_control_values=[],
        tree_preview={"root_type": tree.__class__.__name__, "top_level": []},
    )

    def iter_children(node: Any) -> list[Any]:
        children: list[Any] = []
        if node is None:
            return children
        if isinstance(node, list):
            for item in node:
                children.extend(iter_children(item))
            return children
        if isinstance(node, (str, int, float, bool)):
            return children
        if hasattr(node, "children"):
            for child in node.children:
                children.extend(iter_children(child))
        else:
            children.append(node)
        return children

    def visit(node: Any, depth: int, path: list[str], control_depth: int) -> None:
        if node is None or isinstance(node, (str, int, float, bool)):
            return
        kind = _coarse_kind(node.__class__.__name__.lower())
        exact_type = node.__class__.__name__
        children = [child for child in iter_children(node) if not isinstance(child, (str, int, float, bool))]
        builder.named_node_count += 1
        builder.max_depth = max(builder.max_depth, depth)
        builder.branching_values.append(len(children))
        builder.node_counts[kind] += 1
        builder.exact_node_counts[exact_type] += 1
        if not children:
            builder.leaf_count += 1
            _record_paths(builder.path_counts, path + [kind])
        current_control_depth = control_depth + (1 if kind in _CONTROL_KINDS else 0)
        builder.max_control_depth = max(builder.max_control_depth, current_control_depth)

        if exact_type in {"MethodDeclaration", "ConstructorDeclaration"}:
            parameters = getattr(node, "parameters", None) or []
            builder.method_arity_values.append(len(parameters))

        for child in children:
            child_kind = _coarse_kind(child.__class__.__name__.lower())
            builder.edge_counts[f"{kind}->{child_kind}"] += 1
            visit(child, depth + 1, path + [kind], current_control_depth)

    visit(tree, 1, [], 0)
    return builder.to_summary()
