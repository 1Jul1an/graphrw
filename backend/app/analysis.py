from __future__ import annotations

import itertools
import math
from collections import defaultdict

CLUSTER_COLOR_PALETTE = [
    {"fill": "#3b82f6", "border": "#1d4ed8"},
    {"fill": "#10b981", "border": "#047857"},
    {"fill": "#8b5cf6", "border": "#6d28d9"},
    {"fill": "#f59e0b", "border": "#b45309"},
    {"fill": "#ef4444", "border": "#b91c1c"},
    {"fill": "#06b6d4", "border": "#0e7490"},
    {"fill": "#ec4899", "border": "#be185d"},
    {"fill": "#84cc16", "border": "#4d7c0f"},
    {"fill": "#14b8a6", "border": "#0f766e"},
    {"fill": "#f97316", "border": "#c2410c"},
    {"fill": "#6366f1", "border": "#4338ca"},
    {"fill": "#a855f7", "border": "#7e22ce"},
]
from pathlib import Path
from statistics import pstdev
from typing import Any

import numpy as np
from sklearn.cluster import HDBSCAN

from .config import settings
from .features import DISPLAY_SPACE_KEYS, FUSION_SPACE_KEY, PRIMARY_SPACE_KEYS, build_representation_payload, aggregate_submission_features, feature_kind, rank_feature_dimensions
from .utils import atomic_write_json

SPACE_BLEND_WEIGHTS: dict[str, dict[str, float]] = {
    "expr": {"profile": 0.40, "contrast": 0.25, "overlap": 0.20, "size": 0.15},
    "struct": {"profile": 0.40, "contrast": 0.30, "overlap": 0.20, "size": 0.10},
    "sem": {"profile": 0.25, "contrast": 0.20, "overlap": 0.40, "size": 0.15},
}
FUSION_BASE_WEIGHTS = {"expr": 0.30, "struct": 0.40, "sem": 0.30}

ComparisonModels = dict[str, dict[str, dict[str, dict[str, float]]]]


def cosine_similarity(left: dict[str, float], right: dict[str, float]) -> float:
    keys = set(left) | set(right)
    dot = sum(left.get(key, 0.0) * right.get(key, 0.0) for key in keys)
    left_norm = math.sqrt(sum(value * value for value in left.values()))
    right_norm = math.sqrt(sum(value * value for value in right.values()))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return dot / (left_norm * right_norm)


def build_representations(
    run_dir: Path,
    run_id: str,
    submission_results: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, dict[str, float]]], ComparisonModels]:
    raw_features_by_space: dict[str, dict[str, dict[str, float]]] = {space: {} for space in PRIMARY_SPACE_KEYS}
    for result in submission_results:
        aggregated = aggregate_submission_features(result["feature_sets"])
        submission_id = result["submission"]["submission_id"]
        for space in PRIMARY_SPACE_KEYS:
            raw_features_by_space[space][submission_id] = aggregated[space]

    comparison_models = {space: _build_comparison_model(raw_features_by_space[space], space) for space in PRIMARY_SPACE_KEYS}

    for space in PRIMARY_SPACE_KEYS:
        for submission_id, raw_features in raw_features_by_space[space].items():
            payload = build_representation_payload(
                run_id,
                submission_id,
                space,
                raw_features,
                comparison_dimensions=rank_feature_dimensions(comparison_models[space]["weighted"][submission_id]),
                standardized_dimensions=rank_feature_dimensions(comparison_models[space]["standardized"][submission_id]),
            )
            rep_path = run_dir / "representations" / space / "submissions" / f"{submission_id}.json"
            atomic_write_json(rep_path, payload)
    return raw_features_by_space, comparison_models


def build_pair_chunks(
    run_dir: Path,
    run_id: str,
    submission_results: list[dict[str, Any]],
    raw_features_by_space: dict[str, dict[str, dict[str, float]]],
    comparison_models: ComparisonModels,
    chunk_size: int,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any]]:
    submission_ids = [item["submission"]["submission_id"] for item in submission_results]
    pair_items_by_space: dict[str, list[dict[str, Any]]] = {space: [] for space in PRIMARY_SPACE_KEYS}

    for left_id, right_id in itertools.combinations(submission_ids, 2):
        for space in PRIMARY_SPACE_KEYS:
            left_weighted = comparison_models[space]["weighted"][left_id]
            right_weighted = comparison_models[space]["weighted"][right_id]
            left_standardized = comparison_models[space]["standardized"][left_id]
            right_standardized = comparison_models[space]["standardized"][right_id]
            relation, meta = _hybrid_similarity(
                left_weighted=left_weighted,
                right_weighted=right_weighted,
                left_standardized=left_standardized,
                right_standardized=right_standardized,
                space=space,
            )
            pair_items_by_space[space].append(
                {
                    "submission_i": left_id,
                    "submission_j": right_id,
                    "relation_raw": round(relation, 6),
                    "relation_cal": round(relation, 6),
                    "meta": {
                        "method": "hybrid_profile_contrast_overlap_v3",
                        "normalization_profile": "assignment_local_weighted",
                        **meta,
                    },
                }
            )

    for space, items in pair_items_by_space.items():
        _calibrate_pair_scores(items)
        _write_pair_chunks(run_dir, run_id, space, items, chunk_size)

    fusion_meta = build_fusion_space(
        run_dir=run_dir,
        run_id=run_id,
        submission_results=submission_results,
        comparison_models=comparison_models,
        pair_items_by_space=pair_items_by_space,
        chunk_size=chunk_size,
    )
    return pair_items_by_space, fusion_meta


