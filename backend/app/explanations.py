from __future__ import annotations

from collections import Counter
from typing import Any

FEATURE_FAMILY_LABELS = {
    "surface": "Oberfläche",
    "calls": "Aufrufmuster",
    "control": "Kontrollfluss",
    "ast": "AST-Form",
    "size": "Größe/Volumen",
    "style": "Stil/Format",
    "semantics": "inhaltliches Signal",
    "parsing": "Parser-/AST-Status",
    "other": "sonstiges Signal",
}

SPACE_EQUALITY_DIMENSIONS = {
    "expr": [
        ("surface", "Oberfläche"),
        ("calls", "Aufrufmuster"),
        ("style", "Stil/Format"),
        ("size", "Größe"),
    ],
    "struct": [
        ("control", "Kontrollfluss"),
        ("ast", "AST-Form"),
        ("style", "Methoden-/Blockprofil"),
        ("size", "Größe"),
    ],
    "sem": [
        ("semantics", "Strategie-/API-Signal"),
        ("calls", "Aufrufmuster"),
        ("surface", "Oberflächenreste"),
    ],
    "fusion": [
        ("surface", "Oberfläche"),
        ("control", "Struktur"),
        ("semantics", "Inhalt/Strategie"),
    ],
}


def feature_family(feature: str) -> str:
    if feature.startswith(("expr_ngram:", "keyword:", "operator:", "keyword_operator_pair:")):
        return "surface"
    if feature.startswith("line_skeleton:"):
        return "style"
    if feature.startswith("call_name:"):
        return "calls"
    if feature.startswith(("identifier_shape:", "token_category:", "line_bucket:")):
        return "style"
    if feature in {"token_count", "identifier_count", "import_stmt_count", "file_count", "ast_node_count", "ast_max_depth", "ast_unique_node_types", "ast_unique_exact_node_types", "import_count_total"}:
        return "size"
    if feature.startswith(("ast_node_ratio:", "ast_type_ratio:", "ast_edge_ratio:", "ast_path_ratio:")):
        if any(token in feature for token in (":if", ":for", ":while", ":switch", ":try", ":catch")):
            return "control"
        return "ast"
    if feature.startswith(("ast_node:", "ast_type:", "ast_edge:", "ast_path:")):
        if any(token in feature for token in (":if", ":for", ":while", ":switch", ":try", ":catch")):
            return "control"
        return "ast"
    if feature.startswith(("ast_method_arity:", "ast_method_statement:")) or feature.startswith("ast_"):
        return "style"
    if feature.startswith(("call_family:", "type_family:", "import_family:")) or feature in {"collection_usage", "stream_usage", "io_usage", "try_count", "catch_count", "throw_count", "semantic_signal_density"}:
        return "semantics"
    if feature.startswith(("ast_provider:", "ast_parse_status:")):
        return "parsing"
    return "other"


def humanize_feature(feature: str) -> str:
    if feature.startswith("expr_ngram:"):
        _, n, gram = feature.split(":", 2)
        return f"maskiertes Token-{n}-Gramm '{gram}'"
    if feature.startswith("line_skeleton:"):
        value = feature.split(":", 1)[1]
        return f"maskierte Zeilenform '{value}'"
    if feature.startswith("keyword_operator_pair:"):
        value = feature.split(":", 1)[1]
        return f"Keyword/Operator-Folge {value}"
    if feature.startswith("call_name:"):
        return f"Aufrufname {feature.split(':', 1)[1]}"
    if feature.startswith("keyword:"):
        return f"Keyword {feature.split(':', 1)[1]}"
    if feature.startswith("operator:"):
        value = feature.split(":", 1)[1]
        labels = {
            "assignment": "Zuweisungsoperatoren",
            "comparison": "Vergleichsoperatoren",
            "logic": "logische Operatoren",
            "arithmetic": "arithmetische Operatoren",
            "bitwise": "bitweise Operatoren",
        }
        return labels.get(value, value)
    if feature.startswith("identifier_shape:"):
        return f"Identifier-Form {feature.split(':', 1)[1].replace('_', ' ')}"
    if feature.startswith("token_category:"):
        return f"Token-Mix {feature.split(':', 1)[1].replace('_', ' ')}"
    if feature.startswith("line_bucket:"):
        return f"Zeilenlänge {feature.split(':', 1)[1].replace('_ratio', '')}"
    if feature.startswith("ast_node_ratio:"):
        return f"AST-Knoten-Anteil {feature.split(':', 1)[1]}"
    if feature.startswith("ast_type_ratio:"):
        return f"AST-Exact-Type-Anteil {feature.split(':', 1)[1]}"
    if feature.startswith("ast_edge_ratio:"):
        return f"AST-Kanten-Anteil {feature.split(':', 1)[1]}"
    if feature.startswith("ast_path_ratio:"):
        return f"AST-Pfad-Anteil {feature.split(':', 1)[1]}"
    if feature.startswith("ast_node:"):
        return f"AST-Knoten {feature.split(':', 1)[1]}"
    if feature.startswith("ast_type:"):
        return f"AST-Exact-Type {feature.split(':', 1)[1]}"
    if feature.startswith("ast_edge:"):
        return f"AST-Kante {feature.split(':', 1)[1]}"
    if feature.startswith("ast_path:"):
        return f"AST-Pfad {feature.split(':', 1)[1]}"
    if feature.startswith("ast_method_arity:"):
        return f"Methoden-Arity-Bucket {feature.split(':', 1)[1]}"
    if feature.startswith("ast_method_statement:"):
        return f"Methoden-Statement-Bucket {feature.split(':', 1)[1]}"
    if feature.startswith("call_family:"):
        return f"Call-Familie {feature.split(':', 1)[1]}"
    if feature.startswith("type_family:"):
        return f"Typ-/API-Familie {feature.split(':', 1)[1]}"
    if feature.startswith("import_family:"):
        return f"Import-Familie {feature.split(':', 1)[1]}"
    if feature.startswith("ast_provider:"):
        return f"AST-Provider {feature.split(':', 1)[1]}"
    if feature.startswith("ast_parse_status:"):
        return f"AST-Parse-Status {feature.split(':', 1)[1]}"
    return feature.replace("_", " ")


