from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from .features import DISPLAY_SPACE_KEYS, FUSION_SPACE_KEY, PRIMARY_SPACE_KEYS, rank_feature_dimensions
from .utils import atomic_write_json, read_json


def materialize_read_models(
    run_dir: Path,
    assignment_id: str,
    run_id: str,
    submission_results: list[dict[str, Any]],
    raw_features_by_space: dict[str, dict[str, dict[str, float]]],
    comparison_models: dict[str, dict[str, dict[str, dict[str, float]]]],
    pair_items_by_space: dict[str, list[dict[str, Any]]],
    fusion_meta: dict[str, Any],
) -> None:
    read_models_dir = run_dir / "read-models"
    graphs = {space: read_json(run_dir / "graphs" / space / "graph.json", default={}) for space in DISPLAY_SPACE_KEYS}
    clusters = {space: read_json(run_dir / "clusters" / space / "clusters.json", default={}) for space in DISPLAY_SPACE_KEYS}
    submission_lookup = {
        result["submission"]["submission_id"]: result["submission"]["submission_name"]
        for result in submission_results
    }
    graph_edge_lookup = {
        space: {
            _pair_key(edge["source"], edge["target"]): edge
            for edge in graphs[space].get("edges", [])
        }
        for space in DISPLAY_SPACE_KEYS
    }

    submissions_index = []
    for result in submission_results:
        submission = result["submission"]
        submission_id = submission["submission_id"]
        detail = {
            "assignment_id": assignment_id,
            "run_id": run_id,
            "submission": submission,
            "included_files": result.get("file_feature_details", []),
            "spaces": {},
        }
        for space in DISPLAY_SPACE_KEYS:
            representation = read_json(run_dir / "representations" / space / "submissions" / f"{submission_id}.json", default={})
            top_neighbors = [
                edge
                for edge in graphs[space].get("edges", [])
                if edge.get("source") == submission_id or edge.get("target") == submission_id
            ]
            top_neighbors = sorted(top_neighbors, key=lambda edge: edge.get("weight", 0.0), reverse=True)[:5]
            cluster_membership = None
            for cluster in clusters.get(space, {}).get("clusters", []):
                for member in cluster.get("members", []):
                    if member["submission_id"] == submission_id:
                        cluster_membership = {
                            "cluster_id": cluster["cluster_id"],
                            "size": cluster["size"],
                            "membership_strength": member.get("membership_strength", 1.0),
                            "method": clusters.get(space, {}).get("method"),
                        }
                        break
                if cluster_membership:
                    break
            if cluster_membership is None and any(item.get("submission_id") == submission_id for item in clusters.get(space, {}).get("noise", [])):
                cluster_membership = {
                    "cluster_id": None,
                    "size": 1,
                    "membership_strength": 0.0,
                    "method": clusters.get(space, {}).get("method"),
                    "is_noise": True,
                }
            detail["spaces"][space] = {
                "representation": representation.get("feature_stats", {}),
                "top_dimensions": representation.get("top_dimensions", []),
                "comparison_dimensions": representation.get("comparison_dimensions", []),
                "standardized_dimensions": representation.get("standardized_dimensions", []),
                "top_neighbors": top_neighbors,
                "cluster_membership": cluster_membership,
                "graph_degree": len(top_neighbors),
                "metadata": representation.get("metadata", {}),
            }
        submissions_index.append(
            {
                "submission_id": submission_id,
                "submission_name": submission["submission_name"],
                "status": submission["ingestion_status"],
                "detail_path": f"submissions/{submission_id}.json",
            }
        )
        atomic_write_json(read_models_dir / "submissions" / f"{submission_id}.json", detail)
    atomic_write_json(read_models_dir / "submissions" / "index.json", submissions_index)

    pair_index = {"assignment_id": assignment_id, "run_id": run_id, "spaces": {}, "chunk_files": []}
    expr_pair_chunks = sorted((run_dir / "pairs" / "expr" / "chunks").glob("*.json"))
    pair_index["chunk_files"] = [path.name for path in expr_pair_chunks]

    for space in DISPLAY_SPACE_KEYS:
        pairs_written = 0
        for pair in pair_items_by_space.get(space, []):
            left_id = pair["submission_i"]
            right_id = pair["submission_j"]
            if space == FUSION_SPACE_KEY:
                payload = _build_fusion_pair_detail_payload(
                    assignment_id=assignment_id,
                    run_id=run_id,
                    left_id=left_id,
                    right_id=right_id,
                    left_name=submission_lookup[left_id],
                    right_name=submission_lookup[right_id],
                    relation=pair,
                    graph_edge=graph_edge_lookup[space].get(_pair_key(left_id, right_id)),
                    fusion_meta=fusion_meta,
                )
            else:
                payload = _build_pair_detail_payload(
                    assignment_id=assignment_id,
                    run_id=run_id,
                    space=space,
                    left_id=left_id,
                    right_id=right_id,
                    left_name=submission_lookup[left_id],
                    right_name=submission_lookup[right_id],
                    relation=pair,
                    left_features=raw_features_by_space[space][left_id],
                    right_features=raw_features_by_space[space][right_id],
                    left_comparison=comparison_models[space]["weighted"][left_id],
                    right_comparison=comparison_models[space]["weighted"][right_id],
                    graph_edge=graph_edge_lookup[space].get(_pair_key(left_id, right_id)),
                )
            atomic_write_json(read_models_dir / "pairs" / space / f"{left_id}__{right_id}.json", payload)
            pairs_written += 1
        pair_index["spaces"][space] = {"pair_count": pairs_written, "base_path": f"pairs/{space}"}

    atomic_write_json(read_models_dir / "pairs" / "index.json", pair_index)

    ast_ok_files = sum(item["submission"].get("stats", {}).get("ast_ok_file_count", 0) for item in submission_results)
    ast_recovered_files = sum(item["submission"].get("stats", {}).get("ast_recovered_file_count", 0) for item in submission_results)
    overview = {
        "assignment_id": assignment_id,
        "run_id": run_id,
        "submission_count": len(submission_results),
        "valid_submission_count": sum(1 for item in submission_results if item["submission"]["ingestion_status"] == "ok"),
        "ast_parse_coverage": {
            "ok_file_count": ast_ok_files,
            "recovered_file_count": ast_recovered_files,
            "total_java_files": ast_ok_files + ast_recovered_files,
        },
        "spaces": list(DISPLAY_SPACE_KEYS),
        "fusion": fusion_meta,
        "links": {
            "submissions": "submissions/index.json",
            "graphs": {space: f"graphs/{space}.json" for space in DISPLAY_SPACE_KEYS},
            "clusters": {space: f"clusters/{space}.json" for space in DISPLAY_SPACE_KEYS},
            "pairs": "pairs/index.json",
        },
    }
    atomic_write_json(read_models_dir / "overview.json", overview)

    for space in DISPLAY_SPACE_KEYS:
        atomic_write_json(read_models_dir / "graphs" / f"{space}.json", graphs[space])
        atomic_write_json(read_models_dir / "clusters" / f"{space}.json", clusters[space])

    atomic_write_json(read_models_dir / "stability.json", {"run_id": run_id, "variants": []})
    atomic_write_json(read_models_dir / "fusion.json", {"run_id": run_id, **fusion_meta})