def build_fusion_space(
    *,
    run_dir: Path,
    run_id: str,
    submission_results: list[dict[str, Any]],
    comparison_models: ComparisonModels,
    pair_items_by_space: dict[str, list[dict[str, Any]]],
    chunk_size: int,
) -> dict[str, Any]:
    pair_maps = {
        space: {
            _pair_key(item["submission_i"], item["submission_j"]): item
            for item in pair_items_by_space[space]
        }
        for space in PRIMARY_SPACE_KEYS
    }
    pair_keys = sorted(next(iter(pair_maps.values())).keys()) if pair_maps and pair_maps[PRIMARY_SPACE_KEYS[0]] else []
    raw_vectors = {space: [pair_maps[space][key]["relation_raw"] for key in pair_keys] for space in PRIMARY_SPACE_KEYS}
    cal_vectors = {space: [pair_maps[space][key]["relation_cal"] for key in pair_keys] for space in PRIMARY_SPACE_KEYS}

    correlations: dict[str, dict[str, float]] = {space: {} for space in PRIMARY_SPACE_KEYS}
    uniqueness: dict[str, float] = {}
    sharpness: dict[str, float] = {}

    for left in PRIMARY_SPACE_KEYS:
        for right in PRIMARY_SPACE_KEYS:
            if left == right:
                correlations[left][right] = 1.0
            else:
                correlations[left][right] = round(_pearson(raw_vectors[left], raw_vectors[right]), 6)
        positive_corrs = [max(0.0, correlations[left][other]) for other in PRIMARY_SPACE_KEYS if other != left]
        uniqueness[left] = 1.0 - (sum(positive_corrs) / len(positive_corrs) if positive_corrs else 0.0)
        sharpness[left] = min(1.4, max(0.75, 0.75 + pstdev(raw_vectors[left]) / 0.20 if raw_vectors[left] else 0.75))

    unnormalized_weights = {}
    for space in PRIMARY_SPACE_KEYS:
        unnormalized_weights[space] = FUSION_BASE_WEIGHTS[space] * (0.55 + 0.45 * uniqueness[space]) * sharpness[space]
    space_weights = _normalize_weights(unnormalized_weights)

    fusion_items: list[dict[str, Any]] = []
    for key in pair_keys:
        scores_raw = {space: pair_maps[space][key]["relation_raw"] for space in PRIMARY_SPACE_KEYS}
        scores_cal = {space: pair_maps[space][key]["relation_cal"] for space in PRIMARY_SPACE_KEYS}
        weighted_mean = sum(space_weights[space] * scores_cal[space] for space in PRIMARY_SPACE_KEYS)
        weighted_variance = sum(space_weights[space] * (scores_cal[space] - weighted_mean) ** 2 for space in PRIMARY_SPACE_KEYS)
        conflict = math.sqrt(max(0.0, weighted_variance))
        agreement = max(0.0, 1.0 - conflict)
        independent_support_weights = {
            space: space_weights[space] * max(0.0, uniqueness[space])
            for space in PRIMARY_SPACE_KEYS
            if scores_cal[space] >= 0.65
        }
        independent_support = sum(independent_support_weights.values()) / max(1e-9, sum(space_weights[space] * max(0.0, uniqueness[space]) for space in PRIMARY_SPACE_KEYS))
        fusion_raw = max(0.0, min(1.0, 0.78 * weighted_mean + 0.14 * agreement + 0.08 * independent_support))
        left_id, right_id = key.split("::")
        fusion_items.append(
            {
                "submission_i": left_id,
                "submission_j": right_id,
                "relation_raw": round(fusion_raw, 6),
                "relation_cal": round(fusion_raw, 6),
                "meta": {
                    "method": "heuristic_correlation_discounted_fusion_v1",
                    "components": {
                        "weighted_consensus": round(weighted_mean, 6),
                        "agreement": round(agreement, 6),
                        "independent_support": round(independent_support, 6),
                        "conflict_penalty": round(conflict, 6),
                    },
                    "weights": {space: round(space_weights[space], 6) for space in PRIMARY_SPACE_KEYS},
                    "source_scores": {space: round(scores_cal[space], 6) for space in PRIMARY_SPACE_KEYS},
                    "source_scores_raw": {space: round(scores_raw[space], 6) for space in PRIMARY_SPACE_KEYS},
                    "source_correlations": correlations,
                    "source_uniqueness": {space: round(uniqueness[space], 6) for space in PRIMARY_SPACE_KEYS},
                },
            }
        )

    _calibrate_pair_scores(fusion_items)
    pair_items_by_space[FUSION_SPACE_KEY] = fusion_items
    _write_pair_chunks(run_dir, run_id, FUSION_SPACE_KEY, fusion_items, chunk_size)
    _write_fusion_representations(run_dir, run_id, submission_results, comparison_models, space_weights, uniqueness)
    return {
        "space_weights": {space: round(space_weights[space], 6) for space in PRIMARY_SPACE_KEYS},
        "source_correlations": correlations,
        "source_uniqueness": {space: round(uniqueness[space], 6) for space in PRIMARY_SPACE_KEYS},
    }


