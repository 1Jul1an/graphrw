from app.analysis import _cluster_from_pair_items


def test_hdbscan_precomputed_finds_clusters_and_noise() -> None:
    submission_lookup = {
        "a": "A",
        "b": "B",
        "c": "C",
        "d": "D",
        "e": "E",
        "f": "F",
    }
    pair_items = [
        {"submission_i": "a", "submission_j": "b", "relation_cal": 0.92, "relation_raw": 0.92},
        {"submission_i": "a", "submission_j": "c", "relation_cal": 0.88, "relation_raw": 0.88},
        {"submission_i": "a", "submission_j": "d", "relation_cal": 0.20, "relation_raw": 0.20},
        {"submission_i": "a", "submission_j": "e", "relation_cal": 0.18, "relation_raw": 0.18},
        {"submission_i": "a", "submission_j": "f", "relation_cal": 0.05, "relation_raw": 0.05},
        {"submission_i": "b", "submission_j": "c", "relation_cal": 0.90, "relation_raw": 0.90},
        {"submission_i": "b", "submission_j": "d", "relation_cal": 0.22, "relation_raw": 0.22},
        {"submission_i": "b", "submission_j": "e", "relation_cal": 0.18, "relation_raw": 0.18},
        {"submission_i": "b", "submission_j": "f", "relation_cal": 0.05, "relation_raw": 0.05},
        {"submission_i": "c", "submission_j": "d", "relation_cal": 0.25, "relation_raw": 0.25},
        {"submission_i": "c", "submission_j": "e", "relation_cal": 0.20, "relation_raw": 0.20},
        {"submission_i": "c", "submission_j": "f", "relation_cal": 0.08, "relation_raw": 0.08},
        {"submission_i": "d", "submission_j": "e", "relation_cal": 0.90, "relation_raw": 0.90},
        {"submission_i": "d", "submission_j": "f", "relation_cal": 0.10, "relation_raw": 0.10},
        {"submission_i": "e", "submission_j": "f", "relation_cal": 0.08, "relation_raw": 0.08},
    ]
    edges = [
        {"submission_src": "a", "submission_dst": "b", "relation_cal": 0.92, "relation_raw": 0.92, "is_mutual": True},
        {"submission_src": "a", "submission_dst": "c", "relation_cal": 0.88, "relation_raw": 0.88, "is_mutual": True},
        {"submission_src": "b", "submission_dst": "c", "relation_cal": 0.90, "relation_raw": 0.90, "is_mutual": True},
        {"submission_src": "d", "submission_dst": "e", "relation_cal": 0.90, "relation_raw": 0.90, "is_mutual": True},
    ]

    payload = _cluster_from_pair_items(
        run_id="run_1",
        space="fusion",
        submission_lookup=submission_lookup,
        pair_items=pair_items,
        edges=edges,
    )

    assert payload["method"] == "hdbscan_precomputed"
    assert len(payload["clusters"]) == 2
    cluster_sets = [
        {member["submission_id"] for member in cluster["members"]}
        for cluster in payload["clusters"]
    ]
    assert {"a", "b", "c"} in cluster_sets
    assert {"d", "e"} in cluster_sets
    assert any(item["submission_id"] == "f" for item in payload["noise"])