def _build_pair_detail_payload(
    assignment_id: str,
    run_id: str,
    space: str,
    left_id: str,
    right_id: str,
    left_name: str,
    right_name: str,
    relation: dict[str, Any],
    left_features: dict[str, float],
    right_features: dict[str, float],
    left_comparison: dict[str, float],
    right_comparison: dict[str, float],
    graph_edge: dict[str, Any] | None,
) -> dict[str, Any]:
    left_norm = math.sqrt(sum(value * value for value in left_comparison.values()))
    right_norm = math.sqrt(sum(value * value for value in right_comparison.values()))
    denominator = left_norm * right_norm

    common_signals = []
    differing_signals = []
    for key in sorted(set(left_comparison) | set(right_comparison)):
        left_value = float(left_comparison.get(key, 0.0))
        right_value = float(right_comparison.get(key, 0.0))
        contribution = (left_value * right_value / denominator) if denominator else 0.0
        gap = abs(left_value - right_value)
        if left_value != 0.0 or right_value != 0.0:
            differing_signals.append(
                {
                    "feature": key,
                    "left_value": round(left_value, 6),
                    "right_value": round(right_value, 6),
                    "absolute_gap": round(gap, 6),
                    "dominant_submission_id": left_id if left_value >= right_value else right_id,
                }
            )
        if left_value > 0.0 and right_value > 0.0:
            common_signals.append(
                {
                    "feature": key,
                    "left_value": round(left_value, 6),
                    "right_value": round(right_value, 6),
                    "contribution": round(contribution, 6),
                }
            )

    common_signals.sort(key=lambda item: item["contribution"], reverse=True)
    differing_signals.sort(key=lambda item: item["absolute_gap"], reverse=True)

    return {
        "assignment_id": assignment_id,
        "run_id": run_id,
        "space": space,
        "submission_a": {"submission_id": left_id, "submission_name": left_name},
        "submission_b": {"submission_id": right_id, "submission_name": right_name},
        "relation_raw": relation["relation_raw"],
        "relation_cal": relation["relation_cal"],
        "method": relation.get("meta", {}).get("method", "hybrid_profile_contrast_overlap_v3"),
        "score_components": relation.get("meta", {}).get("components", {}),
        "score_weights": relation.get("meta", {}).get("weights", {}),
        "calibration": relation.get("meta", {}).get("calibration", {}),
        "graph_edge": {
            "is_present": bool(graph_edge),
            "edge_type": graph_edge.get("edge_type") if graph_edge else None,
            "weight": graph_edge.get("weight") if graph_edge else None,
        },
        "vector_norms": {
            "submission_a": round(left_norm, 6),
            "submission_b": round(right_norm, 6),
        },
        "top_common_signals": common_signals[:10],
        "top_differing_signals": differing_signals[:10],
        "submission_a_top_dimensions": rank_feature_dimensions(left_features),
        "submission_b_top_dimensions": rank_feature_dimensions(right_features),
    }