def build_neighbors_graphs_and_clusters(
    run_dir: Path,
    run_id: str,
    submission_results: list[dict[str, Any]],
    pair_items_by_space: dict[str, list[dict[str, Any]]],
    k: int,
) -> None:
    submission_lookup = {item["submission"]["submission_id"]: item["submission"]["submission_name"] for item in submission_results}
    for space, pair_items in pair_items_by_space.items():
        values = [item["relation_cal"] for item in pair_items]
        global_floor = max(settings.min_similarity_floor, _percentile(values, settings.neighbor_percentile)) if values else settings.min_similarity_floor
        neighbors = _top_k_neighbors(pair_items, k, global_floor)
        edges = _build_graph_edges(neighbors)
        neighbor_payload = {
            "run_id": run_id,
            "space": space,
            "k": k,
            "similarity_floor": round(global_floor, 6),
            "items": edges,
        }
        atomic_write_json(run_dir / "neighbors" / space / "edges.json", neighbor_payload)

        clusters_payload = _cluster_from_pair_items(
            run_id=run_id,
            space=space,
            submission_lookup=submission_lookup,
            pair_items=pair_items,
            edges=edges,
        )
        atomic_write_json(run_dir / "clusters" / space / "clusters.json", clusters_payload)
        cluster_lookup = _cluster_membership_lookup(clusters_payload)

        graph_payload = {
            "run_id": run_id,
            "space": space,
            "cluster_legend": [
                {
                    "cluster_id": cluster["cluster_id"],
                    "label": f"{cluster['cluster_id'].upper()} · {cluster['size']} Abgaben",
                    "size": cluster["size"],
                    "color": cluster.get("color"),
                    "border_color": cluster.get("border_color"),
                }
                for cluster in clusters_payload.get("clusters", [])
            ],
            "noise_count": len(clusters_payload.get("noise", [])),
            "nodes": [
                {
                    "submission_id": submission_id,
                    "label": label,
                    "cluster_id": cluster_lookup.get(submission_id, {}).get("cluster_id"),
                    "cluster_probability": cluster_lookup.get(submission_id, {}).get("membership_strength"),
                    "cluster_color": cluster_lookup.get(submission_id, {}).get("color"),
                    "cluster_border_color": cluster_lookup.get(submission_id, {}).get("border_color"),
                    "is_noise": cluster_lookup.get(submission_id, {}).get("is_noise", False),
                }
                for submission_id, label in submission_lookup.items()
            ],
            "edges": [
                {
                    "source": edge["submission_src"],
                    "target": edge["submission_dst"],
                    "weight": edge["relation_cal"],
                    "raw_weight": edge["relation_raw"],
                    "edge_type": "mutual_knn" if edge["is_mutual"] else "knn",
                }
                for edge in edges
            ],
            "meta": {
                "k": k,
                "construction": "mutual_knn" if settings.enable_mutual_knn else "knn",
                "similarity_floor": round(global_floor, 6),
                "pair_count": len(pair_items),
                "cluster_method": clusters_payload.get("method"),
                "cluster_meta": clusters_payload.get("meta", {}),
            },
        }
        atomic_write_json(run_dir / "graphs" / space / "graph.json", graph_payload)