def explain_pair(*, space: str, pair_detail: dict[str, Any]) -> dict[str, Any]:
    common = pair_detail.get("top_common_signals", []) or []
    differing = pair_detail.get("top_differing_signals", []) or []
    components = pair_detail.get("score_components", {}) or {}
    score = float(pair_detail.get("relation_cal", 0.0))

    family_strength = Counter()
    family_evidence: dict[str, list[str]] = {}
    for item in common[:8]:
        family = feature_family(item.get("feature", ""))
        family_strength[family] += float(item.get("contribution", 0.0))
        family_evidence.setdefault(family, []).append(humanize_feature(item.get("feature", "")))

    dominant = family_strength.most_common(2)
    dominant_labels = [FEATURE_FAMILY_LABELS.get(family, family) for family, _ in dominant if _ > 0]

    agreement_rows = []
    for family, label in SPACE_EQUALITY_DIMENSIONS.get(space, []):
        strength = family_strength.get(family, 0.0)
        if score >= 0.82 and strength > 0.0:
            verdict = "hoch"
        elif score >= 0.6 and strength > 0.0:
            verdict = "mittel"
        elif strength > 0.0:
            verdict = "schwach"
        else:
            verdict = "kaum sichtbar"
        evidence = family_evidence.get(family, [])[:3]
        agreement_rows.append({
            "dimension": family,
            "label": label,
            "strength": round(strength, 6),
            "verdict": verdict,
            "evidence": evidence,
        })

    top_shared = [
        {
            "feature": item.get("feature"),
            "label": humanize_feature(item.get("feature", "")),
            "family": feature_family(item.get("feature", "")),
            "contribution": round(float(item.get("contribution", 0.0)), 6),
        }
        for item in common[:5]
    ]
    top_different = [
        {
            "feature": item.get("feature"),
            "label": humanize_feature(item.get("feature", "")),
            "family": feature_family(item.get("feature", "")),
            "gap": round(float(item.get("absolute_gap", 0.0)), 6),
        }
        for item in differing[:5]
    ]

    relation_label = "stark" if score >= 0.82 else "mittel" if score >= 0.6 else "locker" if score >= 0.4 else "schwach"
    basis = ", ".join(dominant_labels) if dominant_labels else "wenige klare Signale"
    summary = f"Diese Paarung ist {relation_label} und wird vor allem durch {basis} getragen."
    if components:
        strongest_component = max(components.items(), key=lambda item: float(item[1]))[0]
        summary += f" Dominanter Score-Baustein: {strongest_component}."

    return {
        "summary": summary,
        "dominant_families": dominant_labels,
        "agreement_profile": agreement_rows,
        "top_shared_patterns": top_shared,
        "top_separating_patterns": top_different,
    }


