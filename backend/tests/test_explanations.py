from app.explanations import explain_cluster, explain_pair, explain_submission_space


def test_explain_pair_highlights_surface_and_calls():
    payload = {
        "relation_cal": 0.81,
        "score_components": {"profile_cosine": 0.7, "rare_overlap": 0.9},
        "top_common_signals": [
            {"feature": "expr_ngram:2:ID ID", "contribution": 0.32},
            {"feature": "call_name:add", "contribution": 0.18},
            {"feature": "line_skeleton:return ID ;", "contribution": 0.15},
        ],
        "top_differing_signals": [
            {"feature": "token_count", "absolute_gap": 0.4},
        ],
    }
    explanation = explain_pair(space="expr", pair_detail=payload)
    assert "getragen" in explanation["summary"]
    assert explanation["agreement_profile"]
    labels = [item["label"] for item in explanation["top_shared_patterns"]]
    assert any("Token" in label or "Aufrufname" in label for label in labels)


def test_explain_cluster_surfaces_core_basis():
    cluster = {
        "summary_metrics": {"internal_density": 0.72, "avg_pair_similarity": 0.79, "cluster_span": 0.31},
        "diagnostics": {
            "signature_features": [
                {"feature": "ast_node_ratio:if", "lift": 0.28},
                {"feature": "ast_path_ratio:method>for>if", "lift": 0.19},
            ],
            "contrast_features": [
                {"feature": "ast_node_ratio:switch", "lift": -0.12},
            ],
            "central_members": [
                {"submission_name": "A.java"},
                {"submission_name": "B.java"},
            ],
            "strongest_internal_pairs": [
                {"source_name": "A.java", "target_name": "B.java", "weight": 0.88},
            ],
            "nearest_external_pairs": [
                {"source_name": "A.java", "target_name": "X.java", "weight": 0.54},
            ],
        },
    }
    explanation = explain_cluster(space="struct", cluster=cluster)
    assert explanation["cohesion_basis"]
    assert explanation["core_members"] == ["A.java", "B.java"]


def test_explain_submission_space_handles_noise():
    explanation = explain_submission_space(
        space="expr",
        submission_id="s1",
        submission_name="Foo.java",
        top_neighbors=[{"source": "s1", "target": "s2", "weight": 0.44, "edge_type": "mutual_knn"}],
        cluster_membership={"is_noise": True, "cluster_label": "Noise", "size": 1},
        cluster_diagnostics=None,
    )
    assert "Noise" in explanation["summary"]
    assert explanation["neighbor_story"]