def _write_fusion_representations(
    run_dir: Path,
    run_id: str,
    submission_results: list[dict[str, Any]],
    comparison_models: ComparisonModels,
    space_weights: dict[str, float],
    uniqueness: dict[str, float],
) -> None:
    for result in submission_results:
        submission_id = result["submission"]["submission_id"]
        fused_dimensions: dict[str, float] = {}
        source_norms = {}
        for space in PRIMARY_SPACE_KEYS:
            source_vector = comparison_models[space]["weighted"].get(submission_id, {})
            source_norms[space] = round(math.sqrt(sum(value * value for value in source_vector.values())), 6)
            discount = space_weights[space] * (0.55 + 0.45 * uniqueness[space])
            for feature, value in source_vector.items():
                if abs(value) < 1e-9:
                    continue
                fused_dimensions[f"{space}|{feature}"] = fused_dimensions.get(f"{space}|{feature}", 0.0) + discount * value
        representation = {
            "space_weights": {space: round(space_weights[space], 6) for space in PRIMARY_SPACE_KEYS},
            "space_uniqueness": {space: round(uniqueness[space], 6) for space in PRIMARY_SPACE_KEYS},
            "source_norms": source_norms,
            "note": "Heuristische Spätfusion der drei Primärräume mit Korrelationsrabatt.",
        }
        payload = build_representation_payload(
            run_id,
            submission_id,
            FUSION_SPACE_KEY,
            representation,
            comparison_dimensions=rank_feature_dimensions(fused_dimensions, limit=12),
            standardized_dimensions=[],
            metadata={"fusion": True},
            version="fusion-v1",
        )
        atomic_write_json(run_dir / "representations" / FUSION_SPACE_KEY / "submissions" / f"{submission_id}.json", payload)


def _write_pair_chunks(run_dir: Path, run_id: str, space: str, items: list[dict[str, Any]], chunk_size: int) -> None:
    chunks = [items[index : index + chunk_size] for index in range(0, len(items), chunk_size)] or [[]]
    for chunk_index, chunk in enumerate(chunks, start=1):
        payload = {
            "run_id": run_id,
            "space": space,
            "chunk_index": chunk_index,
            "items": chunk,
        }
        atomic_write_json(run_dir / "pairs" / space / "chunks" / f"{chunk_index:06d}.json", payload)


def _build_comparison_model(raw_features_by_submission: dict[str, dict[str, float]], space: str) -> dict[str, dict[str, dict[str, float]]]:
    submission_ids = list(raw_features_by_submission.keys())
    feature_keys = sorted({key for features in raw_features_by_submission.values() for key in features})
    transformed: dict[str, dict[str, float]] = {}

    for submission_id, raw_features in raw_features_by_submission.items():
        transformed[submission_id] = {
            key: _transform_feature_value(space, key, float(raw_features.get(key, 0.0)))
            for key in feature_keys
        }

    weighted = {submission_id: {} for submission_id in submission_ids}
    feature_stats: dict[str, dict[str, float]] = {}
    total_submissions = max(1, len(submission_ids))
    for key in feature_keys:
        values = [transformed[submission_id].get(key, 0.0) for submission_id in submission_ids]
        document_frequency = sum(1 for value in values if abs(value) > 1e-9)
        sparsity = 1.0 - (document_frequency / total_submissions)
        idf = math.log((1.0 + total_submissions) / (1.0 + document_frequency)) + 1.0
        kind = feature_kind(space, key)
        should_apply_idf = kind == "binary" or sparsity >= 0.4 or key.startswith(("ast_node:", "ast_edge:", "ast_path:"))
        weight = idf if should_apply_idf else 1.0
        feature_stats[key] = {
            "document_frequency": float(document_frequency),
            "idf": round(idf, 6),
            "weight": round(weight, 6),
        }
        for submission_id in submission_ids:
            weighted[submission_id][key] = transformed[submission_id].get(key, 0.0) * weight

    standardized = {submission_id: {} for submission_id in submission_ids}
    for key in feature_keys:
        values = [weighted[submission_id].get(key, 0.0) for submission_id in submission_ids]
        average = sum(values) / len(values) if values else 0.0
        variance = sum((value - average) ** 2 for value in values) / len(values) if values else 0.0
        std = math.sqrt(variance)
        for submission_id in submission_ids:
            value = weighted[submission_id].get(key, 0.0)
            standardized[submission_id][key] = 0.0 if std < 1e-9 else (value - average) / std

    return {
        "transformed": transformed,
        "weighted": weighted,
        "standardized": standardized,
        "feature_stats": feature_stats,
    }


def _transform_feature_value(space: str, key: str, value: float) -> float:
    kind = feature_kind(space, key)
    if kind == "binary":
        return 1.0 if value > 0.0 else 0.0
    if kind == "ratio":
        return float(value)
    if space == "struct" and key.startswith(("ast_node:", "ast_edge:", "ast_path:")):
        return math.log1p(max(0.0, value))
    return math.log1p(max(0.0, value))