def explain_cluster(*, space: str, cluster: dict[str, Any]) -> dict[str, Any]:
    diagnostics = cluster.get("diagnostics", {}) or {}
    signature_features = diagnostics.get("signature_features", []) or []
    contrast_features = diagnostics.get("contrast_features", []) or []
    central_members = diagnostics.get("central_members", []) or []
    internal_pairs = diagnostics.get("strongest_internal_pairs", []) or []
    external_pairs = diagnostics.get("nearest_external_pairs", []) or []
    summary_metrics = cluster.get("summary_metrics", {}) or {}

    family_counter = Counter(feature_family(item.get("feature", "")) for item in signature_features[:8])
    dominant_families = [FEATURE_FAMILY_LABELS.get(family, family) for family, _ in family_counter.most_common(3)]

    cohesion_basis = []
    for item in signature_features[:5]:
        cohesion_basis.append({
            "feature": item.get("feature"),
            "label": humanize_feature(item.get("feature", "")),
            "family": feature_family(item.get("feature", "")),
            "lift": round(float(item.get("lift", 0.0)), 6),
        })

    boundary_basis = []
    for item in contrast_features[:4]:
        boundary_basis.append({
            "feature": item.get("feature"),
            "label": humanize_feature(item.get("feature", "")),
            "family": feature_family(item.get("feature", "")),
            "lift": round(float(item.get("lift", 0.0)), 6),
        })

    member_names = [item.get("submission_name") for item in central_members[:3] if item.get("submission_name")]
    density = float(summary_metrics.get("internal_density", 0.0))
    avg_similarity = float(summary_metrics.get("avg_pair_similarity", 0.0))
    span = float(summary_metrics.get("cluster_span", 0.0))
    cohesion_label = "eng" if density >= 0.66 and avg_similarity >= 0.72 else "mittel" if density >= 0.4 else "locker"
    summary = f"Das Cluster ist {cohesion_label} und hält vor allem über {', '.join(dominant_families) if dominant_families else 'gemischte Signale'} zusammen."
    if member_names:
        summary += f" Typische Vertreter sind {', '.join(member_names)}."
    if span >= 0.45:
        summary += " Es gibt aber spürbare interne Varianz, also eher eine Lösungsfamilie als einen Near-Duplicate-Block."

    internal_story = [
        f"{pair.get('source_name')} ↔ {pair.get('target_name')} ({float(pair.get('weight', 0.0)):.3f})"
        for pair in internal_pairs[:3]
    ]
    boundary_story = [
        f"{pair.get('source_name')} ↔ {pair.get('target_name')} ({float(pair.get('weight', 0.0)):.3f})"
        for pair in external_pairs[:3]
    ]

    return {
        "summary": summary,
        "dominant_families": dominant_families,
        "cohesion_basis": cohesion_basis,
        "boundary_basis": boundary_basis,
        "core_members": member_names,
        "internal_story": internal_story,
        "boundary_story": boundary_story,
    }


def explain_submission_space(*, space: str, submission_id: str, submission_name: str, top_neighbors: list[dict[str, Any]], cluster_membership: dict[str, Any] | None, cluster_diagnostics: dict[str, Any] | None) -> dict[str, Any]:
    if not cluster_membership:
        return {
            "summary": f"Für {submission_name} liegt in diesem Raum noch keine belastbare Einordnung vor.",
            "neighbor_story": [],
            "why_here": [],
            "why_not_else": [],
        }

    if cluster_membership.get("is_noise"):
        neighbor_story = [
            f"{edge.get('source') if edge.get('target') == submission_name else edge.get('target')} ({float(edge.get('weight', 0.0)):.3f})"
            for edge in top_neighbors[:3]
        ]
        return {
            "summary": f"{submission_name} ist hier aktuell Noise. Es gibt lokale Ähnlichkeiten, aber keine dichte oder stabile Einbettung in einen Cluster.",
            "neighbor_story": neighbor_story,
            "why_here": [],
            "why_not_else": ["zu wenig starker Mehrfach-Support zu anderen Lösungen", "Ähnlichkeit verteilt sich eher punktuell als als dichter Block"],
        }

    signature = (cluster_diagnostics or {}).get("signature_features", []) if cluster_diagnostics else []
    why_here = [humanize_feature(item.get("feature", "")) for item in signature[:4]]
    neighbor_story = []
    for edge in top_neighbors[:4]:
        other = edge.get("target") if edge.get("source") == submission_name else edge.get("source")
        neighbor_story.append(f"{other} ({float(edge.get('weight', 0.0)):.3f}, {edge.get('edge_type', '-')})")
    size = cluster_membership.get("size", 0)
    summary = f"{submission_name} liegt in {cluster_membership.get('cluster_label', 'einem Cluster')} mit {size} Mitgliedern. Die Zuordnung wird vor allem durch die typischen Cluster-Signaturen und die stärksten Nachbarverbindungen getragen."
    return {
        "summary": summary,
        "neighbor_story": neighbor_story,
        "why_here": why_here,
        "why_not_else": [humanize_feature(item.get("feature", "")) for item in ((cluster_diagnostics or {}).get("contrast_features", []) or [])[:3]],
    }