def _build_fusion_pair_detail_payload(
    *,
    assignment_id: str,
    run_id: str,
    left_id: str,
    right_id: str,
    left_name: str,
    right_name: str,
    relation: dict[str, Any],
    graph_edge: dict[str, Any] | None,
    fusion_meta: dict[str, Any],
) -> dict[str, Any]:
    meta = relation.get("meta", {})
    source_scores = meta.get("source_scores", {})
    source_scores_raw = meta.get("source_scores_raw", {})
    table_rows = [
        {
            "feature": space,
            "left_value": round(source_scores_raw.get(space, 0.0), 6),
            "right_value": round(source_scores.get(space, 0.0), 6),
            "contribution": round(meta.get("weights", {}).get(space, 0.0), 6),
        }
        for space in PRIMARY_SPACE_KEYS
    ]
    differing = [
        {
            "feature": f"corr:{left}>{right}",
            "left_value": round(value, 6),
            "right_value": round(meta.get("source_uniqueness", {}).get(left, 0.0), 6),
            "absolute_gap": round(abs(value - meta.get("source_uniqueness", {}).get(left, 0.0)), 6),
            "dominant_submission_id": left_id if value >= meta.get("source_uniqueness", {}).get(left, 0.0) else right_id,
        }
        for left, correlations in meta.get("source_correlations", {}).items()
        for right, value in correlations.items()
        if left != right
    ]
    return {
        "assignment_id": assignment_id,
        "run_id": run_id,
        "space": FUSION_SPACE_KEY,
        "submission_a": {"submission_id": left_id, "submission_name": left_name},
        "submission_b": {"submission_id": right_id, "submission_name": right_name},
        "relation_raw": relation["relation_raw"],
        "relation_cal": relation["relation_cal"],
        "method": meta.get("method", "heuristic_correlation_discounted_fusion_v1"),
        "score_components": meta.get("components", {}),
        "score_weights": meta.get("weights", {}),
        "calibration": relation.get("meta", {}).get("calibration", {}),
        "graph_edge": {
            "is_present": bool(graph_edge),
            "edge_type": graph_edge.get("edge_type") if graph_edge else None,
            "weight": graph_edge.get("weight") if graph_edge else None,
        },
        "fusion_meta": fusion_meta,
        "source_scores": source_scores,
        "source_scores_raw": source_scores_raw,
        "top_common_signals": table_rows,
        "top_differing_signals": differing[:10],
    }


def _pair_key(left: str, right: str) -> str:
    return "::".join(sorted((left, right)))