def _hybrid_similarity(
    *,
    left_weighted: dict[str, float],
    right_weighted: dict[str, float],
    left_standardized: dict[str, float],
    right_standardized: dict[str, float],
    space: str,
) -> tuple[float, dict[str, Any]]:
    weights = SPACE_BLEND_WEIGHTS[space]
    profile = _scaled_cosine(left_weighted, right_weighted)
    contrast = _scaled_cosine(left_standardized, right_standardized, fallback=profile)
    overlap = _weighted_jaccard(left_weighted, right_weighted)
    size = _size_similarity(left_weighted, right_weighted)
    raw = (
        weights["profile"] * profile
        + weights["contrast"] * contrast
        + weights["overlap"] * overlap
        + weights["size"] * size
    )
    return raw, {
        "components": {
            "profile_cosine": round(profile, 6),
            "contrast_cosine": round(contrast, 6),
            "overlap_jaccard": round(overlap, 6),
            "size_similarity": round(size, 6),
        },
        "weights": weights,
    }


def _scaled_cosine(left: dict[str, float], right: dict[str, float], fallback: float = 0.0) -> float:
    if not any(left.values()) and not any(right.values()):
        return fallback
    cosine = cosine_similarity(left, right)
    return (cosine + 1.0) / 2.0


def _weighted_jaccard(left: dict[str, float], right: dict[str, float]) -> float:
    keys = set(left) | set(right)
    numerator = 0.0
    denominator = 0.0
    for key in keys:
        left_value = max(0.0, left.get(key, 0.0))
        right_value = max(0.0, right.get(key, 0.0))
        numerator += min(left_value, right_value)
        denominator += max(left_value, right_value)
    if denominator == 0.0:
        return 0.0
    return numerator / denominator


def _size_similarity(left: dict[str, float], right: dict[str, float]) -> float:
    left_mass = sum(abs(value) for value in left.values())
    right_mass = sum(abs(value) for value in right.values())
    if left_mass == 0.0 and right_mass == 0.0:
        return 1.0
    if left_mass == 0.0 or right_mass == 0.0:
        return 0.0
    return min(left_mass, right_mass) / max(left_mass, right_mass)


def _calibrate_pair_scores(items: list[dict[str, Any]]) -> None:
    values = [item["relation_raw"] for item in items]
    if not values:
        return
    low = _percentile(values, 0.1)
    high = _percentile(values, 0.9)
    if high - low < 1e-9:
        low = min(values)
        high = max(values)
    for item in items:
        raw = float(item["relation_raw"])
        if high - low < 1e-9:
            calibrated = raw
        else:
            calibrated = max(0.0, min(1.0, (raw - low) / (high - low)))
        item["relation_cal"] = round(calibrated, 6)
        item.setdefault("meta", {})["calibration"] = {
            "method": "assignment_quantile_clip",
            "q10": round(low, 6),
            "q90": round(high, 6),
        }


def _percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = max(0.0, min(1.0, quantile)) * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def _top_k_neighbors(pair_items: list[dict[str, Any]], k: int, similarity_floor: float) -> dict[str, list[tuple[str, float, float]]]:
    adjacency: dict[str, list[tuple[str, float, float]]] = defaultdict(list)
    for item in pair_items:
        adjacency[item["submission_i"]].append((item["submission_j"], item["relation_cal"], item["relation_raw"]))
        adjacency[item["submission_j"]].append((item["submission_i"], item["relation_cal"], item["relation_raw"]))

    result: dict[str, list[tuple[str, float, float]]] = {}
    for submission_id, values in adjacency.items():
        ordered = sorted(values, key=lambda pair: (pair[1], pair[2]), reverse=True)
        filtered = [pair for pair in ordered if pair[1] >= similarity_floor][:k]
        if not filtered and ordered:
            filtered = ordered[:1]
        result[submission_id] = filtered
    return result


def _build_graph_edges(neighbors: dict[str, list[tuple[str, float, float]]]) -> list[dict[str, Any]]:
    directed = []
    for src, items in neighbors.items():
        for rank, (dst, relation_cal, relation_raw) in enumerate(items, start=1):
            directed.append(
                {
                    "submission_src": src,
                    "submission_dst": dst,
                    "rank": rank,
                    "relation_raw": relation_raw,
                    "relation_cal": relation_cal,
                }
            )
    edge_lookup = {(edge["submission_src"], edge["submission_dst"]): edge for edge in directed}
    result: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for edge in directed:
        src = edge["submission_src"]
        dst = edge["submission_dst"]
        key = tuple(sorted((src, dst)))
        if settings.enable_mutual_knn and (dst, src) not in edge_lookup:
            continue
        if key in seen:
            continue
        reverse = edge_lookup.get((dst, src))
        seen.add(key)
        result.append(
            {
                "submission_src": src,
                "submission_dst": dst,
                "rank": edge["rank"],
                "relation_raw": round(edge["relation_raw"], 6),
                "relation_cal": round(edge["relation_cal"], 6),
                "is_mutual": reverse is not None,
                "shared_neighbor_count": _shared_neighbor_count(src, dst, neighbors),
            }
        )
    return sorted(result, key=lambda item: item["relation_cal"], reverse=True)


