from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from .explanations import explain_cluster, explain_pair, explain_submission_space
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
    pair_lookup = {
        space: {
            _pair_key(item["submission_i"], item["submission_j"]): item
            for item in pair_items_by_space.get(space, [])
        }
        for space in DISPLAY_SPACE_KEYS
    }

    for space in DISPLAY_SPACE_KEYS:
        _enrich_clusters_payload(
            clusters_payload=clusters[space],
            space=space,
            submission_lookup=submission_lookup,
            pair_lookup=pair_lookup[space],
            feature_vectors=(comparison_models[space]["weighted"] if space in PRIMARY_SPACE_KEYS else None),
            fusion_meta=fusion_meta,
        )

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
            cluster_membership, cluster_diagnostics = _cluster_membership_for_submission(clusters.get(space, {}), submission_id)
            detail["spaces"][space] = {
                "representation": representation.get("feature_stats", {}),
                "top_dimensions": representation.get("top_dimensions", []),
                "comparison_dimensions": representation.get("comparison_dimensions", []),
                "standardized_dimensions": representation.get("standardized_dimensions", []),
                "top_neighbors": top_neighbors,
                "cluster_membership": cluster_membership,
                "cluster_diagnostics": cluster_diagnostics,
                "explanation": explain_submission_space(
                    space=space,
                    submission_id=submission_id,
                    submission_name=submission["submission_name"],
                    top_neighbors=top_neighbors,
                    cluster_membership=cluster_membership,
                    cluster_diagnostics=cluster_diagnostics,
                ),
                "graph_degree": len(top_neighbors),
                "metadata": representation.get("metadata", {}),
                "space_meta": graphs[space].get("meta", {}),
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
        "graph_overview": {
            space: {
                "nodes": len(graphs[space].get("nodes", [])),
                "edges": len(graphs[space].get("edges", [])),
                "clusters": len(clusters[space].get("clusters", [])),
                "noise": len(clusters[space].get("noise", [])),
                "similarity_stats": graphs[space].get("meta", {}).get("similarity_stats", {}),
            }
            for space in DISPLAY_SPACE_KEYS
        },
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


def _cluster_membership_for_submission(clusters_payload: dict[str, Any], submission_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    for cluster in clusters_payload.get("clusters", []):
        for member in cluster.get("members", []):
            if member["submission_id"] == submission_id:
                return {
                    "cluster_id": cluster["cluster_id"],
                    "cluster_label": cluster.get("label"),
                    "size": cluster["size"],
                    "membership_strength": member.get("membership_strength", 1.0),
                    "method": clusters_payload.get("method"),
                    "color": cluster.get("color"),
                }, _cluster_diagnostics_payload(cluster)
    if any(item.get("submission_id") == submission_id for item in clusters_payload.get("noise", [])):
        return {
            "cluster_id": None,
            "cluster_label": "Noise",
            "size": 1,
            "membership_strength": 0.0,
            "method": clusters_payload.get("method"),
            "is_noise": True,
        }, None
    return None, None


def _cluster_diagnostics_payload(cluster: dict[str, Any]) -> dict[str, Any]:
    diagnostics = cluster.get("diagnostics", {})
    payload = {
        "label": cluster.get("label"),
        "size": cluster.get("size"),
        "summary_metrics": cluster.get("summary_metrics", {}),
        "signature_features": diagnostics.get("signature_features", []),
        "contrast_features": diagnostics.get("contrast_features", []),
        "central_members": diagnostics.get("central_members", []),
        "strongest_internal_pairs": diagnostics.get("strongest_internal_pairs", []),
        "nearest_external_pairs": diagnostics.get("nearest_external_pairs", []),
        "notes": diagnostics.get("notes", []),
    }
    payload["explanation"] = explain_cluster(space=cluster.get("space", ""), cluster=cluster)
    return payload


def _enrich_clusters_payload(
    *,
    clusters_payload: dict[str, Any],
    space: str,
    submission_lookup: dict[str, str],
    pair_lookup: dict[str, dict[str, Any]],
    feature_vectors: dict[str, dict[str, float]] | None,
    fusion_meta: dict[str, Any],
) -> None:
    all_submission_ids = list(submission_lookup)
    for cluster in clusters_payload.get("clusters", []):
        member_ids = [member["submission_id"] for member in cluster.get("members", [])]
        diagnostics = {
            "central_members": _cluster_central_members(member_ids, pair_lookup, submission_lookup),
            "strongest_internal_pairs": _cluster_pair_summaries(member_ids, pair_lookup, submission_lookup, external=False),
            "nearest_external_pairs": _cluster_pair_summaries(member_ids, pair_lookup, submission_lookup, external=True),
            "notes": [],
        }
        if feature_vectors:
            signature_features, contrast_features = _cluster_signature_features(member_ids, all_submission_ids, feature_vectors)
            diagnostics["signature_features"] = signature_features
            diagnostics["contrast_features"] = contrast_features
        else:
            diagnostics["signature_features"] = []
            diagnostics["contrast_features"] = []
            diagnostics["notes"].append(f"Fusion nutzt Raumgewichte {fusion_meta.get('space_weights', {})}.")
        cluster["space"] = space
        cluster["diagnostics"] = diagnostics


def _cluster_central_members(member_ids: list[str], pair_lookup: dict[str, dict[str, Any]], submission_lookup: dict[str, str], limit: int = 3) -> list[dict[str, Any]]:
    rows = []
    for member_id in member_ids:
        internal_scores = []
        for other_id in member_ids:
            if member_id == other_id:
                continue
            pair = pair_lookup.get(_pair_key(member_id, other_id))
            if pair:
                internal_scores.append(float(pair.get("relation_cal", 0.0)))
        rows.append({
            "submission_id": member_id,
            "submission_name": submission_lookup.get(member_id, member_id),
            "mean_internal_similarity": round(sum(internal_scores) / len(internal_scores), 6) if internal_scores else 1.0,
        })
    return sorted(rows, key=lambda item: item["mean_internal_similarity"], reverse=True)[:limit]


def _cluster_pair_summaries(member_ids: list[str], pair_lookup: dict[str, dict[str, Any]], submission_lookup: dict[str, str], *, external: bool, limit: int = 5) -> list[dict[str, Any]]:
    rows = []
    member_set = set(member_ids)
    for pair_key, pair in pair_lookup.items():
        left_id, right_id = pair_key.split("::")
        is_internal = left_id in member_set and right_id in member_set
        is_external = (left_id in member_set) ^ (right_id in member_set)
        if external and not is_external:
            continue
        if not external and not is_internal:
            continue
        rows.append({
            "source": left_id,
            "source_name": submission_lookup.get(left_id, left_id),
            "target": right_id,
            "target_name": submission_lookup.get(right_id, right_id),
            "weight": round(float(pair.get("relation_cal", 0.0)), 6),
        })
    return sorted(rows, key=lambda item: item["weight"], reverse=True)[:limit]


def _cluster_signature_features(member_ids: list[str], all_submission_ids: list[str], feature_vectors: dict[str, dict[str, float]], limit: int = 8) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    member_set = set(member_ids)
    rest_ids = [submission_id for submission_id in all_submission_ids if submission_id not in member_set]
    if not member_ids:
        return [], []
    feature_keys = sorted({key for features in feature_vectors.values() for key in features})
    rows = []
    for key in feature_keys:
        member_mean = sum(float(feature_vectors.get(submission_id, {}).get(key, 0.0)) for submission_id in member_ids) / max(1, len(member_ids))
        rest_mean = sum(float(feature_vectors.get(submission_id, {}).get(key, 0.0)) for submission_id in rest_ids) / max(1, len(rest_ids)) if rest_ids else 0.0
        lift = member_mean - rest_mean
        if abs(lift) < 1e-9 and member_mean == 0.0 and rest_mean == 0.0:
            continue
        rows.append({
            "feature": key,
            "cluster_mean": round(member_mean, 6),
            "rest_mean": round(rest_mean, 6),
            "lift": round(lift, 6),
        })
    signature = sorted([row for row in rows if row["lift"] > 0], key=lambda item: item["lift"], reverse=True)[:limit]
    contrast = sorted([row for row in rows if row["lift"] < 0], key=lambda item: item["lift"])[: min(5, limit)]
    return signature, contrast


def _build_pair_detail_payload(assignment_id: str, run_id: str, space: str, left_id: str, right_id: str, left_name: str, right_name: str, relation: dict[str, Any], left_features: dict[str, float], right_features: dict[str, float], left_comparison: dict[str, float], right_comparison: dict[str, float], graph_edge: dict[str, Any] | None) -> dict[str, Any]:
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
            differing_signals.append({"feature": key, "left_value": round(left_value, 6), "right_value": round(right_value, 6), "absolute_gap": round(gap, 6), "dominant_submission_id": left_id if left_value >= right_value else right_id})
        if left_value > 0.0 and right_value > 0.0:
            common_signals.append({"feature": key, "left_value": round(left_value, 6), "right_value": round(right_value, 6), "contribution": round(contribution, 6)})

    common_signals.sort(key=lambda item: item["contribution"], reverse=True)
    differing_signals.sort(key=lambda item: item["absolute_gap"], reverse=True)

    payload = {
        "assignment_id": assignment_id,
        "run_id": run_id,
        "space": space,
        "submission_a": {"submission_id": left_id, "submission_name": left_name},
        "submission_b": {"submission_id": right_id, "submission_name": right_name},
        "relation_raw": relation["relation_raw"],
        "relation_cal": relation["relation_cal"],
        "method": relation.get("meta", {}).get("method", "hybrid_profile_contrast_overlap_v4"),
        "score_components": relation.get("meta", {}).get("components", {}),
        "score_weights": relation.get("meta", {}).get("weights", {}),
        "calibration": relation.get("meta", {}).get("calibration", {}),
        "diagnostics": relation.get("meta", {}).get("diagnostics", {}),
        "graph_edge": {"is_present": bool(graph_edge), "edge_type": graph_edge.get("edge_type") if graph_edge else None, "weight": graph_edge.get("weight") if graph_edge else None},
        "vector_norms": {"submission_a": round(left_norm, 6), "submission_b": round(right_norm, 6)},
        "top_common_signals": common_signals[:10],
        "top_differing_signals": differing_signals[:10],
        "submission_a_top_dimensions": rank_feature_dimensions(left_features),
        "submission_b_top_dimensions": rank_feature_dimensions(right_features),
    }
    payload["explanation"] = explain_pair(space=space, pair_detail=payload)
    return payload


def _build_fusion_pair_detail_payload(*, assignment_id: str, run_id: str, left_id: str, right_id: str, left_name: str, right_name: str, relation: dict[str, Any], graph_edge: dict[str, Any] | None, fusion_meta: dict[str, Any]) -> dict[str, Any]:
    meta = relation.get("meta", {})
    source_scores = meta.get("source_scores", {})
    source_scores_raw = meta.get("source_scores_raw", {})
    table_rows = [{"feature": space, "left_value": round(source_scores_raw.get(space, 0.0), 6), "right_value": round(source_scores.get(space, 0.0), 6), "contribution": round(meta.get("weights", {}).get(space, 0.0), 6)} for space in PRIMARY_SPACE_KEYS]
    differing = [{"feature": f"corr:{left}>{right}", "left_value": round(value, 6), "right_value": round(meta.get("source_uniqueness", {}).get(left, 0.0), 6), "absolute_gap": round(abs(value - meta.get("source_uniqueness", {}).get(left, 0.0)), 6), "dominant_submission_id": left_id if value >= meta.get("source_uniqueness", {}).get(left, 0.0) else right_id} for left, correlations in meta.get("source_correlations", {}).items() for right, value in correlations.items() if left != right]
    payload = {
        "assignment_id": assignment_id,
        "run_id": run_id,
        "space": FUSION_SPACE_KEY,
        "submission_a": {"submission_id": left_id, "submission_name": left_name},
        "submission_b": {"submission_id": right_id, "submission_name": right_name},
        "relation_raw": relation["relation_raw"],
        "relation_cal": relation["relation_cal"],
        "method": meta.get("method", "support_aware_correlation_discounted_fusion_v2"),
        "score_components": meta.get("components", {}),
        "score_weights": meta.get("weights", {}),
        "calibration": relation.get("meta", {}).get("calibration", {}),
        "diagnostics": meta.get("diagnostics", {}),
        "graph_edge": {"is_present": bool(graph_edge), "edge_type": graph_edge.get("edge_type") if graph_edge else None, "weight": graph_edge.get("weight") if graph_edge else None},
        "fusion_meta": fusion_meta,
        "source_scores": source_scores,
        "source_scores_raw": source_scores_raw,
        "top_common_signals": table_rows,
        "top_differing_signals": differing[:10],
    }
    payload["explanation"] = explain_pair(space=FUSION_SPACE_KEY, pair_detail=payload)
    return payload


def _pair_key(left: str, right: str) -> str:
    return "::".join(sorted((left, right)))
