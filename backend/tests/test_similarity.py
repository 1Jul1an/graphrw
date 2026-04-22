from app.analysis import _build_comparison_model, _hybrid_similarity
from app.features import extract_file_space_features


def test_hybrid_similarity_rewards_sparse_shared_signals() -> None:
    raw = {
        "sub_a": {"import_family:java.util": 1.0, "collection_usage": 4.0, "file_count": 1.0},
        "sub_b": {"import_family:java.util": 1.0, "collection_usage": 5.0, "file_count": 1.0},
        "sub_c": {"import_family:java.io": 1.0, "io_usage": 4.0, "file_count": 1.0},
    }
    model = _build_comparison_model(raw, "sem")

    score_ab, _ = _hybrid_similarity(
        left_weighted=model["weighted"]["sub_a"],
        right_weighted=model["weighted"]["sub_b"],
        left_standardized=model["standardized"]["sub_a"],
        right_standardized=model["standardized"]["sub_b"],
        space="sem",
    )
    score_ac, _ = _hybrid_similarity(
        left_weighted=model["weighted"]["sub_a"],
        right_weighted=model["weighted"]["sub_c"],
        left_standardized=model["standardized"]["sub_a"],
        right_standardized=model["standardized"]["sub_c"],
        space="sem",
    )

    assert score_ab > score_ac


def test_expr_similarity_no_longer_has_artificial_half_similarity_floor() -> None:
    raw = {
        "a": {"expr_ngram:2:ID + ID": 4.0, "line_skeleton:return ID ;": 2.0, "token_count": 100.0},
        "b": {"expr_ngram:2:ID + ID": 5.0, "line_skeleton:return ID ;": 2.0, "token_count": 98.0},
        "c": {"expr_ngram:2:if ( ID": 4.0, "line_skeleton:while ( ID ) {": 2.0, "token_count": 102.0},
    }
    model = _build_comparison_model(raw, "expr")

    score_ab, _ = _hybrid_similarity(
        left_weighted=model["weighted"]["a"],
        right_weighted=model["weighted"]["b"],
        left_standardized=model["standardized"]["a"],
        right_standardized=model["standardized"]["b"],
        space="expr",
    )
    score_ac, _ = _hybrid_similarity(
        left_weighted=model["weighted"]["a"],
        right_weighted=model["weighted"]["c"],
        left_standardized=model["standardized"]["a"],
        right_standardized=model["standardized"]["c"],
        space="expr",
    )

    assert score_ab > 0.9
    assert score_ac < 0.25


def test_extract_file_space_features_adds_expr_skeleton_signals() -> None:
    features = extract_file_space_features(
        """
        class Demo {
            int sum(int a, int b) {
                if (a > b) {
                    return a + b;
                }
                return b;
            }
        }
        """
    )
    expr = features["expr"]
    assert any(key.startswith("line_skeleton:") for key in expr)
    assert any(key.startswith("keyword_operator_pair:") for key in expr)