def _shared_neighbor_count(src: str, dst: str, neighbors: dict[str, list[tuple[str, float, float]]]) -> int:
    left = {node for node, _, _ in neighbors.get(src, [])}
    right = {node for node, _, _ in neighbors.get(dst, [])}
    return len(left & right)


def _cluster_from_pair_items(
    run_id: str,
    space: str,
    submission_lookup: dict[str, str],
    pair_items: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> dict[str, Any]:
    submission_ids = list(submission_lookup)
    if not submission_ids:
        return {"run_id": run_id, "space": space, "method": settings.cluster_method, "clusters": [], "noise": [], "meta": {}}

    if len(submission_ids) == 1:
        only_id = submission_ids[0]
        clusters = [
            {
                "cluster_id": "c1",
                "size": 1,
                "members": [{"submission_id": only_id, "membership_strength": 1.0}],
                "summary_metrics": {"internal_density": 1.0, "avg_pair_similarity": 1.0, "mean_membership_strength": 1.0},
                "exemplar_submission_id": only_id,
            }
        ]
        _apply_cluster_colors(clusters)
        return {
            "run_id": run_id,
            "space": space,
            "method": "singleton",
            "clusters": clusters,
            "noise": [],
            "meta": {"submission_count": 1},
        }

    similarity_matrix, distance_matrix = _build_pair_matrices(submission_ids, pair_items)
    labels, probabilities, cluster_meta = _run_hdbscan(distance_matrix, similarity_matrix)

    if labels is None or probabilities is None:
        fallback_payload = _clusters_from_edges(run_id, space, submission_lookup, edges)
        fallback_payload["meta"] = {
            "fallback": True,
            "reason": "hdbscan_unavailable_or_failed",
            "submission_count": len(submission_ids),
        }
        return fallback_payload

    clusters = []
    unique_labels = sorted(label for label in set(int(label) for label in labels.tolist()) if label >= 0)
    for cluster_number, label in enumerate(unique_labels, start=1):
        member_indices = [index for index, value in enumerate(labels.tolist()) if int(value) == label]
        members = [submission_ids[index] for index in member_indices]
        probabilities_for_cluster = [float(probabilities[index]) for index in member_indices]
        exemplar_submission_id = _cluster_exemplar(member_indices, submission_ids, similarity_matrix, probabilities)
        clusters.append(
            {
                "cluster_id": f"c{cluster_number}",
                "size": len(members),
                "members": [
                    {
                        "submission_id": submission_ids[index],
                        "membership_strength": round(float(probabilities[index]), 6),
                    }
                    for index in member_indices
                ],
                "exemplar_submission_id": exemplar_submission_id,
                "summary_metrics": {
                    "internal_density": _component_density(members, edges),
                    "avg_pair_similarity": round(_mean_internal_similarity(member_indices, similarity_matrix), 6),
                    "mean_membership_strength": round(sum(probabilities_for_cluster) / max(1, len(probabilities_for_cluster)), 6),
                    "cluster_span": round(_cluster_span(member_indices, distance_matrix), 6),
                },
            }
        )

    noise = [
        {
            "submission_id": submission_ids[index],
            "submission_name": submission_lookup[submission_ids[index]],
            "outlier_score": round(1.0 - float(probabilities[index]), 6),
        }
        for index, label in enumerate(labels.tolist())
        if int(label) == -1
    ]

    clusters.sort(key=lambda item: (item["size"], item["summary_metrics"]["mean_membership_strength"]), reverse=True)
    _apply_cluster_colors(clusters)
    return {
        "run_id": run_id,
        "space": space,
        "method": settings.cluster_method,
        "clusters": clusters,
        "noise": noise,
        "meta": {
            **cluster_meta,
            "submission_count": len(submission_ids),
            "cluster_count": len(clusters),
            "noise_count": len(noise),
            "distance_basis": "1 - calibrated similarity",
            "distance_note": "Die Distanzen sind heuristisch, nicht streng metrisch. HDBSCAN arbeitet hier auf einer precomputed Distanzmatrix.",
        },
    }


def _run_hdbscan(distance_matrix: np.ndarray, similarity_matrix: np.ndarray) -> tuple[np.ndarray | None, np.ndarray | None, dict[str, Any]]:
    submission_count = int(distance_matrix.shape[0])
    params = _resolve_hdbscan_params(submission_count)
    meta = {
        **params,
        "allow_single_cluster": False,
        "all_noise_initially": False,
        "reran_with_single_cluster": False,
        "similarity_probe": round(_upper_triangle_percentile(similarity_matrix, 0.75), 6),
    }

    try:
        model = HDBSCAN(
            min_cluster_size=params["min_cluster_size"],
            min_samples=params["min_samples"],
            cluster_selection_epsilon=params["cluster_selection_epsilon"],
            cluster_selection_method=params["cluster_selection_method"],
            alpha=params["alpha"],
            metric="precomputed",
            allow_single_cluster=False,
            copy=True,
        )
        labels = model.fit_predict(distance_matrix)
        probabilities = getattr(model, "probabilities_", np.ones(submission_count, dtype=float))
        meta["all_noise_initially"] = bool(np.all(labels == -1))
        if meta["all_noise_initially"] and meta["similarity_probe"] >= settings.hdbscan_single_cluster_similarity:
            single_cluster_model = HDBSCAN(
                min_cluster_size=params["min_cluster_size"],
                min_samples=params["min_samples"],
                cluster_selection_epsilon=params["cluster_selection_epsilon"],
                cluster_selection_method=params["cluster_selection_method"],
                alpha=params["alpha"],
                metric="precomputed",
                allow_single_cluster=True,
                copy=True,
            )
            labels = single_cluster_model.fit_predict(distance_matrix)
            probabilities = getattr(single_cluster_model, "probabilities_", np.ones(submission_count, dtype=float))
            meta["allow_single_cluster"] = True
            meta["reran_with_single_cluster"] = True
        return labels.astype(int), probabilities.astype(float), meta
    except Exception as exc:
        meta["error"] = str(exc)
        return None, None, meta


def _resolve_hdbscan_params(submission_count: int) -> dict[str, Any]:
    dynamic_min_cluster_size = max(2, min(12, int(round(math.sqrt(max(2, submission_count))))))
    min_cluster_size = settings.hdbscan_min_cluster_size if settings.hdbscan_min_cluster_size > 0 else dynamic_min_cluster_size
    min_cluster_size = max(2, min(submission_count, min_cluster_size))

    dynamic_min_samples = max(1, min_cluster_size // 2)
    min_samples = settings.hdbscan_min_samples if settings.hdbscan_min_samples > 0 else dynamic_min_samples
    min_samples = max(1, min(min_samples, submission_count - 1 if submission_count > 1 else 1))
    return {
        "min_cluster_size": min_cluster_size,
        "min_samples": min_samples,
        "cluster_selection_epsilon": settings.hdbscan_cluster_selection_epsilon,
        "cluster_selection_method": settings.hdbscan_cluster_selection_method,
        "alpha": settings.hdbscan_alpha,
    }


def _build_pair_matrices(submission_ids: list[str], pair_items: list[dict[str, Any]]) -> tuple[np.ndarray, np.ndarray]:
    size = len(submission_ids)
    similarity_matrix = np.zeros((size, size), dtype=float)
    distance_matrix = np.ones((size, size), dtype=float)
    np.fill_diagonal(similarity_matrix, 1.0)
    np.fill_diagonal(distance_matrix, 0.0)
    index_lookup = {submission_id: index for index, submission_id in enumerate(submission_ids)}
    for item in pair_items:
        left_index = index_lookup[item["submission_i"]]
        right_index = index_lookup[item["submission_j"]]
        similarity = max(0.0, min(1.0, float(item.get("relation_cal", 0.0))))
        distance = max(0.0, min(1.0, 1.0 - similarity))
        similarity_matrix[left_index, right_index] = similarity_matrix[right_index, left_index] = similarity
        distance_matrix[left_index, right_index] = distance_matrix[right_index, left_index] = distance
    return similarity_matrix, distance_matrix


def _cluster_membership_lookup(clusters_payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for cluster in clusters_payload.get("clusters", []):
        for member in cluster.get("members", []):
            lookup[member["submission_id"]] = {
                "cluster_id": cluster.get("cluster_id"),
                "membership_strength": member.get("membership_strength", 1.0),
                "color": cluster.get("color"),
                "border_color": cluster.get("border_color"),
                "is_noise": False,
            }
    for noise_point in clusters_payload.get("noise", []):
        lookup[noise_point["submission_id"]] = {
            "cluster_id": None,
            "membership_strength": max(0.0, min(1.0, 1.0 - noise_point.get("outlier_score", 1.0))),
            "color": None,
            "border_color": None,
            "is_noise": True,
        }
    return lookup


def _cluster_exemplar(member_indices: list[int], submission_ids: list[str], similarity_matrix: np.ndarray, probabilities: np.ndarray) -> str:
    if len(member_indices) == 1:
        return submission_ids[member_indices[0]]
    best_index = member_indices[0]
    best_score = -1.0
    for member_index in member_indices:
        similarity_score = sum(float(similarity_matrix[member_index, other_index]) for other_index in member_indices if other_index != member_index)
        score = similarity_score * max(0.1, float(probabilities[member_index]))
        if score > best_score:
            best_index = member_index
            best_score = score
    return submission_ids[best_index]


def _mean_internal_similarity(member_indices: list[int], similarity_matrix: np.ndarray) -> float:
    if len(member_indices) <= 1:
        return 1.0
    values = []
    for offset, left_index in enumerate(member_indices):
        for right_index in member_indices[offset + 1 :]:
            values.append(float(similarity_matrix[left_index, right_index]))
    return sum(values) / len(values) if values else 1.0


def _cluster_span(member_indices: list[int], distance_matrix: np.ndarray) -> float:
    if len(member_indices) <= 1:
        return 0.0
    max_distance = 0.0
    for offset, left_index in enumerate(member_indices):
        for right_index in member_indices[offset + 1 :]:
            max_distance = max(max_distance, float(distance_matrix[left_index, right_index]))
    return max_distance


def _upper_triangle_percentile(matrix: np.ndarray, quantile: float) -> float:
    if matrix.shape[0] <= 1:
        return 1.0
    values = [float(matrix[row, col]) for row in range(matrix.shape[0]) for col in range(row + 1, matrix.shape[1])]
    return _percentile(values, quantile) if values else 1.0


def _clusters_from_edges(run_id: str, space: str, submission_lookup: dict[str, str], edges: list[dict[str, Any]]) -> dict[str, Any]:
    adjacency: dict[str, set[str]] = {submission_id: set() for submission_id in submission_lookup}
    for edge in edges:
        adjacency[edge["submission_src"]].add(edge["submission_dst"])
        adjacency[edge["submission_dst"]].add(edge["submission_src"])

    visited: set[str] = set()
    clusters = []
    cluster_number = 0
    for submission_id in submission_lookup:
        if submission_id in visited:
            continue
        cluster_number += 1
        stack = [submission_id]
        members = []
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            members.append(current)
            stack.extend(sorted(adjacency[current] - visited))
        clusters.append(
            {
                "cluster_id": f"c{cluster_number}",
                "size": len(members),
                "members": [{"submission_id": member, "membership_strength": 1.0} for member in sorted(members)],
                "summary_metrics": {
                    "internal_density": _component_density(members, edges),
                },
            }
        )

    _apply_cluster_colors(clusters)
    return {"run_id": run_id, "space": space, "method": "connected_components", "clusters": clusters, "noise": []}


def _cluster_palette_color(cluster_index: int) -> dict[str, str]:
    return CLUSTER_COLOR_PALETTE[cluster_index % len(CLUSTER_COLOR_PALETTE)]


def _apply_cluster_colors(clusters: list[dict[str, Any]]) -> None:
    for cluster_index, cluster in enumerate(clusters):
        palette = _cluster_palette_color(cluster_index)
        cluster["color"] = palette["fill"]
        cluster["border_color"] = palette["border"]


def _component_density(component: list[str], edges: list[dict[str, Any]]) -> float:
    if len(component) <= 1:
        return 1.0
    component_set = set(component)
    internal_edges = sum(
        1
        for edge in edges
        if edge["submission_src"] in component_set and edge["submission_dst"] in component_set
    )
    max_edges = len(component) * (len(component) - 1) / 2
    return round(internal_edges / max_edges, 6)


def _pearson(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)
    numerator = sum((lv - left_mean) * (rv - right_mean) for lv, rv in zip(left, right))
    left_denominator = math.sqrt(sum((lv - left_mean) ** 2 for lv in left))
    right_denominator = math.sqrt(sum((rv - right_mean) ** 2 for rv in right))
    if left_denominator < 1e-9 or right_denominator < 1e-9:
        return 0.0
    return max(-1.0, min(1.0, numerator / (left_denominator * right_denominator)))


def _normalize_weights(weights: dict[str, float]) -> dict[str, float]:
    total = sum(max(0.0, value) for value in weights.values())
    if total <= 0.0:
        return {key: 1.0 / len(weights) for key in weights}
    return {key: max(0.0, value) / total for key, value in weights.items()}


def _pair_key(left: str, right: str) -> str:
    return "::".join(sorted((left, right)))
