from app.analysis import build_fusion_space
from app.java_ast import analyze_java_ast, ast_summary_to_struct_features


def test_ast_summary_uses_real_parser_and_extracts_control_shapes() -> None:
    source = """
    class Demo {
        int sum(int[] values) {
            int total = 0;
            for (int value : values) {
                if (value > 0) {
                    total += value;
                }
            }
            return total;
        }
    }
    """
    summary = analyze_java_ast(source)
    features = ast_summary_to_struct_features(summary)
    assert summary.provider in {"tree_sitter_java", "javalang"}
    assert summary.provider != "heuristic_ast"
    assert summary.node_count > 0
    assert summary.max_depth >= 3
    assert features["ast_node:method"] >= 1.0
    assert features["ast_node:if"] >= 1.0
    assert any(key.startswith("ast_path:") for key in features)
    assert any(key.startswith("ast_edge:") for key in features)


def test_fusion_space_rewards_cross_space_support(tmp_path) -> None:
    comparison_models = {
        "expr": {"weighted": {"a": {"x": 1.0}, "b": {"x": 1.0}, "c": {"y": 1.0}}},
        "struct": {"weighted": {"a": {"m": 1.0}, "b": {"m": 1.0}, "c": {"n": 1.0}}},
        "sem": {"weighted": {"a": {"i": 1.0}, "b": {"i": 1.0}, "c": {"j": 1.0}}},
    }
    pair_items_by_space = {
        "expr": [
            {"submission_i": "a", "submission_j": "b", "relation_raw": 0.9, "relation_cal": 0.9, "meta": {}},
            {"submission_i": "a", "submission_j": "c", "relation_raw": 0.2, "relation_cal": 0.2, "meta": {}},
            {"submission_i": "b", "submission_j": "c", "relation_raw": 0.25, "relation_cal": 0.25, "meta": {}},
        ],
        "struct": [
            {"submission_i": "a", "submission_j": "b", "relation_raw": 0.85, "relation_cal": 0.85, "meta": {}},
            {"submission_i": "a", "submission_j": "c", "relation_raw": 0.1, "relation_cal": 0.1, "meta": {}},
            {"submission_i": "b", "submission_j": "c", "relation_raw": 0.15, "relation_cal": 0.15, "meta": {}},
        ],
        "sem": [
            {"submission_i": "a", "submission_j": "b", "relation_raw": 0.8, "relation_cal": 0.8, "meta": {}},
            {"submission_i": "a", "submission_j": "c", "relation_raw": 0.12, "relation_cal": 0.12, "meta": {}},
            {"submission_i": "b", "submission_j": "c", "relation_raw": 0.11, "relation_cal": 0.11, "meta": {}},
        ],
    }
    submission_results = [
        {"submission": {"submission_id": "a", "submission_name": "A"}},
        {"submission": {"submission_id": "b", "submission_name": "B"}},
        {"submission": {"submission_id": "c", "submission_name": "C"}},
    ]

    build_fusion_space(
        run_dir=tmp_path,
        run_id="run_1",
        submission_results=submission_results,
        comparison_models=comparison_models,
        pair_items_by_space=pair_items_by_space,
        chunk_size=100,
    )

    fusion_pairs = pair_items_by_space["fusion"]
    fusion_lookup = {(item["submission_i"], item["submission_j"]): item for item in fusion_pairs}
    assert fusion_lookup[("a", "b")]["relation_cal"] > fusion_lookup[("a", "c")]["relation_cal"]
    assert fusion_lookup[("a", "b")]["relation_cal"] > fusion_lookup[("b", "c")]["relation_cal"]
